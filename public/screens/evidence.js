import { $, basisTag, esc, fmtDate, setError } from '../core/format.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { updateSetupSummary } from './setup.js';
import { Stepper, SourceChip, StateBadge, EvidenceQuote } from '../ui/index.js';
import { FIXED, SOURCE_STATUS } from '../core/copy.js';

const GAP = { role: '본인 역할', result: '관찰된 결과', reason: '판단 기준', number: '수치·기록' };
const FRESH_NOTE = { stale: '발행·확인일이 오래되었습니다(365일 초과 등). 최신 여부를 직접 확인하세요.', unavailable: '수집하지 못했습니다. 이 출처는 근거로 쓰지 않습니다.' };
let ctx = { busy: false, detail: null, claims: null, plan: null, trend: null, provider: '' };

// 서버 텍스트는 모두 esc()를 거친다. 섹션은 <details>(모바일 아코디언).
const section = (id, title, body, open = true) => `<details class="ev-sec" id="ev-${id}"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="ev-body">${body}</div></details>`;
const chipFor = (s, f) => {
  const st = s.status || f?.state;
  if (st === 'demo_fixture' || s.kind === 'demo_fixture') return 'demo_fixture';
  if (['stale', 'unavailable', 'conflict', 'monthly_trend'].includes(st)) return st;
  if (s.kind === 'user' || s.kind === 'assumed') return 'user_supplied';
  return 'unverified'; // 수집기 전에는 official_verified가 나올 수 없다
};
const NO_CLAIM_HINT = '제외하지 않은 주장이 없으면 일반 질문으로 진행합니다.';

function claimItem(c, canToggle) {
  const gaps = c.gaps?.length ? `문장에 없는 정보: ${c.gaps.map((g) => `<span class="tag">${esc(GAP[g] || g)}</span>`).join(' ')}` : '역할·결과·기준·수치가 문장에 모두 있음';
  const toggle = canToggle && c.id != null
    ? `<label class="claim-toggle"><input type="checkbox" data-claim-exclude="${esc(String(c.id))}"${c.excluded ? ' checked' : ''} /> 이 질문에서 제외</label>` : '';
  return `<li class="claim-item${c.excluded ? ' excluded' : ''}">${EvidenceQuote({ quote: c.quote, start: c.start_cp, end: c.end_cp })}<span class="tag user">지원서 주장</span><span class="meta">${gaps}</span>${toggle}</li>`;
}

function claimsSection(ex, serverClaims) {
  const canToggle = Array.isArray(serverClaims);
  const list = canToggle ? serverClaims.filter((c) => !c.kind || c.kind === 'applicant_claim') : (ex.applicant_claims || []);
  let body;
  if (!ex.application_chars && !list.length) body = '<p class="fine">지원서를 입력하지 않아 지원서 주장 기반 질문은 만들지 않습니다.</p>';
  else if (!list.length) body = '<p class="missing">경험·성과 서술 문장을 찾지 못했습니다. 일반 질문으로 진행합니다.</p>';
  else body = `<ul class="claims">${list.map((c) => claimItem(c, canToggle)).join('')}</ul><p class="fine">${esc(FIXED.noLieJudge)}. 문장에 근거가 적혀 있는지 보고 빠진 정보를 묻습니다.</p>`;
  return section('claims', '지원서 주장·공백 (규칙 기반)', body);
}

function sourcesSection(inst, sources) {
  const fresh = new Map((inst?.sources_summary?.freshness || []).map((f) => [f.title || f.url, f]));
  const cards = (sources || []).map((s) => {
    const f = fresh.get(s.title) || fresh.get(s.url) || {};
    const note = FRESH_NOTE[f.state] || f.note || '';
    return `<li><span class="val">${esc(s.title || s.url || '출처')}</span>${SourceChip(chipFor(s, f))}<span class="meta">${esc(s.url || 'URL 미확인')}${s.published_at ? ` · 발행 ${esc(s.published_at)}` : ' · 발행일 미확인'}${s.retrieved_at ? ` · 확인 ${esc(String(s.retrieved_at).slice(0, 10))}` : ''}${note ? ` · ${esc(note)}` : ''}</span></li>`;
  }).join('');
  const conflicts = (inst?.sources_summary?.conflicts || []).map((c) => `<li><span class="val">${esc(c.key)}</span>${SourceChip('conflict')}<span class="meta">서로 다른 값 ${esc(String(c.count))}건 — 어느 쪽도 사실로 단정하지 않고 해당 항목은 보류합니다.</span></li>`).join('');
  const body = `${cards ? `<ul class="claims">${cards}</ul>` : '<p class="hint">등록된 출처가 없습니다. 일반 기준으로 연습합니다.</p>'}${conflicts ? `<h4>출처 충돌 경고</h4><ul class="claims">${conflicts}</ul>` : ''}<p class="fine">현재는 서버가 공식 도메인을 자동 수집하지 않아 “공식 자료 확인” 상태가 표시되지 않습니다. 입력한 URL은 확인되지 않은 자료로 취급합니다.</p>`;
  return section('sources', '공식·출처', body, !!(cards || conflicts));
}

function valuesSection(ex, inst) {
  const li = (arr, f) => (arr || []).map(f).join('');
  const kw = li(ex.claims, (c) => `<li><span class="val">${esc(c.value)}</span><span class="tag user">공고 키워드</span><span class="meta">출처: “${esc(c.quote || c.value)}” · 원문 위치 ${esc(String(c.start_cp))}–${esc(String(c.end_cp))}</span></li>`)
    || '<li><span class="val">확인된 기관 고유 역량 없음</span><span class="tag">일반 기준</span><span class="meta">공고가 없거나 추출하지 못했습니다. 일반 역량으로 연습하며 “기관 맞춤 검증 완료” 배지는 표시하지 않습니다.</span></li>';
  const missing = (ex.missing_fields || []).map((f) => ({ discussion_format: '토론면접 여부', interview_duration: '면접 시간', participant_count: '참여 인원', extraction_failed: '공고 분석(일반 기준 사용)' }[f] || f));
  const values = li(inst?.core_values, (c) => `<li><span class="val">${esc(c.label)}</span>${basisTag(c.basis)}<span class="meta">${c.source_quote ? `근거: “${esc(c.source_quote)}”${c.source_title ? ` · ${esc(c.source_title)}` : ''}` : esc(c.note || '일반 역량으로 연습합니다.')}</span></li>`);
  const formats = li(inst?.formats, (f) => `<li><span class="val">${esc(f.item)}</span>${basisTag(f.basis)}<span class="meta">${esc(f.note || '')}</span></li>`);
  const evaluable = li(inst?.evaluable, (x) => `<li><span class="val">${esc(x.label)}</span>${basisTag(x.basis)}</li>`) + li(inst?.unevaluable, (u) => `<li><span class="val">${esc(u.area)} — 평가하지 않음</span><span class="tag">평가 불가</span><span class="meta">${esc(u.reason)}</span></li>`);
  const head = inst ? `<div class="inst-head"><strong>${esc(inst.org_label || '')} · ${esc(inst.target_name || '기관 미지정')} · ${esc(inst.role || '직무·학과 미지정')}</strong><span class="tag ${inst.fallback_to_general ? '' : 'official'}">${esc(inst.badge || '')}</span></div>` : '<p class="hint">기관 분석 결과가 없습니다. 일반 기준으로 연습합니다.</p>';
  const body = `${head}<h4>공고 키워드</h4><ul class="claims">${kw}</ul>${values ? `<h4>핵심 가치·요구 역량</h4><ul class="claims">${values}</ul>` : ''}${formats ? `<h4>면접 형식·전형 조건</h4><ul class="claims">${formats}</ul>` : ''}${evaluable ? `<h4>평가 가능한 영역 / 불가 영역</h4><ul class="claims">${evaluable}</ul>` : ''}${missing.length ? `<p class="missing">확인되지 않음: ${missing.map(esc).join(', ')} — 연습 가정으로 진행합니다.</p>` : ''}${ex.rejected_spans ? `<p class="missing">출처 구간이 일치하지 않는 ${esc(String(ex.rejected_spans))}건은 제외했습니다.</p>` : ''}<p class="fine">기관의 비공개 채점기준을 아는 것처럼 표현하지 않습니다. ${esc(inst?.disclaimer || '')}</p>`;
  return section('values', '공고 키워드·핵심 가치', body);
}

// ---- 학교 분석(spec 09 §3): 인재상·전형 요소·면접 형식(원문 인용) + 출처 상태·확인 시점 + 확인되지 않은 정보 ----
const SA_STATUS_NOTE = { fetch_disabled: '자동 수집이 꺼져 있어 가져오지 못했습니다. 모집요강을 붙여넣어 주세요.', unavailable: '수집하지 못했습니다.' };
function saGroup(title, items) {
  if (!items?.length) return '';
  return `<h4>${esc(title)}</h4><ul class="claims">${items.map((x) => `<li><span class="val">${esc(x.label || '')}</span><span class="tag user">${esc(x.id || '')}</span>${EvidenceQuote({ quote: x.quote, title: '원문 인용' })}</li>`).join('')}</ul>`;
}
function schoolSection(sa, busy) {
  const btn = `<button class="ghost small" type="button" id="schoolAnalyzeBtn"${busy ? ' disabled' : ''}>${busy ? '분석 중…' : sa ? '학교 분석 다시 하기' : '학교 분석 실행'}</button>`;
  if (!sa) return section('school', '학교 분석', `<p class="hint">아직 학교 분석 결과가 없습니다. 학교 분석을 실행하면 모집요강에서 인재상·전형 요소를 찾아 원문과 함께 보여 줍니다.</p><div class="actions">${btn}</div><p class="fine">${esc(FIXED.unconfirmedNoGuess)}.</p>`);
  const mode = sa.analysis_mode === 'llm' ? StateBadge('Gemini 분석', 'info', '✦') : StateBadge('규칙 기반', 'neutral', '≡');
  const srcs = (sa.sources || []).map((s) => `<li><span class="val">${esc(s.title || s.url || '출처')}</span>${SourceChip(chipFor(s, {}))}<span class="meta">${esc(s.url || 'URL 없음')} · 확인 시점 ${esc(fmtDate(s.confirmed_at))}${SA_STATUS_NOTE[s.status] ? ` · ${esc(SA_STATUS_NOTE[s.status])}` : ''}</span></li>`).join('');
  const unc = (sa.unconfirmed || []).map((u) => `<li><span class="val">${esc(u)}</span>${SourceChip('unverified')}</li>`).join('');
  const body = `<div class="inst-head">${mode}<span class="meta">분석 시점 ${esc(fmtDate(sa.analyzed_at))}</span>${btn}</div>
    ${saGroup('인재상', sa.talent_traits)}${saGroup('전형 요소', sa.admission_elements)}${saGroup('면접 형식', sa.interview_format)}
    <h4>자료 출처와 확인 시점</h4>${srcs ? `<ul class="claims">${srcs}</ul>` : '<p class="missing">공식 자료를 찾지 못했습니다. 입학처 URL을 입력하거나 모집요강을 붙여넣어 주세요.</p>'}
    <h4>확인되지 않은 정보</h4>${unc ? `<ul class="claims">${unc}</ul>` : '<p class="fine">표시할 미확인 항목이 없습니다.</p>'}
    <p class="fine">${esc(FIXED.unconfirmedNoGuess)}. 인용은 원문에서 확인된 문장만 사용합니다.</p>`;
  return section('school', '학교 분석', body);
}

function trendSection(t) {
  const items = t?.status === 'monthly_trend' ? (t.items || []).slice(0, 3) : [];
  const body = items.length
    ? `<ul class="claims">${items.map((i) => `<li><span class="val">${esc(i.competency || i.label || '')}</span>${SourceChip('monthly_trend')}<span class="meta">${esc(i.comment || '')}</span></li>`).join('')}</ul><p class="fine">기관 공식 요구가 아닌 관리자 검수 보조 자료입니다.</p>`
    : '<p class="hint">승인된 월간 역량이 없습니다. 일반 기준으로 연습합니다.</p>';
  return section('trend', SOURCE_STATUS.monthly_trend.label, body, items.length > 0);
}

const planBasis = (q) => [
  q.target_competency ? `역량: ${q.target_competency}` : '',
  q.application_evidence_ids?.length ? `지원서 주장 ${q.application_evidence_ids.length}건` : '',
  q.institution_evidence_ids?.length ? `기관 요구 ${q.institution_evidence_ids.length}건` : '',
  q.trend_ids?.length ? `월간 트렌드 ${q.trend_ids.length}건` : '',
].filter(Boolean).join(' · ') || '일반 기준';

function planSection(plan) {
  const qs = plan.questions || plan.items || [];
  const body = qs.length
    ? `<ol class="plan-list">${qs.map((q) => `<li><span class="val">${esc(q.text || '')}</span>${q.source_status ? SourceChip(q.source_status) : ''}<span class="meta">${esc(planBasis(q))}${q.generator ? ` · 생성: ${q.generator === 'gemini' ? 'Gemini' : '규칙 기반'}` : ''}</span></li>`).join('')}</ol>${qs.some((q) => q.source_status === 'monthly_trend_mock') ? '<p class="fine">월간 트렌드(Mock · 보조)는 학교의 공식 요구가 아닙니다.</p>' : ''}`
    : '<p class="hint">미리볼 질문 계획이 없습니다. 일반 질문으로 진행합니다.</p>';
  return section('plan', '질문 계획 미리보기', body, false);
}

function paintReapprove() {
  $('#evReapprove')?.remove();
  if (!ctx.needsReapproval) return;
  $('#evidenceBody').insertAdjacentHTML('afterbegin', '<p class="missing" id="evReapprove" role="status">주장 제외 설정이 바뀌어 다시 승인해야 합니다. 아래에서 “이 내용으로 승인”을 눌러 주세요.</p>');
}

function paint() {
  const { detail, claims, plan, trend } = ctx;
  const ex = detail.current_version?.extracted || {};
  const inst = detail.institution || null;
  $('#evidenceBody').innerHTML = `${Stepper(['지원 정보', '근거 확인', '면접 설정'], 1)}
    ${schoolSection(detail.school_analysis || null, ctx.busy)}${claimsSection(ex, claims)}${sourcesSection(inst, detail.sources || [])}${valuesSection(ex, inst)}${trendSection(trend)}${plan ? planSection(plan) : ''}
    <p class="fine">분석 공급자: ${esc(ctx.provider || 'mock')} · 승인 전에는 면접을 시작할 수 없습니다.</p>`;
  const box = $('#institutionBody');
  if (box) box.innerHTML = '';
  paintReapprove();
  $('#approveBtn').title = claims?.length && claims.every((c) => c.excluded) ? NO_CLAIM_HINT : '';
}

// 404(미구현 서버) 등은 null → 해당 섹션/토글을 숨기고 화면은 계속 동작한다.
const optional = (path) => api(path).catch(() => null);

async function runSchoolAnalysis(id, quiet = false) {
  ctx.busy = true; paint();
  try {
    await api(`/profiles/${id}/school-analysis`, { method: 'POST', body: {} });
    ctx.detail = await api(`/profiles/${id}`);
    ctx.plan = await optional(`/profiles/${id}/plan`);
    state.sources = ctx.detail.sources || [];
  } catch (err) {
    if (!(quiet && [404, 405, 422].includes(err.status))) setError('#evidenceError', err.status === 404 ? '이 서버에서는 학교 분석을 사용할 수 없습니다.' : err.message);
  } finally { ctx.busy = false; paint(); }
}

export async function renderEvidence(detail, created, { autoAnalyze = false } = {}) {
  ctx = { busy: false, detail, claims: null, plan: null, trend: null, provider: created.provider, needsReapproval: false };
  $('#evidenceState').textContent = '확인 필요';
  $('#evidenceState').className = 'state-badge warn';
  paint();
  const id = detail.id || created.id;
  const seg = detail.org_type || state.profile?.org_type || (state.journey === 'highschool' ? 'highschool' : 'university');
  const ym = new Date().toISOString().slice(0, 7);
  const [cl, plan, trend] = await Promise.all([optional(`/profiles/${id}/claims`), optional(`/profiles/${id}/plan`), optional(`/trends/${seg}/${ym}`)]);
  ctx.claims = Array.isArray(cl) ? cl : Array.isArray(cl?.claims) ? cl.claims : null;
  ctx.needsReapproval = !!cl?.needs_reapproval;
  ctx.plan = plan;
  ctx.trend = trend;
  paint();
  // 프로필 생성 직후 한 번 자동 실행(엔드포인트가 없으면 404 → 조용히 건너뜀).
  // 기능 감지: 서버가 school_analysis 키를 응답에 포함할 때만(null 포함) 자동 실행한다. 미구현 서버로는 요청을 보내지 않는다.
  if (autoAnalyze && 'school_analysis' in detail && !detail.school_analysis) {
    await runSchoolAnalysis(id, true);
  }
}

$('#evidenceBody')?.addEventListener('click', (e) => {
  if (e.target.closest?.('#schoolAnalyzeBtn') && state.profile && !ctx.busy) runSchoolAnalysis(state.profile.id);
});

$('#evidenceBody')?.addEventListener('change', async (e) => {
  const cb = e.target.closest?.('[data-claim-exclude]');
  if (!cb) return;
  cb.disabled = true;
  try {
    const res = await api(`/profiles/${state.profile.id}/claims/${encodeURIComponent(cb.dataset.claimExclude)}`, { method: 'PATCH', body: { excluded: cb.checked } });
    if (res?.needs_reapproval) ctx.needsReapproval = true;
    const c = ctx.claims?.find((x) => String(x.id) === cb.dataset.claimExclude);
    if (c) c.excluded = cb.checked;
    cb.closest('li')?.classList.toggle('excluded', cb.checked);
    paintReapprove();
    $('#approveBtn').title = ctx.claims.every((x) => x.excluded) ? NO_CLAIM_HINT : '';
  } catch (err) {
    cb.checked = !cb.checked;
    setError('#evidenceError', err.message);
  } finally { cb.disabled = false; }
});

$('#approveBtn')?.addEventListener('click', async () => {
  if (!state.profile) {
    state.approved = true;
    updateSetupSummary();
    go('setup');
    return;
  }
  const btn = $('#approveBtn');
  btn.disabled = true;
  setError('#evidenceError', '');
  try {
    const note = ($('#evidenceNote')?.value || '').trim();
    await api(`/profiles/${state.profile.id}/approve`, {
      method: 'POST', idempotent: true,
      body: { version_id: state.versionId, institution_edits: note ? { note } : {} },
    });
    state.approved = true;
    $('#evidenceState').textContent = '승인 완료';
    $('#evidenceState').className = 'state-badge ok';
    updateSetupSummary();
    go('setup');
    toast('이 내용으로 승인했습니다. 면접을 설정하세요.');
  } catch (err) {
    setError('#evidenceError', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#evidenceBackBtn')?.addEventListener('click', () => go('application'));
