// Intervu SPA — 9화면 (대시보드 · 지원 정보 · 근거 확인 · 설정 · 면접실 · 피드백 · 재연습 · 기록 · 관리자)
// 의존성 없음. 서버 API(/api/v1)만 사용하며 AI 키는 브라우저에 존재하지 않는다.

const TOKEN_KEY = 'intervu.token';
const ADMIN_KEY = 'intervu.admin';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || 'dev-user-a-token',
  screen: 'dashboard',
  journey: null,            // 'company' | 'university'
  profile: null,
  versionId: null,
  sources: [],
  approved: false,
  session: null,            // { id, version }
  flow: 'interview',        // 'interview' | 'repractice' | 'review'
  transfer: null,           // practice-attempts 응답
  comparison: null,
  lastReport: null,
  questionCount: 0,
  questionTotal: 1,
  timer: null,
  paused: false,
  endAt: 0,
  pausedAt: 0,
  catalog: { types: [], roles: [], topics: [], pt_tasks: [], scenarios: [] },
  stt: null,
  adminToken: sessionStorage.getItem(ADMIN_KEY) || '',
  adminRequired: null,
  adminUnlocked: false,
  uploadedText: '',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4600);
}

async function api(path, { method = 'GET', body, idempotent = false, admin = false } = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotent) headers['Idempotency-Key'] = uuid();
  if (admin && state.adminToken) headers['x-admin-token'] = state.adminToken;
  const res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `요청을 처리하지 못했습니다 (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

// ---- 대화상자 (prompt/confirm 대체) ----
function dialog({ title, message = '', label = '', value = '', multiline = false, okText = '확인', danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    if (!dlg) return resolve(null);
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    $('#confirmMessage').hidden = !message;
    const wrap = $('#confirmInputWrap');
    const input = $('#confirmInput');
    const area = $('#confirmText');
    wrap.hidden = !label;
    if (label) $('#confirmInputLabel').textContent = label;
    input.hidden = multiline;
    area.hidden = !multiline;
    if (multiline) area.value = value; else input.value = value;
    const ok = $('#confirmOk');
    const cancel = $('#confirmCancel');
    ok.textContent = okText;
    ok.className = danger ? 'danger' : 'primary';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      dlg.close();
      resolve(val);
    };
    dlg.addEventListener('close', () => { if (!settled) { settled = true; resolve(null); } }, { once: true });
    ok.onclick = (e) => {
      e.preventDefault();
      if (!label) return done('ok');
      const v = (multiline ? area.value : input.value).trim();
      return done(v || null);
    };
    cancel.onclick = (e) => { e.preventDefault(); done(null); };
    dlg.showModal();
    setTimeout(() => { try { (multiline ? area : input).focus(); } catch { /* noop */ } }, 30);
  });
}
const askConfirm = async (title, message, opts = {}) => (await dialog({ title, message, ...opts })) === 'ok';
const askInput = (title, message, label, value = '', multiline = false) => dialog({ title, message, label, value, multiline });

// ---- 공통 표시 ----
const DIM_LABEL = {
  relevance: '질문 적합성',
  evidence_specificity: '경험·근거 구체성',
  reasoning: '논리·판단',
  reflection: '성찰·전이',
  concept_clarity: '개념 설명 명확성',
  applicability: '적용·실행 계획',
  claim_understanding: '주장 이해',
  evidence_use: '근거 활용',
  rebuttal: '반박',
  collaboration: '협의 과정',
  structure: '구성',
  execution_plan: '실행 계획',
  qa_response: '질의응답',
  role_understanding: '역할 이해',
  responsiveness: '상황 대응',
};
const dimLabel = (id) => DIM_LABEL[id] || id;
const TYPE_LABEL = {
  general: '일반·인성', technical: '직무·기술', discussion: '토론', pt: 'PT', situational: '상황·역할극', panel: '패널',
};
const typeLabel = (id) => TYPE_LABEL[id] || id || '일반·인성';

const SCREENS = ['dashboard', 'application', 'evidence', 'setup', 'room', 'feedback', 'repractice', 'history', 'admin'];

function setError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function go(name) {
  if (!SCREENS.includes(name)) name = 'dashboard';
  if (location.hash !== `#/${name}`) {
    location.hash = `#/${name}`;
    return;
  }
  renderScreen(name);
}

function renderScreen(name) {
  state.screen = name;
  SCREENS.forEach((s) => {
    const el = $(`#screen-${s}`);
    if (el) el.hidden = s !== name;
  });
  $$('.navbtn').forEach((b) => {
    const active = b.dataset.go === name;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (name === 'dashboard') loadRecent();
  if (name === 'history') { loadHistory(); loadProvider(); loadTrendLookup(); }
  if (name === 'admin') initAdmin();
  if (name === 'feedback' && state.lastReport) renderReport(state.lastReport);
  if (name === 'repractice') renderRepractice();
  if (name === 'room' && !state.session) go('dashboard');
  const heading = $(`#screen-${name} h1`);
  if (heading) { heading.setAttribute('tabindex', '-1'); try { heading.focus({ preventScroll: true }); } catch { /* noop */ } }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

window.addEventListener('hashchange', () => {
  const name = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  renderScreen(SCREENS.includes(name) ? name : 'dashboard');
});

$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

// 이용 안내 패널
$('#helpBtn')?.addEventListener('click', () => {
  const panel = $('#helpPanel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#helpBtn').setAttribute('aria-expanded', String(open));
});
$('#helpCloseBtn')?.addEventListener('click', () => {
  $('#helpPanel').hidden = true;
  $('#helpBtn').setAttribute('aria-expanded', 'false');
});

// ---- 공급자 상태 ----
function providerLabel(p) {
  if (!p) return '상태 확인 실패';
  if (p.selected === 'gemini') return p.freeOnly === false ? 'Gemini 연결됨' : 'Gemini 연결 · 무료 전용';
  return 'Mock 모드 · 외부 전송 없음';
}

async function loadProvider() {
  try {
    const h = await api('/health');
    const provider = h.provider || {};
    state.adminRequired = !!provider.adminRequired;
    const chip = $('#modeChip');
    if (chip) {
      chip.textContent = providerLabel(provider);
      chip.dataset.mode = provider.selected === 'gemini' ? 'live' : 'mock';
      chip.title = provider.note || (provider.selected === 'gemini' ? 'Gemini API (서버 전용 키)' : '외부 AI 호출 없이 규칙 기반으로 동작합니다.');
    }
    const detail = $('#providerDetail');
    if (detail) {
      const bits = [
        provider.selected === 'gemini'
          ? `현재 공급자: Gemini (${provider.textModel || '모델 미확인'})`
          : '현재 공급자: Mock — 외부 AI 전송 없음, 규칙 기반 참고 관찰',
        provider.killSwitch && provider.killSwitch !== 'none' ? `외부 호출 차단: ${provider.killSwitch}` : '',
        provider.freeOnly !== false ? '무료 전용 설정: 유료 모델 자동 전환 없음' : '',
      ].filter(Boolean);
      detail.textContent = bits.join(' · ');
    }
  } catch {
    const chip = $('#modeChip');
    if (chip) { chip.textContent = '서버 연결 실패'; chip.dataset.mode = 'error'; }
    const detail = $('#providerDetail');
    if (detail) detail.textContent = '공급자 상태를 확인하지 못했습니다.';
  }
  try {
    const s = await api('/stt/status');
    state.stt = s;
  } catch {
    state.stt = { configured: false, provider: 'disabled' };
  }
}

// ---- 1. 대시보드 ----
$$('[data-journey]').forEach((b) => b.addEventListener('click', () => startJourney(b.dataset.journey)));

function startJourney(journey) {
  state.journey = journey === 'university' ? 'university' : 'company';
  const uni = state.journey === 'university';
  $('#applicationEyebrow').textContent = uni ? 'University admission' : 'Company application';
  $('#applicationTitle').textContent = uni ? '대학 지원 정보' : '기업 지원 정보';
  $('#applicationHint').textContent = uni
    ? '모집요강·전형 안내에서 확인된 내용만 사용합니다. 없으면 일반 기준으로 연습하며, 기관 맞춤 검증 배지는 표시하지 않습니다.'
    : '채용 공고·직무기술서에서 확인된 내용만 사용합니다. 없으면 일반 기준으로 연습하며, 기관 맞춤 검증 배지는 표시하지 않습니다.';
  $('#roleLabel').textContent = uni ? '지원 학과·전형' : '지원 직무';
  $('#sourceLabel').textContent = uni ? '모집요강·전형 안내 본문 (선택)' : '채용 공고·직무기술서 본문 (선택)';
  const role = $('#applicationForm [name="role"]');
  if (role) role.placeholder = uni ? '예: 경영학과 / 학생부종합' : '예: 서비스 기획';
  const target = $('#applicationForm [name="target_name"]');
  if (target) target.placeholder = uni ? '예: ○○대학교' : '예: ○○ 주식회사';
  const src = $('#sourceText');
  if (src) src.placeholder = uni ? '모집요강의 평가 기준·면접 형식, 학생부·자기소개서의 주장 부분을 붙여넣으세요.' : '요구 역량·전형 방식·면접 형식과 자기소개서의 주장 부분을 붙여넣으세요.';
  go('application');
}

async function loadRecent() {
  const box = $('#recentList');
  if (!box) return;
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const { sessions } = await api('/sessions');
    const rows = (sessions || []).slice(0, 4);
    if (!rows.length) {
      box.innerHTML = '<p class="hint">아직 연습 기록이 없습니다. 위에서 지원 분야를 고르면 시작할 수 있습니다.</p>';
      return;
    }
    box.innerHTML = rows.map((s) => `
      <div class="list-item">
        <div>
          <strong>${esc(typeLabel(s.interview_type))} 면접</strong>
          <div class="meta">${esc(fmtDate(s.created_at))} · ${esc(String(s.question_count || 0))}문항 · ${esc(stateLabel(s.state))}${s.blind ? ' · 블라인드' : ''}</div>
        </div>
        <button class="ghost small" type="button" data-open-session="${esc(s.id)}" data-state="${esc(s.state)}">${s.state === 'completed' ? '코칭 보기' : '이어보기'}</button>
      </div>`).join('');
    $$('[data-open-session]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.openSession, b.dataset.state)));
  } catch (err) {
    box.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}

function stateLabel(s) {
  return ({ ready: '시작 전', active: '진행 중', paused: '일시정지', completed: '완료', failed: '실패', deleting: '삭제 중', deleted: '삭제됨' }[s] || s);
}

function fmtDate(v) {
  if (!v) return '기록 없음';
  try { return new Date(v).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(v); }
}

async function openSession(id, st) {
  if (st !== 'completed') {
    toast('진행 중인 면접은 이어서 진행할 수 없습니다. 새 면접을 시작하세요.', true);
    return;
  }
  state.session = { id, version: 1 };
  state.flow = 'review';
  state.transfer = null;
  state.comparison = null;
  await loadReport();
}

// ---- 2. 지원 정보 ----
$('#applicationForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const btn = $('#analyzeBtn');
  setError('#applicationError', '');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '근거를 확인하는 중…';
  try {
    const uploaded = state.uploadedText ? `\n${state.uploadedText}` : '';
    const payload = {
      org_type: state.journey === 'university' ? 'university' : 'company',
      target_name: String(fd.get('target_name') || '').trim(),
      role: String(fd.get('role') || '').trim(),
      source_text: `${String(fd.get('source_text') || '').trim()}${uploaded}`.trim(),
      sources: String(fd.get('source_urls') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).map((url) => ({ url, kind: 'official' })),
      experiences: String(fd.get('experiences') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    };
    if (!payload.target_name && !payload.role && !payload.source_text) {
      throw new Error('기관명, 직무/학과, 공고 본문 중 하나는 입력해야 합니다.');
    }
    const created = await api('/profiles', { method: 'POST', idempotent: true, body: payload });
    state.profile = created;
    state.versionId = created.version_id;
    state.approved = false;
    const detail = await api(`/profiles/${created.id}`);
    state.sources = detail.sources || [];
    renderEvidence(detail, created);
    go('evidence');
    if (created.pii_warnings?.length) toast(`개인정보 후보(${created.pii_warnings.join(', ')})를 마스킹했습니다.`);
  } catch (err) {
    setError('#applicationError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

$('#skipApplicationBtn')?.addEventListener('click', () => {
  state.profile = null;
  state.versionId = null;
  state.sources = [];
  state.approved = false;
  updateSetupSummary();
  go('setup');
  toast('자료 없이 일반 기준으로 진행합니다. 기관 맞춤 검증 배지는 표시되지 않습니다.');
});

$('#docFile')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  const status = $('#docStatus');
  state.uploadedText = '';
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) {
    status.textContent = '5MB를 초과합니다. 텍스트를 직접 붙여넣어 주세요.';
    status.className = 'fine warn';
    return;
  }
  status.className = 'fine';
  status.textContent = '텍스트를 추출하는 중…';
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const r = await api('/documents/extract', { method: 'POST', idempotent: true, body: { filename: f.name, mime_type: f.type, content_base64: btoa(bin) } });
    const ta = $('#sourceText');
    if (ta && !ta.value.trim()) {
      ta.value = r.text.slice(0, 20000);
      state.uploadedText = '';
    } else {
      state.uploadedText = r.text;
    }
    status.textContent = `추출 완료 (${r.char_count}자). 위 입력란에서 확인·수정하세요.${r.truncated ? ' 일부는 잘렸습니다.' : ''}`;
    status.className = 'fine ok';
  } catch (err) {
    status.textContent = `추출 실패: ${err.message} 텍스트를 직접 붙여넣어 주세요.`;
    status.className = 'fine warn';
  }
});

// ---- 3. 근거 확인 ----
function basisTag(basis) {
  if (basis === 'official') return '<span class="tag official">공식 자료 확인</span>';
  if (basis === 'user') return '<span class="tag user">사용자 입력</span>';
  if (basis === 'monthly_trend') return '<span class="tag trend">월간 트렌드(보조)</span>';
  return '<span class="tag">연습 가정</span>';
}

function renderEvidence(detail, created) {
  const v = detail.current_version || {};
  const ex = v.extracted || {};
  const claims = ex.claims || [];
  const rows = claims.length
    ? claims.map((c) => `<li><span class="val">${esc(c.value)}</span><span class="tag user">지원서 주장</span><span class="meta">출처: “${esc(c.quote || c.value)}” · 원문 위치 ${esc(String(c.start_cp))}–${esc(String(c.end_cp))}</span></li>`).join('')
    : `<li><span class="val">확인된 기관 고유 역량 없음</span><span class="tag">일반 기준</span><span class="meta">공고가 없거나 추출하지 못했습니다. 일반 역량으로 연습하며 “기관 맞춤 검증 완료” 배지는 표시하지 않습니다.</span></li>`;
  const missing = (ex.missing_fields || []).map((f) => ({
    discussion_format: '토론면접 여부', interview_duration: '면접 시간', participant_count: '참여 인원', extraction_failed: '공고 분석(일반 기준 사용)',
  }[f] || f));
  $('#evidenceBody').innerHTML = `
    <ul class="claims">${rows}</ul>
    ${missing.length ? `<p class="missing">확인되지 않음: ${missing.map(esc).join(', ')} — 연습 가정으로 진행합니다.</p>` : ''}
    ${ex.rejected_spans ? `<p class="missing">출처 구간이 일치하지 않는 ${esc(String(ex.rejected_spans))}건은 제외했습니다.</p>` : ''}
    <p class="fine">분석 공급자: ${esc(created.provider || 'mock')} · 승인 전에는 면접을 시작할 수 없습니다.</p>`;
  renderInstitution(detail.institution || created.institution || null, detail.sources || []);
  $('#evidenceState').textContent = '확인 필요';
  $('#evidenceState').className = 'state-badge warn';
}

function renderInstitution(inst, sources) {
  const box = $('#institutionBody');
  if (!box) return;
  if (!inst) { box.innerHTML = '<p class="hint">기관 분석 결과가 없습니다. 일반 기준으로 연습합니다.</p>'; return; }
  const values = (inst.core_values || []).map((c) => `<li><span class="val">${esc(c.label)}</span>${basisTag(c.basis)}<span class="meta">${c.source_quote ? `근거: “${esc(c.source_quote)}”${c.source_title ? ` · ${esc(c.source_title)}` : ''}` : esc(c.note || '일반 역량으로 연습합니다.')}</span></li>`).join('');
  const formats = (inst.formats || []).map((f) => `<li><span class="val">${esc(f.item)}</span>${basisTag(f.basis)}<span class="meta">${esc(f.note || '')}</span></li>`).join('');
  const recs = (inst.recommended_questions || []).map((q) => `<li><span class="val">${esc(q.text)}</span>${basisTag(q.basis)}<span class="meta">${esc(q.rationale || '')}</span></li>`).join('');
  const unev = (inst.unevaluable || []).map((u) => `<li><span class="val">${esc(u.area)}</span><span class="tag">평가 불가</span><span class="meta">${esc(u.reason)}</span></li>`).join('');
  const fresh = (inst.sources_summary?.freshness || []).map((f) => `<li><span class="val">${esc(f.title || '출처')}</span><span class="tag ${f.state === 'fresh' ? 'official' : ''}">${esc(f.state)}${f.age_days != null ? ` · ${esc(String(f.age_days))}일` : ''}</span><span class="meta">${esc(f.note || '')}</span></li>`).join('');
  const srcs = (sources || []).map((s) => `<li><span class="val">${esc(s.title || s.url || '출처')}</span><span class="tag ${s.kind === 'official' ? 'official' : 'user'}">${esc(s.kind === 'official' ? '공식' : s.kind === 'unofficial' ? '비공식 참고' : s.kind === 'user' ? '사용자 입력' : '가정')}</span><span class="meta">${esc(s.url || 'URL 미확인')}${s.published_at ? ` · 발행 ${esc(s.published_at)}` : ' · 발행일 미확인'}${s.retrieved_at ? ` · 확인 ${esc(String(s.retrieved_at).slice(0, 10))}` : ''}</span></li>`).join('');
  const conflicts = (inst.sources_summary?.conflicts || []).map((c) => `<li><span class="val">${esc(c.key)}</span><span class="tag">상충</span><span class="meta">서로 다른 값 ${esc(String(c.count))}건 — 단정하지 않고 해당 항목은 보류합니다.</span></li>`).join('');
  box.innerHTML = `
    <div class="inst-head"><strong>${esc(inst.org_label || '')} · ${esc(inst.target_name || '기관 미지정')} · ${esc(inst.role || '직무·학과 미지정')}</strong><span class="tag ${inst.fallback_to_general ? '' : 'official'}">${esc(inst.badge || '')}</span></div>
    <h3>핵심 가치·요구 역량</h3><ul class="claims">${values || '<li>확인된 역량 없음</li>'}</ul>
    ${formats ? `<h3>면접 형식·전형 조건</h3><ul class="claims">${formats}</ul>` : ''}
    ${recs ? `<h3>권장 연습 질문 (질문별 근거)</h3><ul class="claims">${recs}</ul>` : ''}
    <h3>평가 가능한 영역 / 불가 영역</h3><ul class="claims">${(inst.evaluable || []).map((x) => `<li><span class="val">${esc(x.label)}</span>${basisTag(x.basis)}</li>`).join('')}${unev}</ul>
    ${srcs ? `<h3>출처 (URL·발행일·확인일)</h3><ul class="claims">${srcs}</ul>` : ''}
    ${fresh ? `<h3>자료 신선도</h3><ul class="claims">${fresh}</ul>` : ''}
    ${conflicts ? `<h3>상충 자료</h3><ul class="claims">${conflicts}</ul>` : ''}
    <p class="fine">${esc(inst.disclaimer || '')}</p>`;
}

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

// ---- 4. 면접 설정 ----
async function loadCatalog() {
  try {
    const data = await api('/interview-types');
    state.catalog = {
      types: data.types || [],
      roles: data.roles || [],
      topics: data.topics || [],
      pt_tasks: data.pt_tasks || [],
      scenarios: data.scenarios || [],
    };
  } catch {
    state.catalog = {
      types: [
        { id: 'general', label: '일반·인성 면접', desc: '자기소개·지원동기·경험·협업·꼬리질문' },
        { id: 'technical', label: '직무·기술 면접', desc: '직무별 질문·개념 설명·문제해결 과정' },
      ],
      roles: [],
    };
  }
  const typeSel = $('#interviewTypeSelect');
  if (typeSel) {
    const preferred = ['general', 'technical', 'situational', 'panel', 'discussion', 'pt'];
    const ordered = [...state.catalog.types].sort((a, b) => preferred.indexOf(a.id) - preferred.indexOf(b.id));
    typeSel.innerHTML = ordered.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  }
  const roleSel = $('#interviewerRoleSelect');
  if (roleSel) {
    const roles = state.catalog.roles.length ? state.catalog.roles : [
      { id: 'hr', label: 'HR·인사 담당' }, { id: 'practitioner', label: '현업 실무자' },
      { id: 'expert', label: '기술·전공 면접관' }, { id: 'executive', label: '관리자·임원' },
      { id: 'admissions', label: '입학전형위원' }, { id: 'teacher', label: '전공 담당 교사' },
    ];
    roleSel.innerHTML = `<option value="">기관·분야에 맞춰 자동</option>${roles.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}`;
  }
}

function updateSetupSummary() {
  const el = $('#setupSummary');
  if (!el) return;
  const uni = state.journey === 'university';
  if (state.profile) {
    el.innerHTML = `<span class="tag ${state.approved ? 'official' : ''}">${state.approved ? '근거 승인 완료' : '승인 필요'}</span> ${esc(state.profile.org_label || (uni ? '대학' : '기업'))} · ${esc(state.profile.target_name || '기관 미지정')} · ${esc(state.profile.role || (uni ? '학과 미지정' : '직무 미지정'))}`;
  } else {
    el.innerHTML = `<span class="tag">자료 없이 일반 기준</span> ${uni ? '대학 입학' : '기업 취업'} · 기관 맞춤 검증 없이 기본 역량으로 연습합니다.`;
  }
}

$('#setupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.profile) state.approved = true;
  if (state.profile && !state.approved) {
    setError('#setupError', '근거 확인 화면에서 내용을 승인해야 시작할 수 있습니다.');
    return;
  }
  const fd = new FormData(e.target);
  const btn = $('#startBtn');
  setError('#setupError', '');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '면접을 준비하는 중…';
  try {
    const body = {
      profile_version_id: state.versionId || undefined,
      interview_type: fd.get('interview_type') || 'general',
      persona: fd.get('persona') || 'standard',
      interviewer_role: fd.get('interviewer_role') || undefined,
      blind: fd.get('blind') === 'on',
      duration_minutes: Number(fd.get('duration_minutes') || 10),
      input_mode: fd.get('input_mode') || 'text',
      consent_version: 'mvp-2026-10',
    };
    const s = await api('/sessions', { method: 'POST', idempotent: true, body });
    state.session = { id: s.id, version: s.version };
    state.flow = 'interview';
    state.transfer = null;
    state.comparison = null;
    state.type = s.interview_type;
    state.meta = `${typeLabel(s.interview_type)} · ${s.limits.duration_minutes}분 · ${s.limits.duration_seconds}초 · 블라인드 ${s.blind ? 'ON' : 'OFF'}`;
    try { await api(`/sessions/${s.id}/connect`, { method: 'POST', body: {}, idempotent: true }); } catch { /* 티켓 실패해도 REST 진행 */ }
    const started = await api(`/sessions/${s.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: s.version, type: 'session.start', payload: {} },
    });
    state.session.version = started.version;
    enterRoom({
      started, session: s, inputMode: body.input_mode,
      durationSeconds: s.limits.duration_seconds || s.limits.duration_minutes * 60,
      meta: state.meta,
    });
  } catch (err) {
    setError('#setupError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

// 입력 방식 안내
$$('#setupForm input[name="input_mode"]').forEach((r) => r.addEventListener('change', () => {
  const hint = $('#inputModeHint');
  if (!hint) return;
  hint.textContent = {
    text: '텍스트는 입력한 내용이 그대로 전송됩니다.',
    voice: '브라우저 음성 인식은 원음을 서버로 보내지 않고, 인식된 텍스트를 확인·수정한 뒤 전송합니다.',
    groq: '녹음 파일은 서버에서 전사 후 즉시 폐기됩니다. 개인정보는 입력하지 마세요.',
  }[r.value] || hint.textContent;
  if (!r.checked) return;
  const blind = $('#blindNote');
  void blind;
}));

$('#setupForm input[name="blind"]')?.addEventListener('change', (e) => {
  $('#blindNote').hidden = !e.target.checked;
});

$('#interviewTypeSelect')?.addEventListener('change', (e) => {
  const t = state.catalog.types.find((x) => x.id === e.target.value);
  const hint = $('#advancedHint');
  if (hint) hint.textContent = t?.desc || '선택한 유형의 루브릭으로 평가합니다.';
  const roleSel = $('#interviewerRoleSelect');
  if (roleSel && e.target.value === 'technical' && !roleSel.value) roleSel.value = 'expert';
});

// ---- 5. 면접실 ----
let voiceRecognizer = null;
let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recBlob = null;
let recMime = '';
let recTimer = null;
let recStartedAt = 0;

function enterRoom({ started, session, inputMode = 'text', durationSeconds, meta }) {
  state.questionCount = 0;
  state.finished = false;
  state.finishing = false;
  state.questionTotal = started.question_total || session.limits?.question_count || 4;
  state.paused = false;
  state.pausedAt = 0;
  state.inputMode = inputMode;
  $('#roomMeta').textContent = meta || `${typeLabel(session.interview_type)} 면접`;
  $('#roomState').textContent = 'LIVE';
  $('#roomState').className = 'room-state on';
  setError('#roomError', '');
  setHint('');
  $('#answerText').value = '';
  $('#charCount').textContent = '0';
  $('#aiReply').hidden = true;
  $('#discussionLog').innerHTML = '';
  $('#discussionLog').hidden = true;
  $('#phaseBar').hidden = true;
  $('#roomContext').hidden = true;
  $('#pauseBtn').textContent = '일시정지';
  $('#voiceRow').hidden = inputMode !== 'voice';
  $('#sttRow').hidden = inputMode !== 'groq';
  if (inputMode === 'groq') {
    updateSttButtons();
    setSttStatus(state.stt?.configured ? '녹음 후 “전사 요청”을 누르면 텍스트로 바뀝니다.' : '전사 키가 없습니다. 텍스트로 답해 주세요.', state.stt?.configured ? 'ok' : 'warn');
  }
  setupRoomForType(session, started);
  startTimer(durationSeconds || session.limits?.duration_seconds || 600);
  go('room');
  setTimeout(() => { try { $('#answerText').focus(); } catch { /* noop */ } }, 80);
}

function setupRoomForType(s, started) {
  const ctx = $('#roomContext');
  const bar = $('#phaseBar');
  const log = $('#discussionLog');
  ctx.hidden = true; bar.hidden = true; log.hidden = true;
  log.innerHTML = '';
  state.discussLog = [];
  if (state.flow === 'repractice' && state.transfer) {
    ctx.hidden = false;
    ctx.innerHTML = `
      <p class="ctx-label">이전 질문 (비교 기준)</p>
      <p class="fine">${esc(state.transfer.baseline_question || '')}</p>
      <p class="ctx-label">지금 질문 (같은 역량 · 다른 질문)</p>
      <p><strong>${esc(state.transfer.transfer_question?.text || started.question?.text || '')}</strong></p>
      <p class="fine">${esc(state.transfer.transfer_question?.novelty_guard || '이전 답변과 같은 사례를 반복하지 말고 다른 상황·선택을 설명하세요.')}</p>`;
    setQuestion(started.question);
    return;
  }
  if (s.interview_type === 'discussion' && s.topic) {
    ctx.hidden = false;
    ctx.innerHTML = `<p class="ctx-label">토론 주제 · 연습용 가정</p><strong>${esc(s.topic.title)}</strong><p>${esc(s.topic.brief)}</p>`;
    bar.hidden = false;
    renderPhaseBar('discussion', started.discussion?.phase || 'opening');
    log.hidden = false;
    (started.openings || []).forEach((o) => appendTurn(o.speaker_id, o.speaker_name || (o.speaker_id === 'moderator' ? '사회자' : o.speaker_id), o.utterance));
    setQuestion({ text: started.question?.text || '토론을 시작합니다.' });
    return;
  }
  if (s.interview_type === 'pt' && s.pt_task) {
    ctx.hidden = false;
    ctx.innerHTML = `<p class="ctx-label">PT 과제 · 연습용 가정</p><strong>${esc(s.pt_task.title)}</strong><p>${esc(s.pt_task.brief)}</p>`;
    bar.hidden = false;
    renderPhaseBar('pt', started.pt_phase || 'brief');
    setQuestion({ text: '과제를 확인한 뒤 “준비 시작”을 누르세요.' });
    showPtActions(true);
    state.ptPhase = started.pt_phase || 'brief';
    return;
  }
  if (s.interview_type === 'situational' && s.scenario) {
    ctx.hidden = false;
    ctx.innerHTML = `<p class="ctx-label">상황 시나리오</p><strong>${esc(s.scenario.title)}</strong><p>역할극 형식입니다. 상대의 말에 반응하며 대응을 말해 보세요.</p>`;
  } else if (s.interview_type === 'panel' && s.panel_roles?.length) {
    ctx.hidden = false;
    ctx.innerHTML = `<p class="ctx-label">패널 구성</p>${s.panel_roles.map((r) => esc(r.label)).join(' · ')}<p class="fine">질문마다 담당 면접관이 바뀝니다.</p>`;
  }
  showPtActions(false);
  setQuestion(started.question);
}

function showPtActions(on) {
  let box = $('#ptActions');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ptActions';
    box.className = 'pt-actions';
    $('#answerText').insertAdjacentElement('beforebegin', box);
  }
  box.hidden = !on;
  if (!on) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <button class="ghost small" type="button" data-phase="prepare">1. 준비 시작</button>
    <button class="ghost small" type="button" data-phase="present">2. 발표 시작</button>
    <button class="ghost small" type="button" data-phase="qa">3. Q&A로 이동</button>`;
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => advancePt(b.dataset.phase)));
}

async function advancePt(phase) {
  if (!state.session) return;
  try {
    const r = await api(`/sessions/${state.session.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: state.session.version, type: 'pt.prepare', payload: { phase } },
    });
    state.session.version = r.version;
    state.ptPhase = r.pt_phase;
    renderPhaseBar('pt', r.pt_phase);
    if (r.utterance) {
      $('#aiReply').innerHTML = `<p class="label">면접관</p><p>${esc(r.utterance)}</p>`;
      $('#aiReply').hidden = false;
      speak(r.utterance);
    }
    if (phase === 'prepare') startTimer(180);
    if (phase === 'present') { startTimer(180); setQuestion({ text: '발표를 시작하세요. 결론 → 근거 → 실행 계획 순서로 입력하면 됩니다.' }); }
    if (phase === 'qa') { setQuestion({ text: r.utterance || '질의응답을 시작합니다.' }); }
  } catch (err) {
    setError('#roomError', err.message);
  }
}

const PHASES = {
  discussion: [['reading', '자료 읽기'], ['opening', '입론'], ['exchange', '반론·교환'], ['agreement', '합의'], ['closing', '마무리']],
  pt: [['brief', '과제 확인'], ['prepare', '준비'], ['present', '발표'], ['qa', 'Q&A']],
};

function renderPhaseBar(kind, current) {
  const bar = $('#phaseBar');
  if (!bar) return;
  const list = PHASES[kind] || [];
  const idx = list.findIndex(([id]) => id === current);
  bar.innerHTML = list.map(([id, label], i) => `<span class="phase-chip ${id === current ? 'on' : i < idx ? 'done' : ''}">${esc(label)}</span>`).join('');
}

function appendTurn(speakerId, speakerName, text) {
  const log = $('#discussionLog');
  if (!log || !text) return;
  const cls = speakerId === 'user' ? 'user' : speakerId === 'moderator' ? 'moderator' : 'ai';
  const who = speakerId === 'user' ? '나' : speakerName || (speakerId === 'moderator' ? '사회자' : 'AI 참가자');
  const div = document.createElement('div');
  div.className = `turn ${cls}`;
  div.innerHTML = `<span class="who">${esc(who)}</span>${esc(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function setQuestion(q) {
  if (!q || !q.text) return;
  $('#roomTitle').textContent = q.text;
  updateProgress();
  $('#aiReply').hidden = true;
}

function setHint(text) {
  const el = $('#roomHint');
  if (el) el.textContent = text || '';
}

function updateProgress() {
  const pct = Math.min(100, (state.questionCount / Math.max(1, state.questionTotal)) * 100);
  const bar = $('#progressBar');
  if (bar) bar.style.width = `${pct}%`;
  const wrap = $('#progressWrap');
  if (wrap) wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
}

function startTimer(totalSeconds) {
  clearInterval(state.timer);
  state.endAt = Date.now() + totalSeconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
    const label = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    const clock = $('#clock');
    if (clock) clock.textContent = label;
    if (left === 0 && !state.paused) {
      clearInterval(state.timer);
      toast('시간이 종료되었습니다. 면접을 마무리합니다.');
      finishRoom();
    }
  };
  tick();
  state.timer = setInterval(() => { if (!state.paused) tick(); }, 1000);
}

$('#answerText')?.addEventListener('input', (e) => {
  $('#charCount').textContent = String([...e.target.value].length);
});
$('#answerText')?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#answerBtn').click(); }
});

$('#pauseBtn')?.addEventListener('click', async () => {
  if (!state.session) return;
  try {
    if (!state.paused) {
      const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.pause', payload: {} } });
      state.session.version = r.version;
      state.paused = true;
      state.pausedAt = Date.now();
      $('#pauseBtn').textContent = '다시 시작';
      $('#roomState').textContent = '일시정지';
      $('#roomState').className = 'room-state';
      toast('일시정지했습니다.');
    } else {
      const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.resume', payload: {} } });
      state.session.version = r.version;
      state.paused = false;
      if (state.pausedAt) state.endAt += Date.now() - state.pausedAt;
      state.pausedAt = 0;
      $('#pauseBtn').textContent = '일시정지';
      $('#roomState').textContent = 'LIVE';
      $('#roomState').className = 'room-state on';
      startTimer(Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000)));
      toast('다시 시작합니다.');
    }
  } catch (err) {
    setError('#roomError', err.message);
  }
});

$('#ttsBtn')?.addEventListener('click', () => speak($('#roomTitle').textContent));
$('#copyQBtn')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#roomTitle').textContent); toast('질문을 복사했습니다.'); }
  catch { toast('복사에 실패했습니다.', true); }
});

function speak(text) {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch { /* TTS 실패는 무시(텍스트가 기준) */ }
}

// 음성 인식 (브라우저)
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
function setMicStatus(text, cls = '') {
  const el = $('#voiceStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `fine ${cls}`;
}
if (!SpeechRec) {
  const opt = $('#setupForm input[name="input_mode"][value="voice"]');
  if (opt) { opt.disabled = true; opt.closest('label')?.classList.add('disabled'); }
}

function stopVoice() {
  if (!voiceRecognizer) return;
  try { voiceRecognizer.stop(); } catch { /* noop */ }
  voiceRecognizer = null;
  const b = $('#voiceBtn');
  if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = '말로 답하기'; }
  setMicStatus('인식된 텍스트를 확인·수정한 뒤 “답변 완료”를 누르세요.');
}

$('#voiceBtn')?.addEventListener('click', () => {
  if (!SpeechRec) { toast('이 브라우저는 음성 인식을 지원하지 않습니다.', true); return; }
  if (voiceRecognizer) { stopVoice(); return; }
  const answer = $('#answerText');
  voiceRecognizer = new SpeechRec();
  voiceRecognizer.lang = 'ko-KR';
  voiceRecognizer.continuous = true;
  voiceRecognizer.interimResults = true;
  let finalText = answer.value.trim() ? `${answer.value.trim()} ` : '';
  voiceRecognizer.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const chunk = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += `${chunk} `;
      else interim += chunk;
    }
    answer.value = `${finalText}${interim}`.trim();
    $('#charCount').textContent = String([...answer.value].length);
  };
  voiceRecognizer.onerror = (ev) => {
    toast(ev.error === 'not-allowed' ? '마이크 권한이 거부되었습니다.' : `음성 인식 오류: ${ev.error}`, true);
    stopVoice();
  };
  voiceRecognizer.onend = () => { if (voiceRecognizer) stopVoice(); };
  voiceRecognizer.start();
  const b = $('#voiceBtn');
  b.setAttribute('aria-pressed', 'true');
  b.textContent = '인식 중지';
  setMicStatus('듣는 중입니다. 말이 끝나면 “인식 중지”를 누르세요.');
});

// Groq 녹음 전사
function sttLimitSeconds() {
  return Number(state.stt?.maxRecordingSeconds || 120);
}
function updateSttButtons() {
  const recBtn = $('#sttRecBtn');
  const txBtn = $('#sttTranscribeBtn');
  if (!recBtn || !txBtn) return;
  const recording = !!mediaRecorder;
  recBtn.setAttribute('aria-pressed', String(recording));
  recBtn.textContent = recording ? '녹음 중지' : '녹음 시작';
  txBtn.disabled = recording || !recBlob;
}
function stopRecTimer() {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
}
function stopMediaStream() {
  if (recStream) { recStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } }); recStream = null; }
}
function setSttStatus(text, cls = '') {
  const el = $('#sttStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `fine ${cls}`;
}

async function toggleRecording() {
  const recBtn = $('#sttRecBtn');
  if (mediaRecorder) {
    try { mediaRecorder.stop(); } catch { /* noop */ }
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) { setSttStatus('이 브라우저는 녹음을 지원하지 않습니다.', 'warn'); return; }
  if (!state.stt?.configured || state.stt?.provider === 'disabled') { setSttStatus('전사를 사용할 수 없습니다. 텍스트로 답해 주세요.', 'warn'); return; }
  try {
    recBtn.disabled = true;
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    recBtn.disabled = false;
    setSttStatus('마이크 권한이 거부되었습니다.', 'warn');
    return;
  }
  recChunks = [];
  recBlob = null;
  const prefer = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  recMime = '';
  if (window.MediaRecorder?.isTypeSupported) {
    recMime = prefer.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
  }
  try {
    mediaRecorder = recMime ? new MediaRecorder(recStream, { mimeType: recMime }) : new MediaRecorder(recStream);
  } catch {
    stopMediaStream();
    mediaRecorder = null;
    recBtn.disabled = false;
    setSttStatus('녹음을 시작하지 못했습니다.', 'warn');
    return;
  }
  recStartedAt = Date.now();
  mediaRecorder.ondataavailable = (ev) => { if (ev.data?.size) recChunks.push(ev.data); };
  mediaRecorder.onstop = () => {
    stopRecTimer();
    stopMediaStream();
    const mime = mediaRecorder?.mimeType || recMime || 'audio/webm';
    mediaRecorder = null;
    recBtn.disabled = false;
    try { recBlob = new Blob(recChunks, { type: mime }); } catch { recBlob = null; }
    recMime = recBlob?.type || mime;
    recChunks = [];
    updateSttButtons();
    if (!recBlob || !recBlob.size) { setSttStatus('녹음된 소리가 없습니다.', 'warn'); return; }
    const secs = Math.round((Date.now() - recStartedAt) / 1000);
    setSttStatus(`녹음 완료 (${secs}초). “전사 요청”을 누르면 텍스트로 바뀝니다.`, 'ok');
  };
  mediaRecorder.onerror = () => {
    stopRecTimer();
    stopMediaStream();
    mediaRecorder = null;
    recBtn.disabled = false;
    updateSttButtons();
    setSttStatus('녹음 중 오류가 발생했습니다.', 'warn');
  };
  mediaRecorder.start(250);
  recBtn.disabled = false;
  updateSttButtons();
  setSttStatus(`녹음 중… 최대 ${sttLimitSeconds()}초.`, 'rec');
  const tick = () => {
    const left = sttLimitSeconds() - Math.floor((Date.now() - recStartedAt) / 1000);
    if (left <= 0) { try { mediaRecorder?.stop(); } catch { /* noop */ } return; }
    setSttStatus(`녹음 중… ${left}초 남음.`, 'rec');
  };
  stopRecTimer();
  recTimer = setInterval(tick, 1000);
}

async function transcribeRecording() {
  if (!recBlob || mediaRecorder || !state.session) return;
  const txBtn = $('#sttTranscribeBtn');
  txBtn.disabled = true;
  setSttStatus('전사 중… (원음은 전사 후 폐기됩니다)', 'rec');
  try {
    const fd = new FormData();
    const ext = /mp4/i.test(recMime) ? 'm4a' : /ogg/i.test(recMime) ? 'ogg' : 'webm';
    fd.append('file', recBlob, `answer.${ext}`);
    const headers = { Authorization: `Bearer ${state.token}`, 'Idempotency-Key': uuid() };
    const res = await fetch(`/api/v1/sessions/${state.session.id}/transcriptions`, { method: 'POST', headers, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `전사 실패 (${res.status})`);
    recBlob = null;
    updateSttButtons();
    if (!data.text) { setSttStatus(data.note || '전사 결과가 비어 있습니다.', 'warn'); return; }
    const answer = $('#answerText');
    answer.value = String(data.text || '').slice(0, 4000);
    $('#charCount').textContent = String([...answer.value].length);
    setSttStatus('전사 결과를 입력란에 넣었습니다. 확인·수정 후 답변 완료를 누르세요.', 'ok');
    answer.focus();
  } catch (err) {
    setSttStatus(err.message, 'warn');
  }
}

$('#sttRecBtn')?.addEventListener('click', toggleRecording);
$('#sttTranscribeBtn')?.addEventListener('click', transcribeRecording);

$('#answerBtn')?.addEventListener('click', async () => {
  if (voiceRecognizer) stopVoice();
  const answerEl = $('#answerText');
  const text = answerEl.value.trim();
  if (!text) { toast('답변을 입력하세요.', true); return; }
  const btn = $('#answerBtn');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '처리 중…';
  setError('#roomError', '');
  try {
    const r = await api(`/sessions/${state.session.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: state.session.version, type: 'turn.text', payload: { text } },
    });
    state.session.version = r.version;
    answerEl.value = '';
    $('#charCount').textContent = '0';
    await afterTurn(r, text);
  } catch (err) {
    setError('#roomError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

async function afterTurn(r, text) {
  // 서버가 마지막 턴에서 세션을 자동 종료할 수 있으므로 상태를 반영해 중복 finish를 막는다.
  if (r.state && state.session) state.session.state = r.state;
  const type = state.type;
  if (type === 'discussion') {
    appendTurn('user', '나', text);
    (r.utterances || []).forEach((u) => appendTurn(u.speaker_id, u.speaker_name || (u.speaker_id === 'moderator' ? '사회자' : undefined), u.utterance));
    if (r.discussion?.phase) renderPhaseBar('discussion', r.discussion.phase);
    state.questionCount = r.discussion?.user_turns || state.questionCount + 1;
    updateProgress();
    if (r.action === 'discussion_complete' || r.state === 'completed') { toast('토론이 끝났습니다. 코칭을 준비합니다.'); return finishRoom(); }
    if (r.utterance) {
      $('#aiReply').innerHTML = `<p class="label">사회자</p><p>${esc(r.utterance)}</p>`;
      $('#aiReply').hidden = false;
      speak(r.utterance);
    }
    return;
  }
  if (type === 'pt') {
    if (r.pt_phase && r.pt_phase !== state.ptPhase) { state.ptPhase = r.pt_phase; renderPhaseBar('pt', r.pt_phase); }
    if (r.state === 'completed') return finishRoom();
    if (r.utterance) {
      $('#aiReply').innerHTML = `<p class="label">${r.pt_phase === 'qa' ? '면접관 · Q&A' : '면접관'}</p><p>${esc(r.utterance)}</p>`;
      $('#aiReply').hidden = false;
      if (r.pt_phase === 'qa') setQuestion({ text: r.utterance });
      speak(r.utterance);
    }
    state.questionCount += 1;
    updateProgress();
    return;
  }
  if (type === 'situational') {
    if (r.state === 'completed') return finishRoom();
    if (r.utterance) {
      $('#aiReply').innerHTML = `<p class="label">면접관 · 역할극</p><p>${esc(r.utterance)}</p>`;
      $('#aiReply').hidden = false;
      speak(r.utterance);
    }
    state.questionCount = r.scenario_index || state.questionCount + 1;
    updateProgress();
    return;
  }
  if (r.state === 'completed') return finishRoom();
  if (r.action === 'ask_followup' && r.utterance) {
    $('#aiReply').innerHTML = `<p class="label">면접관 · 추가 확인</p><p>${esc(r.utterance)}</p>`;
    $('#aiReply').hidden = false;
    speak(r.utterance);
  } else if (r.current_question?.text) {
    setQuestion(r.current_question);
    speak(r.current_question.text);
    state.questionCount += 1;
  }
  updateProgress();
  const provider = r.provider === 'gemini' ? `Gemini${r.model ? ` · ${r.model}` : ''}` : 'Mock';
  setHint(`꼬리질문 ${r.followups_used ?? 0}/3 · ${provider} · 규칙 기반 참고 관찰`);
}

$('#finishBtn')?.addEventListener('click', () => finishRoom());

async function finishRoom() {
  if (state.finishing || state.finished) return;
  if (!state.session) { go('dashboard'); return; }
  state.finishing = true;
  clearInterval(state.timer);
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
  if (voiceRecognizer) stopVoice();
  // 서버가 이미 완료 처리한 세션(마지막 턴 자동 종료)에는 finish 명령을 다시 보내지 않는다.
  const alreadyCompleted = state.session.state === 'completed';
  if (!alreadyCompleted && state.paused) {
    try {
      const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.resume', payload: {} } });
      state.session.version = r.version;
      state.paused = false;
    } catch { /* 종료가 우선 */ }
  }
  if (!alreadyCompleted) {
    try {
      await api(`/sessions/${state.session.id}/commands`, {
        method: 'POST', idempotent: true,
        body: { command_id: uuid(), expected_version: state.session.version, type: 'session.finish', payload: {} },
      });
    } catch (err) {
      // 409: 이미 종료된 세션 — 실패로 표시하지 않고 보고서를 그대로 연다.
      if (err.status !== 409) {
        state.finishing = false;
        setError('#roomError', err.message);
        return;
      }
    }
  }
  state.session.state = 'completed';
  state.finishing = false;
  state.finished = true;
  await loadReport();
}

// ---- 6. 피드백 ----
async function loadReport({ attempt = 0 } = {}) {
  if (!state.session) { go('dashboard'); return; }
  go('feedback');
  const body = $('#feedbackBody');
  if (body) body.innerHTML = '<div class="skeleton" role="status">코칭 보고서를 준비하고 있습니다…</div>';
  try {
    const r = await api(`/sessions/${state.session.id}/report`);
    if (r.status === 'pending' && attempt < 8) {
      setTimeout(() => loadReport({ attempt: attempt + 1 }), 1200);
      return;
    }
    if (r.status !== 'ready') {
      if (body) body.innerHTML = `<div class="empty-state"><h2>보고서를 만들지 못했습니다</h2><p>${esc(r.detail || '확정된 답변은 보존됩니다. 기록에서 다시 확인할 수 있습니다.')}</p><button class="ghost" type="button" data-go="dashboard">대시보드로</button></div>`;
      $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
      return;
    }
    state.lastReport = r;
    renderReport(r);
    if (state.flow === 'repractice' && state.transfer?.transfer_id) {
      await runComparison(state.transfer.transfer_id, state.session.id);
    }
  } catch (err) {
    if (body) body.innerHTML = `<div class="empty-state"><h2>보고서를 불러오지 못했습니다</h2><p>${esc(err.message)}</p><button class="ghost" type="button" data-go="dashboard">대시보드로</button></div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  }
}

function rubricNote(t) {
  return ({
    discussion: '토론은 주장 이해·근거·반박·협의 과정을 봅니다. 발언 기회가 부족한 차원은 공개하지 않습니다.',
    pt: 'PT는 구성·근거·실행 계획·질의응답을 봅니다. 준비 단계의 메모는 평가하지 않습니다.',
    situational: '상황 면접은 역할·제약 이해, 상황 대응, 판단, 성찰을 봅니다.',
    technical: '기술 면접은 개념 설명·근거·판단·적용 계획을 봅니다. 정답 암기 여부는 평가하지 않습니다.',
  }[t] || '일반·패널 면접은 질문 적합성·근거·판단·성찰을 봅니다.');
}

function renderReport(r) {
  const body = $('#feedbackBody');
  if (!body) return;
  const badge = $('#feedbackBadge');
  if (badge) badge.textContent = `Feedback · ${typeLabel(r.interview_type)} · ${r.rubric_version || ''}`;
  const inst = r.institution ? `
    <div class="inst-head"><strong>${esc(r.institution.org_label || '')} ${esc(r.institution.target_name || '')} · ${esc(r.institution.role || '')}</strong><span class="tag ${r.institution.fallback_to_general ? '' : 'official'}">${esc(r.institution.badge || '')}</span></div>
    <p class="fine">${esc(r.institution.disclaimer || '기관의 비공개 채점기준을 아는 것처럼 표현하지 않습니다.')}</p>` : '';
  const dims = (r.dimensions || []).map((d) => {
    const scored = d.status === 'scored';
    const ev = (d.evidence || []).map((e) => `
      <li>
        <q>${esc(e.quote)}</q>
        <span class="meta">답변 수준 ${esc(String(e.answer_level))}${e.turn_id ? ` · turn ${esc(String(e.turn_id).slice(0, 8))} · rev ${esc(String(e.revision ?? 1))}` : ''}</span>
        ${e.turn_id ? `<button class="ghost tiny" type="button" data-revise-turn="${esc(e.turn_id)}">전사 교정</button>` : ''}
      </li>`).join('');
    return `<div class="dim ${scored ? '' : 'abstain'}">
      <div class="dim-head">
        <h2>${esc(dimLabel(d.id))}</h2>
        <span class="level ${scored ? '' : 'abstain'}">${scored ? `${esc(String(d.level))} / 4` : '판단 보류'}</span>
      </div>
      <p>${esc(d.observation)}</p>
      ${scored ? `<ul class="evidence">${ev}</ul>` : `<p class="fine">${esc(d.abstention_reason || '관찰 근거가 부족해 수준을 공개하지 않습니다.')}</p>`}
    </div>`;
  }).join('');
  const actions = (r.next_actions || []).map((a) => `
    <div class="action-card">
      <h3>다음 답변에서 할 행동 · ${esc(dimLabel(a.dimension_id))}</h3>
      <p>${esc(a.action)}</p>
      <p class="fine">재연습 질문 예시: ${esc(a.practice_question)}</p>
      <button class="primary small" type="button" data-practice="${esc(a.dimension_id)}">같은 역량의 새 질문으로 재연습</button>
    </div>`).join('');
  const transferReady = (r.dimensions || []).some((d) => d.status === 'scored');
  body.innerHTML = `
    <div class="card report">
      ${inst}
      <p class="fine">${esc(r.badge || 'AI 생성 코칭 · 실제 합격 예측 아님')} · 공급자 ${esc(r.provider === 'gemini' ? 'Gemini' : 'Mock')} · ${esc(rubricNote(r.interview_type))}</p>
      <p class="fine">현재 평가는 <strong>규칙 기반 참고 관찰</strong>입니다. 검증된 AI 채점이나 사람 평가자를 대체하지 않습니다.</p>
      ${dims || '<p class="hint">평가할 수 있는 답변이 없습니다.</p>'}
      ${renderInstitutionLink(r.institution_link)}
      ${actions ? `<section class="actions-wrap"><h2>다음 행동</h2>${actions}</section>` : '<p class="hint">개선 행동을 제안할 만큼 관찰된 차원이 없습니다.</p>'}
      ${transferReady ? `
        <div class="action-card transfer-card">
          <h3>새 질문에서 개선 확인</h3>
          <p class="fine">같은 역량을 묻는 처음 보는 질문으로 다시 답한 뒤, 같은 루브릭에서 두 답변의 발언 근거를 나란히 비교합니다. 증거가 부족하면 판단을 보류합니다.</p>
          <div id="transferBox"></div>
        </div>` : ''}
      <div class="actions">
        <button class="ghost" id="copyBtn" type="button">텍스트로 복사</button>
        <button class="ghost" id="exportBtn" type="button">JSON 내보내기</button>
        <button class="ghost" id="appealBtn" type="button">이의 제기</button>
        <button class="ghost" id="appealStatusBtn" type="button">이의 처리 상태</button>
        <button class="danger" id="deleteBtn" type="button">이 세션 삭제</button>
      </div>
      <p class="fine">AI 생성 코칭이며 실제 합격 가능성이나 사람의 성격을 평가하지 않습니다.</p>
    </div>`;

  $('#copyBtn')?.addEventListener('click', async () => {
    const text = (r.dimensions || []).map((d) => `${dimLabel(d.id)}: ${d.status === 'scored' ? `${d.level}/4` : '판단 보류'} — ${d.observation}`).join('\n');
    try {
      await navigator.clipboard.writeText(`Intervu 코칭 (${typeLabel(r.interview_type)})\n${text}\n\n※ 규칙 기반 참고 관찰, 합격 예측 아님`);
      toast('복사했습니다.');
    } catch { toast('복사에 실패했습니다.', true); }
  });

  $('#exportBtn')?.addEventListener('click', async () => {
    try {
      const ex = await api('/exports', { method: 'POST', idempotent: true, body: { session_id: state.session.id, format: 'json' } });
      const payload = await api(`/exports/${ex.job_id}`);
      downloadJson(payload, `intervu-report-${state.session.id}.json`);
      toast('JSON으로 내보냈습니다.');
    } catch (err) { toast(err.message, true); }
  });

  $$('[data-revise-turn]').forEach((b) => b.addEventListener('click', async () => {
    const turnId = b.dataset.reviseTurn;
    const text = await askInput('전사 교정', '원문은 유지되고 새 revision으로 기록됩니다. 기존 보고서는 그대로 보존됩니다.', '교정된 전사', '', true);
    if (!text) return;
    try {
      const out = await api(`/turns/${turnId}/revisions`, { method: 'POST', idempotent: true, body: { base_revision: 1, text, reason: 'stt_correction' } });
      toast(`전사 교정을 저장했습니다 (revision ${out.revision}).`);
    } catch (err) { toast(err.message, true); }
  }));

  $('#appealBtn')?.addEventListener('click', async () => {
    const category = await dialog({
      title: '이의 제기 1/2',
      message: '어떤 종류의 문제인가요? stt(오인식) / fact(사실) / evidence(근거) / inappropriate(부적절)',
      label: '유형', value: 'stt', okText: '다음',
    });
    if (!category) return;
    const cat = category.trim();
    if (!['stt', 'fact', 'evidence', 'inappropriate'].includes(cat)) { toast('유형이 올바르지 않습니다.', true); return; }
    const comment = await askInput('이의 제기 2/2', '어떤 점이 잘못되었는지 적어 주세요. (최대 500자)', '설명', '', true);
    if (comment === null) return;
    try {
      const out = await api(`/evaluations/${r.evaluation_id}/appeals`, { method: 'POST', idempotent: true, body: { category: cat, comment: comment.slice(0, 500) } });
      await dialog({ title: '이의 접수 완료', message: `접수 ID: ${out.appeal_id}\n처리 목표 3영업일(운영 목표). 아래 ID로 상태를 확인할 수 있습니다.`, okText: '확인' });
      toast('이의를 접수했습니다.');
    } catch (err) { toast(err.message, true); }
  });

  $('#appealStatusBtn')?.addEventListener('click', async () => {
    const id = await askInput('이의 처리 상태', '접수 ID를 입력하세요.', '접수 ID');
    if (!id) return;
    checkAppeal(id);
  });

  $('#deleteBtn')?.addEventListener('click', async () => {
    const ok = await askConfirm('세션 삭제', '이 세션의 답변과 코칭 보고서를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '삭제' });
    if (!ok) return;
    try {
      const d = await api(`/sessions/${state.session.id}`, { method: 'DELETE', idempotent: true });
      toast(`삭제했습니다. 백업 만료: ${d.backup_expiry || '최장 30일'}`);
      resetFlow();
      go('dashboard');
    } catch (err) { toast(err.message, true); }
  });

  $$('[data-practice]').forEach((b) => b.addEventListener('click', () => startPractice(b.dataset.practice)));
  renderTransferBox(r);
}

function renderInstitutionLink(link) {
  if (!link || link.mode === 'general') return '';
  const rows = (link.links || []).map((l) => `<li><span class="val">${esc(l.requirement)}</span>${basisTag(l.basis)}<span class="meta">${esc(l.note || '')}${l.observed_with_evidence ? '' : ' · 근거 보완 필요'}</span></li>`).join('');
  const uncovered = (link.uncovered || []).map((u) => `<li><span class="val">${esc(u.requirement)}</span><span class="tag">미관찰</span><span class="meta">${esc(u.note || '')}</span></li>`).join('');
  return `<section><h2>기관 요구와 답변의 연결</h2><p class="hint">${esc(link.note || '')}</p><ul class="claims">${rows || '<li>연결된 요구 없음</li>'}${uncovered}</ul></section>`;
}

function renderTransferBox(r) {
  const box = $('#transferBox');
  if (!box) return;
  if (state.comparison) {
    box.innerHTML = '<p class="hint">이미 비교한 재연습이 있습니다.</p><button class="ghost small" type="button" data-go="repractice">비교 결과 보기</button>';
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    return;
  }
  box.innerHTML = `<p class="hint">위의 “새 질문으로 재연습”을 누르면 같은 역량의 다른 질문으로 이동합니다. 재연습을 마치면 비교가 자동으로 준비됩니다.</p>`;
  void r;
}

async function checkAppeal(id) {
  try {
    const a = await api(`/appeals/${encodeURIComponent(id)}`);
    toast(`이의 ${a.status} · 유형 ${a.category} · 접수 ${fmtDate(a.created_at)}`);
  } catch (err) { toast(err.message, true); }
}

function downloadJson(payload, name) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- 7. 재연습 비교 ----
async function startPractice(competency) {
  const r = state.lastReport;
  if (!r?.evaluation_id) { toast('먼저 코칭 보고서가 필요합니다.', true); return; }
  try {
    const p = await api('/practice-attempts', { method: 'POST', idempotent: true, body: { evaluation_id: r.evaluation_id, competency_id: competency } });
    state.transfer = p;
    state.comparison = null;
    state.flow = 'repractice';
    state.practiceSession = { id: p.id, version: p.version };
    state.repracticeStarted = false;
    go('repractice');
    const body = $('#repracticeBody');
    if (body) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, true);
  }
}

function renderRepractice() {
  const box = $('#repracticeBody');
  if (!box) return;
  const p = state.transfer;
  if (!p) {
    box.innerHTML = `<div class="empty-state"><h2>재연습할 역량이 없습니다</h2><p>피드백 화면에서 “같은 역량의 새 질문으로 재연습”을 눌러 시작하세요.</p><button class="ghost" type="button" data-go="feedback">피드백으로</button></div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    return;
  }
  const cmp = state.comparison;
  const started = !!state.repracticeStarted;
  box.innerHTML = `
    <div class="compare-grid">
      <article class="card compare-card baseline">
        <p class="eyebrow">1차 · 기준 답변</p>
        <h2>이전 질문</h2>
        <p>${esc(p.baseline_question || '기준 질문 없음')}</p>
        ${p.baseline_excerpt ? `<blockquote>“${esc(p.baseline_excerpt)}”</blockquote>` : '<p class="fine">기준 답변 발췌가 없습니다.</p>'}
      </article>
      <article class="card compare-card target">
        <p class="eyebrow">2차 · 같은 역량, 새 질문</p>
        <h2>지금 질문</h2>
        <p><strong>${esc(p.transfer_question?.text || '')}</strong></p>
        <p class="fine">${esc(p.transfer_question?.novelty_guard || '')}</p>
        <p class="fine">역량: ${esc(dimLabel(p.competency_id))} · 루브릭: ${esc(p.rubric_version || '')}</p>
      </article>
    </div>
    <div class="card">
      <div class="card-head">
        <h2>진행</h2>
        <span class="state-badge ${started ? 'ok' : 'warn'}">${started ? '재연습 진행/완료' : '시작 전'}</span>
      </div>
      ${started
        ? `<p class="hint">재연습 답변을 제출하면 같은 루브릭으로 비교가 자동 생성됩니다.</p>
           <div class="actions"><button class="ghost" type="button" data-go="feedback">재연습 코칭 보기</button><button class="ghost" type="button" id="restartCompareBtn">다른 역량으로 다시 고르기</button></div>`
        : `<p class="hint">같은 역량을 묻지만 문면이 다른 질문입니다. 이전 답변과 같은 사례를 반복하지 말고 다른 상황·선택을 설명하세요.</p>
           <div class="actions"><button class="primary" type="button" id="startRepracticeBtn">재연습 시작 (90초)</button><button class="ghost" type="button" data-go="feedback">피드백으로</button></div>`}
      <p class="fine" id="repracticeError" role="alert"></p>
    </div>
    <div id="comparisonBox">${cmp ? renderComparisonHtml(cmp) : ''}</div>`;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#startRepracticeBtn')?.addEventListener('click', startRepractice);
  $('#restartCompareBtn')?.addEventListener('click', () => go('feedback'));
}

async function startRepractice() {
  const p = state.transfer;
  if (!p) return;
  const btn = $('#startRepracticeBtn');
  if (btn) { btn.disabled = true; btn.textContent = '준비 중…'; }
  try {
    const started = await api(`/sessions/${p.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: state.practiceSession.version, type: 'session.start', payload: {} },
    });
    state.practiceSession.version = started.version;
    state.session = { id: p.id, version: started.version };
    state.type = 'general';
    state.flow = 'repractice';
    state.repracticeStarted = true;
    enterRoom({
      started,
      session: { limits: { duration_seconds: p.limits?.duration_seconds || 90, duration_minutes: 2 }, interview_type: 'general' },
      inputMode: 'text',
      durationSeconds: p.limits?.duration_seconds || 90,
      meta: '재연습 · 같은 역량의 새 질문',
    });
  } catch (err) {
    setError('#repracticeError', err.message);
    if (btn) { btn.disabled = false; btn.textContent = '재연습 시작 (90초)'; }
  }
}

async function runComparison(transferId, retrySessionId) {
  try {
    const out = await api('/transfer-comparisons', { method: 'POST', idempotent: true, body: { transfer_id: transferId, retry_session_id: retrySessionId } });
    state.comparison = out;
    const box = $('#comparisonBox');
    if (box) box.innerHTML = renderComparisonHtml(out);
    else { renderRepractice(); }
    go('repractice');
  } catch (err) {
    const box = $('#comparisonBox');
    if (box) box.innerHTML = `<div class="card"><h2>비교를 만들지 못했습니다</h2><p class="missing">${esc(err.message)}</p></div>`;
  }
}

function renderComparisonHtml(out) {
  const c = out.comparison || {};
  const ev = (c.evidence || []).map((e) => `
    <li>
      <span class="val">${e.attempt === 'baseline' ? '1차 답변' : '재연습 답변'}</span>
      <span class="meta">질문: ${esc(e.question || '')}<br />발언: “${esc(e.quote || '')}”</span>
    </li>`).join('');
  const statusLabel = {
    observed_change: '관찰된 변화',
    no_clear_change: '뚜렷한 변화 없음',
    insufficient_evidence: '판단 보류',
  }[c.status] || c.status;
  return `
    <div class="card comparison">
      <div class="card-head">
        <h2>비교 결과</h2>
        <span class="state-badge ${c.status === 'observed_change' ? 'ok' : c.status === 'no_clear_change' ? 'warn' : ''}">${esc(statusLabel || '')}</span>
      </div>
      <p><strong>${esc(c.headline || c.reason || '')}</strong></p>
      <p class="fine">역량: ${esc(dimLabel(out.competency || c.competency || ''))} · 루브릭: ${esc(c.rubric_version || out.rubric_version || '')}${Number.isFinite(c.delta) ? ` · 관찰 수준 차이: ${esc(String(c.delta))}` : ''}</p>
      ${ev ? `<ul class="claims">${ev}</ul>` : '<p class="hint">비교할 발언 근거가 부족합니다.</p>'}
      ${c.caution ? `<p class="fine">${esc(c.caution)}</p>` : ''}
      <p class="fine">이 비교는 단일 재연습 결과이며 학습 효과를 입증하지 않습니다.</p>
    </div>`;
}

// ---- 8. 기록·데이터 ----
async function loadHistory() {
  const box = $('#historyBody');
  if (!box) return;
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const { sessions } = await api('/sessions');
    if (!sessions?.length) {
      box.innerHTML = '<div class="empty-state"><h2>아직 기록이 없습니다</h2><p>대시보드에서 첫 면접을 시작해 보세요.</p><button class="ghost" type="button" data-go="dashboard">대시보드로</button></div>';
      $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
      return;
    }
    box.innerHTML = sessions.map((s) => `
      <div class="list-item">
        <div>
          <strong>${esc(typeLabel(s.interview_type))} 면접</strong>
          <div class="meta">${esc(fmtDate(s.created_at))} · ${esc(String(s.question_count || 0))}문항 · ${esc(s.persona || '')} · ${esc(stateLabel(s.state))}${s.blind ? ' · 블라인드' : ''}</div>
        </div>
        <div class="list-actions">
          <span class="state-badge ${s.state === 'completed' ? 'ok' : ''}">${esc(stateLabel(s.state))}</span>
          <button class="ghost small" type="button" data-open-session="${esc(s.id)}" data-state="${esc(s.state)}">${s.state === 'completed' ? '코칭 보기' : '열기'}</button>
          <button class="ghost small danger-text" type="button" data-delete-session="${esc(s.id)}">삭제</button>
        </div>
      </div>`).join('');
    $$('[data-open-session]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.openSession, b.dataset.state)));
    $$('[data-delete-session]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await askConfirm('세션 삭제', '이 세션의 답변과 보고서를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '삭제' });
      if (!ok) return;
      try {
        await api(`/sessions/${b.dataset.deleteSession}`, { method: 'DELETE', idempotent: true });
        toast('삭제했습니다.');
        loadHistory();
      } catch (err) { toast(err.message, true); }
    }));
  } catch (err) {
    box.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}

$('#exportAllBtn')?.addEventListener('click', async () => {
  try {
    const ex = await api('/exports', { method: 'POST', idempotent: true, body: { format: 'json' } });
    const payload = await api(`/exports/${ex.job_id}`);
    downloadJson(payload, 'intervu-sessions.json');
    toast('기록 목록을 내보냈습니다.');
  } catch (err) { toast(err.message, true); }
});

$('#deleteAllBtn')?.addEventListener('click', async () => {
  const ok = await askConfirm('모든 세션 삭제', '이 계정의 모든 세션과 보고서를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '모두 삭제' });
  if (!ok) return;
  try {
    const { sessions } = await api('/sessions');
    for (const s of sessions || []) await api(`/sessions/${s.id}`, { method: 'DELETE', idempotent: true });
    $('#deleteAllResult').textContent = `${(sessions || []).length}개 세션을 삭제했습니다. (백업 최장 30일)`;
    toast('전체 삭제 완료');
    loadHistory();
  } catch (err) { toast(err.message, true); }
});

$('#deleteAccountBtn')?.addEventListener('click', async () => {
  const ok = await askConfirm('계정 전체 삭제', '계정의 모든 세션·프로필·보고서·이의를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '계정 삭제' });
  if (!ok) return;
  try {
    const d = await api('/account', { method: 'DELETE', idempotent: true });
    $('#deleteAllResult').textContent = `계정 삭제 완료. 백업 만료: ${d.backup_expiry || '최장 30일'}`;
    resetFlow();
    toast('계정 전체 삭제 완료');
    go('dashboard');
  } catch (err) { toast(err.message, true); }
});

// 월간 역량(사용자): 공개본만
async function loadTrendLookup() {
  const seg = $('#trendSegment')?.value || 'company';
  const monthInput = $('#trendMonth');
  if (monthInput && !monthInput.value) {
    const d = new Date();
    monthInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const month = monthInput?.value;
  const box = $('#trendResult');
  if (!box || !month) return;
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const t = await api(`/trends/${encodeURIComponent(seg)}/${encodeURIComponent(month)}`);
    if (t.status !== 'monthly_trend' || !t.items?.length) {
      box.innerHTML = `<p class="hint">${esc(t.note || '이 달에 공개된 월간 역량 자료가 없습니다. 일반 기준으로 연습하세요.')}</p>`;
      return;
    }
    box.innerHTML = `
      <p class="fine">검수·승인된 월간 보조 기준입니다. 기관 공식 요구가 아닙니다. (버전 ${esc(String(t.version))})</p>
      <ul class="claims">${t.items.map((i) => `<li><span class="val">${esc(i.competency)}</span><span class="tag trend">월간 트렌드</span><span class="meta">${esc(i.comment || '')}${i.sources?.length ? `<br />출처: ${i.sources.map(esc).join(', ')}` : ''}</span></li>`).join('')}</ul>`;
  } catch (err) {
    box.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}
$('#trendSegment')?.addEventListener('change', loadTrendLookup);
$('#trendMonth')?.addEventListener('change', loadTrendLookup);

// ---- 9. 관리자 ----
function adminId(segment, month) {
  return encodeURIComponent(`${segment}|${month}`);
}

async function initAdmin() {
  if (state.adminRequired === null) await loadProvider();
  const note = $('#adminGateNote');
  const gate = $('#adminGate');
  const panel = $('#adminPanel');
  if (state.adminRequired === false) {
    if (note) note.textContent = 'ADMIN_TOKEN이 설정되지 않은 개발 모드입니다. 개발 토큰으로 관리 기능을 사용할 수 있습니다.';
    state.adminUnlocked = true;
  }
  if (state.adminUnlocked) {
    gate.hidden = true;
    panel.hidden = false;
    ensureTrendItems();
    await loadAdminHistory();
    return;
  }
  gate.hidden = false;
  panel.hidden = true;
  if (note && state.adminRequired) note.textContent = '서버에 ADMIN_TOKEN이 설정되어 있습니다. 관리자 토큰을 입력하세요.';
  if (state.adminToken) {
    const ok = await verifyAdmin();
    if (ok) { gate.hidden = true; panel.hidden = false; ensureTrendItems(); await loadAdminHistory(); }
  }
}

async function verifyAdmin() {
  try {
    const input = $('#adminTokenInput');
    const token = (input?.value || state.adminToken || '').trim();
    if (!token) { setError('#adminError', '관리자 토큰을 입력하세요.'); return false; }
    state.adminToken = token;
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await api(`/admin/trends/${adminId('company', month)}/history`, { admin: true });
    sessionStorage.setItem(ADMIN_KEY, token);
    state.adminUnlocked = true;
    setError('#adminError', '');
    return true;
  } catch (err) {
    state.adminUnlocked = false;
    sessionStorage.removeItem(ADMIN_KEY);
    setError('#adminError', err.status === 403 ? '관리자 토큰이 올바르지 않습니다.' : err.message);
    return false;
  }
}

$('#adminUnlockBtn')?.addEventListener('click', async () => {
  const ok = await verifyAdmin();
  if (!ok) return;
  $('#adminGate').hidden = true;
  $('#adminPanel').hidden = false;
  ensureTrendItems();
  await loadAdminHistory();
  toast('관리자 화면을 열었습니다.');
});

function ensureTrendItems() {
  const box = $('#trendItems');
  if (!box) return;
  if (!box.children.length) addTrendItem();
}
function addTrendItem(value = '', comment = '') {
  const box = $('#trendItems');
  if (!box || box.children.length >= 3) return;
  const row = document.createElement('div');
  row.className = 'trend-item';
  row.innerHTML = `
    <label class="field"><span>역량</span><input class="trend-competency" maxlength="60" value="${esc(value)}" placeholder="예: 문제 해결" /></label>
    <label class="field"><span>코멘트 (1~2문장)</span><input class="trend-comment" maxlength="200" value="${esc(comment)}" placeholder="예: 최근 공고에서 문제 해결 요구가 늘었습니다." /></label>
    <button class="ghost small" type="button" data-remove-item>삭제</button>`;
  row.querySelector('[data-remove-item]').addEventListener('click', () => row.remove());
  box.appendChild(row);
}
$('#addTrendItemBtn')?.addEventListener('click', () => {
  if ($('#trendItems')?.children.length >= 3) { toast('월·분야별 최대 3개까지 등록할 수 있습니다.', true); return; }
  addTrendItem();
});

$('#trendForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const items = $$('#trendItems .trend-item').map((row) => ({
    competency: row.querySelector('.trend-competency').value.trim(),
    comment: row.querySelector('.trend-comment').value.trim(),
  })).filter((i) => i.competency);
  setError('#trendError', '');
  if (!items.length) { setError('#trendError', '역량을 하나 이상 입력하세요.'); return; }
  try {
    await api('/admin/trends', {
      method: 'POST', idempotent: true, admin: true,
      body: {
        segment: fd.get('segment'),
        yyyy_mm: fd.get('yyyy_mm'),
        items,
        comment: fd.get('comment') || '',
        sources: String(fd.get('sources') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10),
      },
    });
    toast('초안으로 저장했습니다. 공개 전에는 사용자에게 노출되지 않습니다.');
    await loadAdminHistory();
  } catch (err) {
    setError('#trendError', err.message);
  }
});

$('#trendLoadBtn')?.addEventListener('click', () => loadAdminHistory());

async function adminMonth() {
  const fd = new FormData($('#trendForm'));
  const seg = fd.get('segment') || 'company';
  let month = String(fd.get('yyyy_mm') || '');
  if (!month) {
    const d = new Date();
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const input = $('#trendForm [name="yyyy_mm"]');
    if (input) input.value = month;
  }
  return { seg, month };
}

async function loadAdminHistory() {
  if (!state.adminUnlocked) return;
  const box = $('#trendList');
  if (!box) return;
  const { seg, month } = await adminMonth();
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const data = await api(`/admin/trends/${adminId(seg, month)}/history`, { admin: true });
    const versions = data.versions || [];
    if (!versions.length) {
      box.innerHTML = `<p class="hint">${esc(seg)} · ${esc(month)}에 등록된 버전이 없습니다.</p>`;
      return;
    }
    box.innerHTML = versions.slice().reverse().map((v) => `
      <div class="list-item">
        <div>
          <strong>v${esc(String(v.version))} · ${v.status === 'published' ? '공개' : '초안'}</strong>
          <div class="meta">${(v.items || []).map((i) => esc(i.competency)).join(' · ') || '역량 없음'}${v.rolled_back_from ? ` · v${esc(String(v.rolled_back_from))}에서 롤백` : ''}</div>
          <div class="meta">등록 ${esc(fmtDate(v.created_at))}${v.published_at ? ` · 공개 ${esc(fmtDate(v.published_at))}` : ''}${v.comment ? ` · ${esc(v.comment)}` : ''}</div>
        </div>
        <div class="list-actions">
          <span class="state-badge ${v.status === 'published' ? 'ok' : 'warn'}">${v.status === 'published' ? '공개' : '초안'}</span>
          ${v.status === 'published'
            ? `<button class="ghost small" type="button" data-rollback="${esc(String(v.version))}">이 버전으로 롤백</button>`
            : `<button class="primary small" type="button" data-publish="${esc(String(v.version))}">공개</button>`}
        </div>
      </div>`).join('');
    $$('[data-publish]').forEach((b) => b.addEventListener('click', () => publishTrend(seg, month, b.dataset.publish)));
    $$('[data-rollback]').forEach((b) => b.addEventListener('click', () => rollbackTrend(seg, month, b.dataset.rollback)));
  } catch (err) {
    box.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}

async function publishTrend(seg, month, version) {
  try {
    await api(`/admin/trends/${adminId(seg, month)}/publish`, { method: 'POST', idempotent: true, admin: true, body: { version: Number(version) } });
    toast(`v${version}을 공개했습니다.`);
    await loadAdminHistory();
  } catch (err) { toast(err.message, true); }
}
async function rollbackTrend(seg, month, version) {
  const ok = await askConfirm('롤백', `v${version} 내용으로 롤백할까요? 새 버전으로 기록되며 이전 버전은 보존됩니다.`);
  if (!ok) return;
  try {
    const v = await api(`/admin/trends/${adminId(seg, month)}/rollback`, { method: 'POST', idempotent: true, admin: true, body: { version: Number(version) } });
    toast(`v${v.version}(으)로 롤백했습니다.`);
    await loadAdminHistory();
  } catch (err) { toast(err.message, true); }
}

// ---- 초기화 ----
function resetFlow() {
  clearInterval(state.timer);
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
  if (voiceRecognizer) stopVoice();
  state.profile = null;
  state.versionId = null;
  state.sources = [];
  state.approved = false;
  state.session = null;
  state.flow = 'interview';
  state.transfer = null;
  state.comparison = null;
  state.lastReport = null;
  state.questionCount = 0;
  state.paused = false;
  state.uploadedText = '';
  state.finished = false;
  state.finishing = false;
  const form = $('#applicationForm');
  if (form) form.reset();
  const setup = $('#setupForm');
  if (setup) setup.reset();
  const note = $('#evidenceNote');
  if (note) note.value = '';
  updateSetupSummary();
}

(async function boot() {
  await loadProvider();
  await loadCatalog();
  updateSetupSummary();
  const initial = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  renderScreen(SCREENS.includes(initial) ? initial : 'dashboard');
  if (!location.hash) location.hash = '#/dashboard';
})();
