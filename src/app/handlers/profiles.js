// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID } from '../crypto.js';
import { detectPii, maskPii, buildBlindContext, extractClaims, verifyClaimSpan } from '../../domain/pii.js';
import { extractApplicantClaims, extractDocClaims, mergeModelClaims } from '../../domain/claims.js';
import { planGeneralQuestions, publicPlanItem } from '../../domain/plan.js';
import { questionCountForDuration } from '../../domain/interview-types.js';
import { normalizeSource } from '../../domain/sources.js';
import { isSyntheticProfileBody } from '../../domain/fixtures.js';
import { fetchOfficialSource, parseAllowList } from '../../domain/fetcher.js';
import { findSchool } from '../../domain/school-directory.js';
import { verifyAnalysis, ruleBasedAnalysis, buildUnconfirmed, mergeIntoInstitution } from '../../domain/school-analysis.js';
import { buildInstitutionProfile, normalizeOrgType, providerConstraintForOrg, isMinorPossible } from '../../domain/institution.js';
import { segmentOfOrg, trendCatalog, lookupTrends, TREND_MOCK_LABEL } from '../../domain/trend-mock.js';
import { validateDesignedQuestions, decideTrendUse, MODEL_MAX } from '../../domain/question-design.js';
import { QUESTIONS_PROMPT_VERSION } from '../../providers/prompts/questions.js';

// 데모 fixture 소스는 저장 형태(kind:'demo_fixture')를 유지하되 기관 프로필 규칙 분석에는 공식 자료처럼 넣는다.
const asBuildSource = (s) => (s.kind === 'demo_fixture' ? { ...s, kind: 'official' } : s);

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
    // 학교 입력(school_name/department/track)은 기존 target_name/role로 정규화해 기존 로직과 호환한다(기본 기관 구분은 대입).
    if (body.school_name) body.target_name = String(body.school_name);
    if (body.department) body.role = String(body.department);
    const orgType = normalizeOrgType(body.org_type || 'university');
    const mc = providerConstraintForOrg(orgType, { synthetic });
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
    // 학교 자동 탐색(데모 레지스트리만): 일치하면 합성 자료를 소스로 등록, 아니면 추측하지 않고 실패로 표시한다.
    let school_discovery = { status: 'not_requested' };
    if (body.school_name && ['university', 'highschool'].includes(orgType)) {
      const sch = findSchool(body.school_name, orgType);
      if (sch) {
        const t = now();
        const row = { id: randomUUID(), url: sch.official_url_demo, host: null, title: sch.title, publisher: sch.label, published_at: null, retrieved_at: t, confirmed_at: t, kind: 'demo_fixture', status: 'demo_fixture', quote: sch.text, owner_id: owner };
        store.addSource(profile.id, row);
        providedSources.push(row);
        school_discovery = { status: 'found', source_id: row.id, label: sch.label, school_name: sch.name };
      } else {
        school_discovery = { status: 'discovery_failed', message: '공식 자료를 찾지 못했습니다. 입학처 URL을 입력하거나 모집요강을 붙여넣어 주세요.' };
      }
    }
    const pubNotice = body.source_text && providedSources.length === 0
      ? null
      : (providedSources.length ? null : null);
    const masked = maskPii(source);
    const blind = buildBlindContext(masked);
    // 공고 키워드 추출: 공급자 라우팅·게이트·예산은 호출 래퍼가 처리한다(고교는 항상 Mock). 지원서 본문은 외부로 보내지 않는다.
    const ctx = requestContext(owner, { forceMock: !!body._forceMock });
    if (caller.plan('claims.extract', ctx).live && ctx.synthetic && detectPii(source).some((x) => x.type !== 'school')) { // 학교명은 모집요강의 공개 정보라 제외(가상 학교 fixture)
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
    const institution = { ...buildInstitutionProfile({
      orgType, targetName: body.target_name, role: body.role,
      sources: providedSources.map(asBuildSource), claims, userNotes: (body.experiences || []).join('\n'),
    }), school_discovery };
    store.setInstitution(profile.id, institution, 'review');
    void pubNotice;
    return { status: 201, body: { id: profile.id, version_id, status: 'review', pii_warnings: pii.map((x) => x.type), provider: usedProvider, synthetic, provider_trace: traces, applicant_claims_count: applicant_claims.length, institution, institution_status: 'review', school_discovery } };
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
        school_analysis: inst?.profile?.school_analysis || null,
        school_discovery: inst?.profile?.school_discovery || null,
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

  // 승인 시점 1회 질문 설계(09 §5.1·§4). 결과는 버전에 동결(v.plan)되고 세션 생성·GET plan이 같은 값을 쓴다.
  // 외부 호출은 서버 게이트가 연 경우(합성 fixture 또는 확인된 성인 실데이터)에만 일어난다. 막히면 호출 0건·규칙 기반 계획.
  async function designPlan(owner, p, v, inst) {
    const orgType = normalizeOrgType(p.org_type);
    const synthetic = p.synthetic === true;
    const ctx = requestContext(owner, { synthetic, forceMock: isMinorPossible(orgType) && !synthetic });
    const plan = { generator: 'rule', model_questions: [], provider_trace: [], trend: { used: false, lookup: false }, designed_at: now() };
    const gate = caller.plan('questions.design', ctx);
    if (!gate.live) { plan.provider_trace.push({ operation: gate.operation, provider: 'mock', mode: gate.mode, reason: gate.reason, model_alias: 'rule-based', latency_ms: null }); return plan; }
    const sa = inst?.school_analysis || {};
    const items = (arr, prefix) => (Array.isArray(arr) ? arr : []).slice(0, 8).map((t, i) => ({ id: t.id || `${prefix}-${i + 1}`, label: String(t.label || ''), quote: String(t.quote || '') })).filter((t) => t.quote);
    const schoolItems = [...items(sa.talent_traits, 'trait'), ...items(sa.admission_elements, 'elem')];
    const ex = new Set(v.frozen_excluded_claim_ids || []);
    const claims = (v.extracted?.applicant_claims || []).filter((c) => !ex.has(c.id)).map((c) => ({ id: c.id, quote: c.quote, gaps: c.gaps || [] }));
    if (!schoolItems.length && !claims.length) { plan.provider_trace.push({ operation: 'questions.design', provider: 'mock', mode: 'mock', reason: 'no_evidence', model_alias: 'rule-based', latency_ms: null }); return plan; }
    // 1) 트렌드 조회 필요 여부 판단. true+유효 id일 때만 Mock 본문을 조회한다(그 전에는 색인 id·태그만 본다). 막힘·실패·무효는 '사용 안 함'.
    const segment = segmentOfOrg(orgType);
    const yyyyMm = config.trendMockMonth || now().slice(0, 7);
    const catalog = segment ? trendCatalog(segment, yyyyMm) : null;
    let trendItems = [];
    if (catalog) {
      const dres = await caller.call('trends.decide', {
        ctx, mockAlias: 'rule-based', reserve: { key: `profile:${p.id}:trend`, amount: config.profileRate.reserve },
        invoke: (a) => a.decideTrend({ segment, yyyyMm, traitLabels: schoolItems.filter((x) => x.label).slice(0, 5).map((x) => x.label), claimLabels: claims.map((c) => [...c.quote].slice(0, 30).join('')), catalog }),
        mock: () => ({ use_trend: false, trend_ids: [], reason: 'mock' }),
        validate: (o) => typeof o?.use_trend === 'boolean',
      });
      plan.provider_trace.push(dres.trace);
      const dec = dres.trace.mode === 'live' ? decideTrendUse(dres.value, catalog) : { use_trend: false, trend_ids: [] };
      plan.trend = { used: false, lookup: false, decision: dec.use_trend, yyyyMm, segment };
      if (dec.use_trend) {
        const found = lookupTrends(segment, yyyyMm, dec.trend_ids);
        plan.trend.lookup = true; plan.trend.status = found.status;
        trendItems = found.items;
        plan.trend.used = trendItems.length > 0; plan.trend.label = TREND_MOCK_LABEL; plan.trend.ids = trendItems.map((x) => x.id);
      }
    } else plan.trend = { used: false, lookup: false, status: 'unavailable', yyyyMm, segment };
    // 2) 질문 설계. 서버가 질문 단위로 검증하고, 전부 폐기되면 규칙 기반 계획으로 남는다.
    const qres = await caller.call('questions.design', {
      ctx, mockAlias: 'rule-based', reserve: { key: `profile:${p.id}:qdesign`, amount: config.profileRate.reserve },
      invoke: (a) => a.designQuestions({ department: p.role || '', schoolItems, claims, trendItems, count: MODEL_MAX }),
      mock: () => ({ questions: [] }),
      validate: (o) => Array.isArray(o?.questions),
    });
    plan.provider_trace.push(qres.trace);
    if (qres.trace.mode !== 'live') return plan;
    const evidence = [...schoolItems.map((x) => ({ id: x.id, text: `${x.label} ${x.quote}` })), ...claims.map((c) => ({ id: c.id, text: c.quote })), ...trendItems.map((t) => ({ id: t.id, text: `${t.title} ${t.summary}` }))];
    const { questions, dropped } = validateDesignedQuestions(qres.value, evidence, { promptVersion: QUESTIONS_PROMPT_VERSION, extraText: String(p.role || '') });
    plan.dropped_model_questions = dropped;
    plan.model_questions = questions.map((q) => ({ ...q, provider_trace: qres.trace, ...(q.trend_ids.length ? { trend_label: TREND_MOCK_LABEL } : {}) }));
    if (plan.model_questions.length) plan.generator = 'gemini';
    if (!plan.model_questions.some((q) => q.trend_ids.length)) { plan.trend.used = false; plan.trend.ids = []; }
    return plan;
  }

  async function approveProfile(owner, id, body) {
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
    v.plan = await designPlan(owner, p, v, approvedInst);
    return { status: 200, body: { id: v.id, profile_id: id, status: 'approved', approved_at: v.approved_at, institution_status: approvedInst ? 'approved' : null, plan: { generator: v.plan.generator, model_question_count: v.plan.model_questions.length, trend_used: v.plan.trend.used, provider_trace: v.plan.provider_trace } } };
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
      return f?.status === 'official_verified' ? { ...s, kind: 'official', status: 'official_verified', quote: f.excerpts.map((x) => x.text).join('\n') } : asBuildSource(s);
    });
    const prev = store.getInstitution(profileId)?.profile;
    const institution = { ...buildInstitutionProfile({
      orgType: normalizeOrgType(p.org_type), targetName: p.target_name, role: p.role,
      sources, claims: ver?.extracted?.claims || [], userNotes: (p.experiences || []).join('\n'),
    }), ...(prev?.school_discovery ? { school_discovery: prev.school_discovery } : {}), ...(prev?.school_analysis ? { school_analysis: prev.school_analysis } : {}) };
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

  // POST /profiles/:id/school-analysis — 등록·수집된 소스 본문(+붙여넣은 source_text)에서 인재상·전형요소·면접 형식을 뽑는다(docs/plan/09 §3.3).
  // 외부 전송은 서버가 신뢰하는 합성 본문(데모 레지스트리·fixture 일치 본문)일 때만 게이트를 통과한다. 그 밖에는 규칙 기반이다.
  async function analyzeSchool(owner, profileId, body = {}) {
    const p = store.getProfile(owner, profileId);
    if (!p) return err('not_found', '프로필을 찾을 수 없습니다.', 404);
    const t = now();
    const fetches = store.getSourceFetches(profileId);
    const segments = []; const used = [];
    for (const s of store.listSources(profileId)) {
      const f = fetches[s.id];
      const text = s.kind === 'demo_fixture' ? s.quote : f?.status === 'official_verified' ? (f.text || f.excerpts.map((x) => x.text).join('\n')) : s.quote;
      const clean = String(text || '').normalize('NFC').trim();
      if (clean.length < 2) continue;
      segments.push({ id: s.id, title: s.title, text: clean, trusted: s.kind === 'demo_fixture' });
      used.push(s);
    }
    const override = typeof body.source_text === 'string' && body.source_text.trim() ? body.source_text : null;
    const pastedRaw = maskPii(String(override ?? p.source_text ?? '')).normalize('NFC').trim().slice(0, 20000);
    if (pastedRaw.length >= 2 && !segments.some((s) => s.text === pastedRaw)) segments.push({ id: 'pasted', title: '붙여넣은 모집요강', text: pastedRaw, trusted: !override && p.synthetic === true });
    if (!segments.length) return err('conflict', '분석할 자료가 없습니다. 입학처 URL을 입력하거나 모집요강을 붙여넣어 주세요.', 409);
    for (const s of used) s.confirmed_at = t; // 서버가 분석에 사용한 시점
    const synthetic = segments.every((s) => s.trusted);
    const mc = providerConstraintForOrg(p.org_type, { synthetic });
    const ctx = requestContext(owner, { forceMock: mc.forceMock, synthetic });
    const sourceText = segments.map((s) => s.text).join('\n\n');
    const res = await caller.call('school.analyze', {
      ctx, mockAlias: 'rule-based',
      reserve: { key: `school:${profileId}`, amount: config.profileRate.reserve },
      invoke: (a) => a.analyzeSchool({ sourceText }),
      mock: () => null,
      validate: (o) => !!o && ['talent_traits', 'admission_elements', 'interview_format'].every((k) => Array.isArray(o[k]) && o[k].length <= 30),
    });
    let mode = res.trace.mode === 'live' ? 'gemini' : 'rule_based';
    let verified = mode === 'gemini' ? verifyAnalysis(res.value, segments) : null;
    // 모델 결과가 전부 검증에서 탈락하면 규칙 기반으로 되돌린다.
    if (verified && !verified.talent_traits.length && !verified.admission_elements.length && !verified.interview_format.length) { verified = null; mode = 'rule_based'; res.trace.degraded_reason = 'no_verified_quotes'; }
    if (!verified) verified = verifyAnalysis(ruleBasedAnalysis(segments), segments);
    const { dropped, ...cats } = verified;
    const analysis = {
      ...cats,
      unconfirmed: buildUnconfirmed(cats, mode === 'gemini' ? res.value.unconfirmed : []),
      sources: segments.map((s) => { const r = used.find((u) => u.id === s.id); return r ? { id: r.id, url: r.url, title: r.title, kind: r.kind, status: r.status, retrieved_at: r.retrieved_at, confirmed_at: t, published_at: r.published_at || null } : { id: s.id, url: null, title: s.title, kind: 'user', status: 'user_supplied', retrieved_at: t, confirmed_at: t, published_at: null }; }),
      analysis_mode: mode, analyzed_at: t, provider_trace: [res.trace],
      ...(mode === 'gemini' && dropped ? { rejected_quotes: dropped } : {}),
    };
    const inst = store.getInstitution(profileId)?.profile || rebuildInstitution(p, profileId);
    const sourcesById = Object.fromEntries(analysis.sources.map((s) => [s.id, s]));
    store.setInstitution(profileId, mergeIntoInstitution(inst, analysis, sourcesById), 'review');
    return { status: 200, body: { profile_id: profileId, ...analysis, institution_status: 'review' } };
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
    const plan = planGeneralQuestions({ version, institution, orgType: p.org_type, trends, qCount: questionCountForDuration(duration), seedNum, excludedClaimIds: excluded, modelQuestions: approved?.plan?.model_questions || [] });
    return { status: 200, body: { profile_id: profileId, version_id: version?.id || null, frozen, excluded_claim_ids: excluded, question_basis: plan.question_basis, generator: plan.questions.some((q) => q.generator === 'gemini') ? 'gemini' : 'rule', questions: plan.questions.map(publicPlanItem) } };
  }

  return { createProfile, analyzeSchool, getProfile, approveProfile, addInstitutionSource, fetchInstitutionSource, getInstitution, listClaims, setClaimExcluded, getPlan };
}
