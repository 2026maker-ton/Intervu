// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID } from '../crypto.js';
import { detectPii, maskPii, buildBlindContext, extractClaims, verifyClaimSpan } from '../../domain/pii.js';
import { extractApplicantClaims } from '../../domain/claims.js';
import { normalizeSource } from '../../domain/sources.js';
import { buildInstitutionProfile, normalizeOrgType, providerConstraintForOrg } from '../../domain/institution.js';

export function createProfileHandlers(d) {
  const { config, store, ledger, err, now, priceOf, providerFor, syntheticTraffic } = d;
  async function createProfile(owner, body, requestId) {
    // 프로필 API 속도 제한(사양 §15): 계정당 분당2회/일10회 기본값
    const counts = store.recordProfileCall(owner);
    if (counts.minute > config.profileRate.perMinute || counts.day > config.profileRate.perDay) {
      return err('quota_exceeded', '공고 분석 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429, { retryable: true, details: { minute: counts.minute, day: counts.day, limit_minute: config.profileRate.perMinute, limit_day: config.profileRate.perDay } });
    }
    const source = String(body.source_text || '');
    if (source.length > 20000) return err('validation_error', '공고 본문은 20,000자 이하여야 합니다.', 422, { requestId });
    const application = String(body.application_text || '');
    if (application.length > 20000) return err('validation_error', '자기소개서·지원서 본문은 20,000자 이하여야 합니다.', 422, { requestId });
    if (!body.target_name && !body.role && !source && !application.trim()) return err('validation_error', '기관/직무/공고/지원서 중 하나는 필요합니다.', 422, { requestId });
    // 기관 구분: company·public·university·highschool (기존 general 호환)
    const orgType = normalizeOrgType(body.org_type);
    const mc = providerConstraintForOrg(orgType);
    if (mc.forceMock) {
      // 미성년자 이용 가능 기능: 외부 호출 없이 Mock으로만 처리
      body._forceMock = true;
    }
    const pii = detectPii(source + application + (body.experiences || []).join(' '));
    // 지원서 본문은 마스킹본만 저장·분석한다(원문 PII 비보관). 이 슬라이스는 규칙 기반이라 외부로 전송하지 않는다.
    const maskedApplication = maskPii(application).normalize('NFC');
    const { profile, version_id } = store.createProfile(owner, { ...body, application_text: maskedApplication, org_type: orgType });
    // 사용자 제공 기관 URL(출처 메타): SSRF 방어 검증 후 기록만 한다 (fetch 없음)
    const providedSources = [];
    const rawSources = Array.isArray(body.sources) ? body.sources.slice(0, 10) : (body.source_url ? [{ url: body.source_url, title: '지원 공고 URL' }] : []);
    for (const rs of rawSources) {
      try {
        const ns = normalizeSource(rs, {});
        ns.id = randomUUID();
        store.addSource(profile.id, { ...ns, owner_id: owner });
        providedSources.push(ns);
      } catch (e) {
        return err('validation_error', e.message || '사용할 수 없는 출처 URL입니다.', 422, { requestId, details: e.details || null });
      }
    }
    const pubNotice = body.source_text && providedSources.length === 0
      ? null
      : (providedSources.length ? null : null);
    const masked = maskPii(source);
    const blind = buildBlindContext(masked);
    let extracted;
    let usedProvider = 'mock';
    try {
      // 미성년자 가능 기관(highschool)은 항상 Mock 추출(외부 전송 금지)
      const useProvider = providerFor({ forceMock: !!body._forceMock }).provider;
      if (syntheticTraffic && useProvider.name === 'gemini' && detectPii(source).length > 0) {
        throw Object.assign(new Error('synthetic traffic must not contain PII'), { code: 422 });
      }
      if (useProvider.name === 'gemini') {
        ledger.reserve(`profile:${profile.id}`, 0.01);
        const caught = await useProvider.extract({ sourceText: masked, blindContext: blind });
        ledger.settle(`profile:${profile.id}`, 0.01, priceOf(caught.model, caught.usage));
        extracted = caught;
        usedProvider = 'gemini';
      } else {
        extracted = extractClaims(masked, body.experiences || []);
      }
    } catch (e) {
      if (e.code === 422 && /PII/.test(e.message)) {
        return err('validation_error', '합성 테스트 데이터에 개인정보를 포함할 수 없습니다.', 422, { requestId });
      }
      // 추출 실패 → 일반 템플릿(세션은 계속 가능)
      extracted = { claims: [], missing_fields: ['extraction_failed'], recommended_template: 'general-entry-v1', degraded_reason: e.code || 'provider_error' };
    }
    // 서버가 span을 원문에서 직접 계산(모델 좌표를 신뢰하지 않음) 후 일치 검증
    const normalized = (extracted.claims || []).map((c) => {
      const quote = String(c.value || c.quote || '').normalize('NFC').trim();
      if (!quote) return null;
      const chars = Array.from(masked);
      const idx = masked.indexOf(quote);
      if (idx === -1) return null;
      const start_cp = Array.from(masked.slice(0, idx)).length;
      return {
        kind: ['competency', 'format', 'requirement', 'experience'].includes(c.kind) ? c.kind : 'competency',
        value: quote.slice(0, 60),
        source_document_id: c.source_document_id || 'doc-1',
        revision: 1,
        start_cp,
        end_cp: start_cp + Array.from(quote).length,
        quote: quote.slice(0, 200),
        status: 'user_supplied',
      };
    }).filter(Boolean);
    const claims = normalized.filter((c) => verifyClaimSpan(masked, c));
    const rejected = (extracted.claims || []).length - claims.length;
    if (rejected > 0) extracted.rejected_spans = rejected;
    // 지원자 주장·공백(문장 단위, 원문 span 검증 포함): 질문 설계의 근거(PROJECT.md §2.4)
    const applicant_claims = extractApplicantClaims(maskedApplication);
    store.setExtracted(version_id, { ...extracted, claims, applicant_claims, application_chars: Array.from(maskedApplication.trim()).length, masked_text: masked, blind_context: blind });
    // 기관 프로필 초안 생성(결정적 분석): 승인 전 사용자가 확인·수정한다
    const institution = buildInstitutionProfile({
      orgType, targetName: body.target_name, role: body.role,
      sources: providedSources, claims, userNotes: (body.experiences || []).join('\n'),
    });
    store.setInstitution(profile.id, institution, 'review');
    void pubNotice;
    return { status: 201, body: { id: profile.id, version_id, status: 'review', pii_warnings: pii.map((x) => x.type), provider: usedProvider, applicant_claims_count: applicant_claims.length, institution, institution_status: 'review' } };
  }

  function getProfile(owner, id) {
    const p = store.getProfile(owner, id);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const approved = p.approved_version_id ? store.getVersion(p.approved_version_id) : null;
    const current = p.version_id ? store.getVersion(p.version_id) : null;
    const inst = store.getInstitution(id);
    return {
      status: 200,
      body: {
        ...p,
        current_version: current ? { id: current.id, status: current.status, extracted: current.extracted } : null,
        approved_version: approved ? { id: approved.id, extracted: approved.extracted } : null,
        sources: store.listSources(id),
        institution: inst?.profile || null,
        institution_status: inst?.status || null,
      },
    };
  }

  function approveProfile(owner, id, body) {
    const p = store.getProfile(owner, id);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const vid = body.version_id || p.approved_version_id;
    if (!vid) return err('validation_error', 'version_id가 필요합니다.', 422);
    const v = store.approveVersion(owner, id, vid);
    if (!v) return err('not_found', '버전을 찾을 수 없습니다.', 404);
    // 기관 프로필도 함께 승인(불변 스냅샷). 사용자가 수정한 경우 body.institution_edits 반영.
    const inst = store.getInstitution(id);
    let approvedInst = inst?.profile || null;
    if (inst && body.institution_edits && typeof body.institution_edits === 'object') {
      const edits = body.institution_edits;
      approvedInst = {
        ...inst.profile,
        core_values: Array.isArray(edits.core_values) ? edits.core_values.slice(0, 10) : inst.profile.core_values,
        role_focus: Array.isArray(edits.role_focus) ? edits.role_focus.slice(0, 5) : inst.profile.role_focus,
        approved_note: typeof edits.note === 'string' ? edits.note.slice(0, 500) : null,
        user_confirmed_at: now(),
      };
    } else if (inst) {
      approvedInst = { ...inst.profile, user_confirmed_at: now() };
    }
    if (approvedInst) store.setInstitution(id, approvedInst, 'approved');
    return { status: 200, body: { id: v.id, profile_id: id, status: 'approved', approved_at: v.approved_at, institution_status: approvedInst ? 'approved' : null } };
  }

  // ---- 기관 출처·프로필 API ----
  // POST /profiles/:id/sources — 사용자 제공 URL·공식자료 메타 등록(외부 fetch 없음)
  function addInstitutionSource(owner, profileId, body) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const list = Array.isArray(body.sources) ? body.sources : [body];
    if (!list.length || list.length > 10) return err('validation_error', 'sources는 1~10개여야 합니다.', 422);
    const added = [];
    for (const rs of list) {
      try {
        const ns = normalizeSource(rs, {});
        ns.id = randomUUID();
        store.addSource(profileId, { ...ns, owner_id: owner });
        added.push(ns);
      } catch (e) {
        return err('validation_error', e.message || '사용할 수 없는 출처 URL입니다.', 422, { details: e.details || null });
      }
    }
    // 출처 추가 후 기관 프로필 재생성(초안, 승인 전까지 review)
    const ver = p.version_id ? store.getVersion(p.version_id) : null;
    const claims = ver?.extracted?.claims || [];
    const institution = buildInstitutionProfile({
      orgType: normalizeOrgType(p.org_type), targetName: p.target_name, role: p.role,
      sources: store.listSources(profileId), claims, userNotes: (p.experiences || []).join('\n'),
    });
    store.setInstitution(profileId, institution, 'review');
    return { status: 201, body: { added, institution, institution_status: 'review' } };
  }

  function getInstitution(owner, profileId) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const inst = store.getInstitution(profileId);
    if (!inst) return err('not_found', '기관 분석이 없습니다. 먼저 공고를 분석하세요.', 404);
    return { status: 200, body: { profile_id: profileId, status: inst.status, approved_at: inst.approved_at || null, institution: inst.profile, sources: store.listSources(profileId) } };
  }

  return { createProfile, getProfile, approveProfile, addInstitutionSource, getInstitution };
}
