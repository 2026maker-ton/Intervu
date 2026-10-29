// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID } from '../crypto.js';
import { detectPii, maskPii, buildBlindContext, extractClaims, verifyClaimSpan } from '../../domain/pii.js';
import { extractApplicantClaims, extractDocClaims, mergeModelClaims } from '../../domain/claims.js';
import { planGeneralQuestions, publicPlanItem } from '../../domain/plan.js';
import { questionCountForDuration } from '../../domain/interview-types.js';
import { normalizeSource } from '../../domain/sources.js';
import { isSyntheticProfileBody } from '../../domain/fixtures.js';
import { fetchOfficialSource, parseAllowList } from '../../domain/fetcher.js';
import { buildInstitutionProfile, normalizeOrgType, providerConstraintForOrg } from '../../domain/institution.js';

export function createProfileHandlers(d) {
  const { config, store, err, now, caller, requestContext, trends, registry, checkRate, officialFetch = {} } = d;
  async function createProfile(owner, body, requestId) {
    // 프로필 API 속도 제한(사양 §15): 계정당 분당2회/일10회 기본값
    const counts = store.recordRate(owner, 'profile');
    if (counts.minute > config.profileRate.perMinute || counts.day > config.profileRate.perDay) {
      return err('quota_exceeded', '공고 분석 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429, { retryable: true, details: { minute: counts.minute, day: counts.day, limit_minute: config.profileRate.perMinute, limit_day: config.profileRate.perDay } });
    }
    // 합성 판정은 서버가 fixture 해시로만 한다(클라이언트 synthetic/free_test 값은 읽지 않음).
    const synthetic = await isSyntheticProfileBody(body, { demoFixtures: config.demoFixtures });
    if (!synthetic && !store.getConsent(owner)) return err('consent_required', '만 19세 이상 확인과 안내 동의가 필요합니다. 먼저 동의해 주세요.', 428, { requestId });
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
    const { profile, version_id } = store.createProfile(owner, { ...body, application_text: maskedApplication, org_type: orgType, synthetic });
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
    // 공고 키워드 추출: 공급자 라우팅·게이트·예산은 호출 래퍼가 처리한다(고교는 항상 Mock). 지원서 본문은 외부로 보내지 않는다.
    const ctx = requestContext(owner, { forceMock: !!body._forceMock });
    if (caller.plan('claims.extract', ctx).live && ctx.synthetic && detectPii(source).length > 0) {
      return err('validation_error', '합성 테스트 데이터에 개인정보를 포함할 수 없습니다.', 422, { requestId });
    }
    // claims.extract가 Claude로 라우팅되면 Claude는 지원서 주장 전용이므로 공고 키워드는 규칙 기반으로 처리한다.
    const claudeRoute = registry.route('claims.extract').provider === 'claude';
    const res = claudeRoute ? { value: extractClaims(masked, body.experiences || []), trace: null } : await caller.call('claims.extract', {
      ctx, mockAlias: 'rule-based',
      reserve: { key: `profile:${profile.id}`, amount: config.profileRate.reserve },
      invoke: (a) => a.extract({ sourceText: masked, blindContext: blind }),
      mock: () => extractClaims(masked, body.experiences || []),
      validate: (o) => Array.isArray(o?.claims) && o.claims.length <= 50,
    });
    // 실패 폴백이어도 규칙 기반 결과로 계속한다(세션은 계속 가능). 사유는 degraded_reason으로 남긴다.
    const extracted = res.trace?.mode === 'fallback' ? { ...res.value, degraded_reason: res.trace.reason } : res.value;
    let usedProvider = res.trace?.mode === 'live' ? res.trace.provider : 'mock';
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
    let applicant_claims = extractApplicantClaims(maskedApplication);
    const traces = res.trace ? [res.trace] : [];
    // 지원서 주장은 모델 라우트(claude 또는 gemini)에서만 모델에 묻는다. 어느 쪽이든 규칙 결과가 하한선이다.
    const applicantModelRoute = claudeRoute || registry.route('claims.extract').provider === 'gemini';
    if (applicantModelRoute && maskedApplication.trim()) {
      // 마스킹본만 전송(Gemini는 합성 판정 데이터에서만 게이트 통과). 모델 인용은 원문 그대로일 때만 채택(서버가 span·gaps 재계산), 규칙 결과는 하한선. 실패 시 규칙만 남는다.
      const cres = await caller.call('claims.extract', {
        ctx: requestContext(owner, { forceMock: !!body._forceMock, synthetic }), mockAlias: 'rule-based',
        reserve: { key: `profile:${profile.id}:claims`, amount: config.profileRate.reserve },
        invoke: (a) => a.extractApplicantClaims({ maskedApplication }),
        mock: () => ({ quotes: [] }),
        validate: (o) => Array.isArray(o?.quotes) && o.quotes.length <= 50,
      });
      traces.push(cres.trace);
      if (cres.trace.mode === 'live') {
        usedProvider = cres.trace.provider;
        const m = mergeModelClaims(applicant_claims, maskedApplication, cres.value.quotes);
        applicant_claims = m.claims;
        if (m.discarded) extracted.rejected_model_quotes = m.discarded;
      } else if (cres.trace.mode === 'fallback') extracted.degraded_reason = cres.trace.reason;
    }
    store.setExtracted(version_id, { ...extracted, claims, applicant_claims, application_chars: Array.from(maskedApplication.trim()).length, masked_text: masked, blind_context: blind });
    // 기관 프로필 초안 생성(결정적 분석): 승인 전 사용자가 확인·수정한다
    const institution = buildInstitutionProfile({
      orgType, targetName: body.target_name, role: body.role,
      sources: providedSources, claims, userNotes: (body.experiences || []).join('\n'),
    });
    store.setInstitution(profile.id, institution, 'review');
    void pubNotice;
    return { status: 201, body: { id: profile.id, version_id, status: 'review', pii_warnings: pii.map((x) => x.type), provider: usedProvider, synthetic, provider_trace: traces, applicant_claims_count: applicant_claims.length, institution, institution_status: 'review' } };
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

  // WP-C7: 프로필 문서(최신 revision, 마스킹본)에서 문서별 주장을 뽑아 신청 본문·모델 주장 뒤에 붙인다.
  // 문서 주장만 다시 계산하고, 사라진 id는 제외 목록에서 뺀다. 승인된 버전은 승인(재승인) 때만 갱신한다.
  function syncDocClaims(owner, p, ver) {
    if (!ver?.extracted) return;
    const docs = store.listDocuments(owner, p.id).map((d) => {
      const revs = store.getDocumentRevisions(owner, d.id) || [];
      const r = revs[revs.length - 1];
      return r ? { id: d.id, kind: d.kind, revision: r.revision, text: r.text_masked } : null;
    }).filter(Boolean);
    const base = (ver.extracted.applicant_claims || []).filter((c) => !c.document_id);
    ver.extracted.applicant_claims = [...base, ...extractDocClaims(docs, base.length)];
    const ids = new Set(ver.extracted.applicant_claims.map((c) => c.id));
    ver.excluded_claim_ids = (ver.excluded_claim_ids || []).filter((x) => ids.has(x));
  }

  function approveProfile(owner, id, body) {
    const p = store.getProfile(owner, id);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const vid = body.version_id || p.approved_version_id;
    if (!vid) return err('validation_error', 'version_id가 필요합니다.', 422);
    { const sv = store.getVersion(vid); if (sv) syncDocClaims(owner, p, sv); }
    const v = store.approveVersion(owner, id, vid);
    if (!v) return err('not_found', '버전을 찾을 수 없습니다.', 404);
    // 질문 계획 동결(WP-C8): 승인 시점의 주장 제외 목록을 스냅샷한다. 이후 변경은 재승인해야 세션에 반영된다.
    v.frozen_excluded_claim_ids = [...(v.excluded_claim_ids || [])];
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
    const institution = rebuildInstitution(p, profileId);
    return { status: 201, body: { added, institution, institution_status: 'review' } };
  }

  // 기관 프로필 재생성. official_verified 수집 결과만 공식 근거(발췌 원문)로 반영한다.
  function rebuildInstitution(p, profileId) {
    const ver = p.version_id ? store.getVersion(p.version_id) : null;
    const fetches = store.getSourceFetches(profileId);
    const sources = store.listSources(profileId).map((s) => {
      const f = fetches[s.id];
      return f?.status === 'official_verified' ? { ...s, kind: 'official', status: 'official_verified', quote: f.excerpts.map((x) => x.text).join('\n') } : s;
    });
    const institution = buildInstitutionProfile({
      orgType: normalizeOrgType(p.org_type), targetName: p.target_name, role: p.role,
      sources, claims: ver?.extracted?.claims || [], userNotes: (p.experiences || []).join('\n'),
    });
    store.setInstitution(profileId, institution, 'review');
    return institution;
  }

  // POST /profiles/:id/sources/:sid/fetch — 허용 도메인의 공식 자료만 서버가 수집(기본 비활성)
  async function fetchInstitutionSource(owner, profileId, sid) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const src = store.listSources(profileId).find((x) => x.id === sid);
    if (!src) return err('not_found', '출처를 찾을 수 없습니다. 먼저 출처를 등록하세요.', 404);
    const allow = parseAllowList(config.officialFetch.allow);
    if (!allow.length) return err('official_fetch_disabled', '공식 자료 자동 수집이 비활성화되어 있습니다.', 403);
    if (!src.url) return err('validation_error', 'URL이 없는 출처는 수집할 수 없습니다.', 422);
    const limited = checkRate(owner, 'fetch');
    if (limited) return limited;
    const others = Object.entries(store.getSourceFetches(profileId)).filter(([k, f]) => k !== sid && f.status !== 'unavailable').flatMap(([, f]) => f.kv || []);
    const result = await fetchOfficialSource(src, { allow, fetchFn: officialFetch.fetchFn, resolveDns: officialFetch.resolveDns, timeoutMs: config.officialFetch.timeoutMs, maxBytes: config.officialFetch.maxBytes, otherKv: others });
    store.setSourceFetch(profileId, sid, result);
    const institution = rebuildInstitution(p, profileId);
    const { text, kv, ...view } = result;
    return { status: 200, body: { source_id: sid, ...view, text_length: result.text_cp || 0, institution } };
  }

  function getInstitution(owner, profileId) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const inst = store.getInstitution(profileId);
    if (!inst) return err('not_found', '기관 분석이 없습니다. 먼저 공고를 분석하세요.', 404);
    return { status: 200, body: { profile_id: profileId, status: inst.status, approved_at: inst.approved_at || null, institution: inst.profile, sources: store.listSources(profileId) } };
  }

  // ---- 질문 계획·주장 제외(WP-C8) ----
  // 주장 id(claim-N)는 프로필 버전 안에서만 유일하므로 경로에 프로필 id를 함께 쓴다.
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  function claimsView(p, owner) {
    const cur = p.version_id ? store.getVersion(p.version_id) : null;
    if (cur && p.approved_version_id !== cur.id) syncDocClaims(owner, p, cur);
    const ex = new Set(cur?.excluded_claim_ids || []);
    const claims = (cur?.extracted?.applicant_claims || []).map((c) => ({ ...c, excluded: ex.has(c.id) }));
    const needs_reapproval = !!(p.approved_version_id === cur?.id && !sameSet(cur?.frozen_excluded_claim_ids || [], cur?.excluded_claim_ids || []));
    return { cur, claims, needs_reapproval };
  }
  function listClaims(owner, profileId) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const { claims, needs_reapproval } = claimsView(p, owner);
    return { status: 200, body: { profile_id: profileId, claims, needs_reapproval } };
  }
  function setClaimExcluded(owner, profileId, claimId, body) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    if (typeof body?.excluded !== 'boolean') return err('validation_error', 'excluded는 true/false여야 합니다.', 422);
    const { cur } = claimsView(p, owner);
    const claim = (cur?.extracted?.applicant_claims || []).find((c) => c.id === claimId);
    if (!claim) return err('not_found', '주장을 찾을 수 없습니다.', 404);
    const set = new Set(cur.excluded_claim_ids || []);
    if (body.excluded) set.add(claimId); else set.delete(claimId);
    cur.excluded_claim_ids = [...set];
    const view = claimsView(p, owner);
    return { status: 200, body: { profile_id: profileId, claim: view.claims.find((c) => c.id === claimId), needs_reapproval: view.needs_reapproval } };
  }
  // 승인된 버전이 있으면 그 동결 스냅샷으로, 없으면 현재(초안) 버전의 제외 목록으로 계획을 만든다.
  function getPlan(owner, profileId, query = {}) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const approved = p.approved_version_id ? store.getVersion(p.approved_version_id) : null;
    const version = approved || (p.version_id ? store.getVersion(p.version_id) : null);
    if (version && !approved) syncDocClaims(owner, p, version);
    const frozen = !!approved;
    const excluded = frozen ? (approved.frozen_excluded_claim_ids || []) : (version?.excluded_claim_ids || []);
    const duration = [5, 10, 15].includes(Number(query.duration_minutes)) ? Number(query.duration_minutes) : 15;
    const seedNum = (Number(query.seed) || 0) >>> 0;
    const institution = store.getInstitution(profileId)?.profile || null;
    const plan = planGeneralQuestions({ version, institution, orgType: p.org_type, trends, qCount: questionCountForDuration(duration), seedNum, excludedClaimIds: excluded });
    return { status: 200, body: { profile_id: profileId, version_id: version?.id || null, frozen, excluded_claim_ids: excluded, question_basis: plan.question_basis, questions: plan.questions.map(publicPlanItem) } };
  }

  return { createProfile, getProfile, approveProfile, addInstitutionSource, fetchInstitutionSource, getInstitution, listClaims, setClaimExcluded, getPlan };
}
