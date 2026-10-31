// 근거 확인: 핵심 역량·면접 형태(렌치로 직접 수정), 학교·전형 검색, 지원서 주장, 5단계 질문 계획. 서버 텍스트는 모두 esc().
import { $, esc, fmtDate, setError } from '../core/format.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { dialog } from '../core/dialog.js';
import { Stepper, StateBadge, EvidenceQuote } from '../ui/index.js';
import { FIXED, STAGE_LABEL, reasonCopy } from '../core/copy.js';

const GAP = { role: '본인 역할', result: '관찰된 결과', reason: '판단 기준', number: '수치·기록' };
const FORMATS = [['general', '일반 면접'], ['pressure', '압박 면접 (준비 중)', true], ['blind', '블라인드 면접 (준비 중)', true], ['personality', '인성 면접 (준비 중)', true], ['technical', '기술 면접 (준비 중)', true], ['situational', '상황 면접 (준비 중)', true]];
const WRENCH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
let ctx = { loading: true, busy: false, searching: false, detail: null, claims: null, plan: null };

const section = (id, title, body, tools = '') => `<section class="ev-sec" id="ev-${id}"><div class="ev-head"><h3>${esc(title)}</h3>${tools}</div><div class="ev-body">${body}</div></section>`;
const REFRESH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
// 같은 자료는 저장된 분석 결과를 재사용한다(비용 절감). 이 버튼은 저장본을 무시하고 다시 분석한다.
const refreshBtn = (id, label) => `<button class="icon-btn" type="button" id="${id}" aria-label="${label}" title="${label}"${ctx.busy || ctx.searching ? ' disabled' : ''}>${REFRESH}</button>`;
const wrench = (id) => `<button class="icon-btn" type="button" id="${id}" aria-label="직접 수정" title="직접 수정">${WRENCH}</button>`;

// 핵심 역량·인재상을 한 표로: 직접 입력한 항목이 먼저, 그 뒤 학교 자료에서 뽑은 인재상·역량(원문 인용 포함). 질문 계획의 '학업·전공 적합성' 단계가 이 표의 항목을 쓴다.
function competencies(inst) {
  const sa = inst?.school_analysis || {};
  const rows = [
    ...(inst?.custom_competencies || []).map((c) => ({ label: c.label, src: StateBadge('직접 입력', 'info'), quote: '' })),
    ...(sa.talent_traits || []).map((t) => ({ label: t.label, src: StateBadge('자료 원문', 'ok'), quote: t.quote !== t.label ? t.quote : '' })),
  ];
  // 분석·검색이 도는 동안에는 "검색 중…", 끝났는데도 없으면 직접 등록을 권한다.
  if (!rows.length && (ctx.busy || ctx.loading || ctx.searching)) return '<p class="fine" role="status">검색 중…</p>';
  if (!rows.length) return '<p class="missing" role="status">인재상·역량을 찾지 못했습니다. 직접 등록해 주세요. <button class="ghost small" type="button" id="compAddBtn">직접 등록</button></p>';
  return `<table class="ev-table"><thead><tr><th scope="col">역량·인재상</th><th scope="col">출처</th><th scope="col">원문 근거</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${r.src}</td><td>${r.quote ? `<q>${esc(r.quote)}</q>` : '<span class="meta">—</span>'}</td></tr>`).join('')}</tbody></table>`;
}

function formatBody(inst) {
  const custom = inst?.custom_interview_format;
  const quotes = (inst?.school_analysis?.interview_format || []).map((f) => `<li>${EvidenceQuote({ quote: f.quote })}</li>`).join('');
  return `<p><span class="val">연습 형태: 일반 면접</span> ${custom ? StateBadge('직접 선택', 'info') : ''}</p>${quotes ? `<ul class="claims">${quotes}</ul>` : ''}`;
}

// 검색 결과는 약관상 수정 없이 그대로 보여 준다. 방금 검색한 결과만 출처 링크·추천 검색어와 함께, 지난 기록은 텍스트만(링크는 저장하지 않음).
function searchBody(inst) {
  const fresh = ctx.lastSearch;
  const h = fresh || inst?.search_history?.[0];
  const btn = `<button class="ghost small" type="button" id="schoolSearchBtn"${ctx.searching ? ' disabled' : ''}>${ctx.searching ? '검색 중…' : h ? `${REFRESH} 다시 검색` : '학교·전형 검색'}</button>`;
  if (!h) return `<div class="actions">${btn}</div><p class="fine" id="searchNote" role="status">${esc(ctx.searching ? '학교·전형을 검색하는 중입니다…' : ctx.searchNote || '')}</p>`;
  const src = (fresh?.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('');
  return `<div class="actions">${btn}${StateBadge(FIXED.aiSearch, 'warn')}<span class="meta">${esc(fmtDate(h.searched_at))}${fresh ? '' : ' · 지난 기록'}</span></div>
    <p class="search-text">${esc(h.text)}</p>
    ${src ? `<ul class="plain source-list">${src}</ul>` : ''}
    ${fresh?.suggestions_html ? '<iframe class="search-suggestions" title="Google 검색 추천" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>' : ''}
    <p class="fine" id="searchNote" role="status">${esc(ctx.searchNote || '')}</p>`;
}

function claimsBody(serverClaims, ex) {
  const list = Array.isArray(serverClaims) ? serverClaims.filter((c) => !c.kind || c.kind === 'applicant_claim') : (ex.applicant_claims || []);
  if (!list.length) return '<p class="missing">경험·성과 문장을 찾지 못했습니다.</p>';
  return `<ul class="claims">${list.map((c) => `<li class="claim-item${c.excluded ? ' excluded' : ''}">${EvidenceQuote({ quote: c.quote, start: c.start_cp, end: c.end_cp })}${c.gaps?.length ? `<span class="meta">빠진 정보: ${c.gaps.map((g) => `<span class="tag">${esc(GAP[g] || g)}</span>`).join(' ')}</span>` : ''}${c.id != null && Array.isArray(serverClaims) ? `<label class="claim-toggle"><input type="checkbox" data-claim-exclude="${esc(String(c.id))}"${c.excluded ? ' checked' : ''} /> 제외</label>` : ''}</li>`).join('')}</ul>`;
}

function planBody(plan) {
  const st = plan?.stages || [];
  if (!st.length) return '<p class="missing">질문 계획을 만들지 못했습니다.</p>';
  return `<ol class="plan-list">${st.map((s) => `<li><span class="stage-chip">${esc(STAGE_LABEL[s.stage] || s.stage)}</span><span class="val">${esc(s.text)}</span>${s.evidence?.length ? `<span class="meta">근거: ${s.evidence.map((e) => esc(e.kind === 'application' ? `지원서 “${String(e.quote).slice(0, 30)}…”` : e.label)).join(', ')}</span>` : ''}</li>`).join('')}</ol>`;
}

function paint() {
  const { detail, claims, plan } = ctx;
  if (!detail) return;
  const ex = detail.current_version?.extracted || {};
  const inst = detail.institution || null;
  $('#evidenceBody').innerHTML = `${Stepper(['지원 정보', '근거 확인', '면접 준비'], 1)}
    <div class="ev-grid">
      ${section('comp', '핵심 역량·인재상', competencies(inst), `${refreshBtn('reanalyzeBtn', '다시 분석')}${wrench('editCompBtn')}`)}
      ${section('format', '면접 형태', formatBody(inst), wrench('editFormatBtn'))}
    </div>
    ${section('search', '학교·전형', `<p class="val">${esc([detail.school_name || detail.target_name, detail.department || detail.role, detail.track].filter(Boolean).join(' · '))}</p>${searchBody(inst)}`)}
    <div class="detail-row"><button class="ghost small detail-toggle" type="button" id="detailToggle" aria-expanded="${ctx.showDetail}" aria-controls="evDetail">${WRENCH} 세부 조정 · 지원서 근거와 질문 목록</button></div>
    <div id="evDetail"${ctx.showDetail ? '' : ' hidden'}>
      ${section('claims', '지원서에서 확인할 내용', claimsBody(claims, ex))}
      ${section('plan', '질문 계획', planBody(plan))}
    </div>
    ${ctx.needsReapproval ? '<p class="missing" role="status">내용이 바뀌어 다시 승인해야 합니다.</p>' : ''}`;
  const frame = $('#evidenceBody .search-suggestions');
  if (frame) frame.srcdoc = ctx.lastSearch.suggestions_html; // sandbox(스크립트 차단) 안에서만 렌더
  $('#approveBtn').disabled = !!(ctx.busy || ctx.loading);
}

const optional = (path) => api(path).catch(() => null);
async function refresh(id) {
  const [detail, cl, plan] = await Promise.all([api(`/profiles/${id}`), optional(`/profiles/${id}/claims`), optional(`/profiles/${id}/plan`)]);
  ctx.detail = detail; ctx.claims = Array.isArray(cl?.claims) ? cl.claims : null; ctx.plan = plan;
  ctx.needsReapproval = ctx.needsReapproval || !!cl?.needs_reapproval;
  state.sources = detail.sources || [];
  paint();
}

export async function renderEvidence(detail, created, { autoAnalyze = false } = {}) {
  ctx = { busy: false, loading: true, searching: false, showDetail: false, detail, claims: null, plan: null, needsReapproval: false };
  $('#evidenceState').textContent = '확인 필요';
  $('#evidenceState').className = 'state-badge warn';
  paint();
  const id = detail.id || created.id;
  if (autoAnalyze && !detail.school_analysis) {
    ctx.busy = true; paint();
    try { await api(`/profiles/${id}/school-analysis`, { method: 'POST', idempotent: true, body: {} }); } catch (err) { if (err.status !== 409) setError('#evidenceError', err.message); }
    ctx.busy = false;
  }
  await refresh(id).catch((err) => setError('#evidenceError', err.message));
  ctx.loading = false; paint();
  // 지원서 분석 직후 학교·전형 검색을 자동으로 한 번 한다(이미 검색한 기록이 있거나 서버가 꺼 두면 건너뜀). 결과는 읽기용이고 승인은 기다리지 않는다.
  if (autoAnalyze && !detail.institution?.search_history?.length) await runSearch();
}

async function editCompetencies() {
  const cur = (ctx.detail?.institution?.custom_competencies || []).map((c) => c.label).join('\n');
  const v = await dialog({ title: '핵심 역량·인재상 직접 입력', message: '한 줄에 하나, 최대 8개', label: '역량', value: cur, multiline: true, okText: '저장' });
  if (v === null) return;
  await saveCustom({ competencies: v.split('\n').map((s) => s.trim()).filter(Boolean) });
}
async function editFormat() {
  const v = await dialog({ title: '면접 형태 선택', label: '면접 형태', choices: FORMATS, value: ctx.detail?.institution?.custom_interview_format || 'general', okText: '저장' });
  if (v === null) return;
  await saveCustom({ interview_format: v });
}
async function saveCustom(body) {
  try {
    const r = await api(`/profiles/${state.profile.id}/customization`, { method: 'PATCH', idempotent: true, body });
    if (r.needs_reapproval) { ctx.needsReapproval = true; state.approved = false; }
    await refresh(state.profile.id);
  } catch (err) { setError('#evidenceError', err.message); }
}
async function reanalyze() {
  ctx.busy = true; paint();
  try { await api(`/profiles/${state.profile.id}/school-analysis`, { method: 'POST', idempotent: true, body: { refresh: true } }); await refresh(state.profile.id); } catch (err) { setError('#evidenceError', err.message); }
  ctx.busy = false; paint();
}
async function runSearch() {
  ctx.searching = true; paint();
  try {
    const r = await api(`/profiles/${state.profile.id}/school-search`, { method: 'POST', idempotent: true, body: {} });
    ctx.searching = false;
    if (r.status === 'ok') ctx.lastSearch = r.entry;
    await refresh(state.profile.id);
    if (r.status !== 'ok') { ctx.searchNote = reasonCopy(r.reason); paint(); }
  } catch (err) { ctx.searching = false; paint(); setError('#evidenceError', err.message); }
}

$('#evidenceBody')?.addEventListener('click', (e) => {
  if (!state.profile) return;
  if (e.target.closest('#editCompBtn, #compAddBtn')) editCompetencies();
  else if (e.target.closest('#reanalyzeBtn') && !ctx.busy) reanalyze();
  else if (e.target.closest('#editFormatBtn')) editFormat();
  else if (e.target.closest('#schoolSearchBtn') && !ctx.searching) runSearch();
  else if (e.target.closest('#detailToggle')) {
    ctx.showDetail = !ctx.showDetail; // 기본은 역량·면접 형태·학교·전형만. 렌치로 지원서 근거·질문 목록을 펼친다.
    $('#evDetail').hidden = !ctx.showDetail;
    $('#detailToggle').setAttribute('aria-expanded', String(ctx.showDetail));
  }
});

$('#evidenceBody')?.addEventListener('change', async (e) => {
  const cb = e.target.closest?.('[data-claim-exclude]');
  if (!cb) return;
  cb.disabled = true;
  try {
    const res = await api(`/profiles/${state.profile.id}/claims/${encodeURIComponent(cb.dataset.claimExclude)}`, { method: 'PATCH', idempotent: true, body: { excluded: cb.checked } });
    if (res?.needs_reapproval) ctx.needsReapproval = true;
    await refresh(state.profile.id);
  } catch (err) {
    cb.checked = !cb.checked;
    setError('#evidenceError', err.message);
  } finally { cb.disabled = false; }
});

$('#approveBtn')?.addEventListener('click', async () => {
  if (ctx.busy || ctx.loading || !state.profile) return;
  const btn = $('#approveBtn');
  btn.disabled = true;
  setError('#evidenceError', '');
  try {
    await api(`/profiles/${state.profile.id}/approve`, { method: 'POST', idempotent: true, body: { version_id: state.versionId } });
    state.approved = true;
    $('#evidenceState').textContent = '승인 완료';
    $('#evidenceState').className = 'state-badge ok';
    go('setup');
    toast('승인했습니다. 질문 계획이 확정됐습니다.');
  } catch (err) {
    setError('#evidenceError', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#evidenceBackBtn')?.addEventListener('click', () => go('application'));
