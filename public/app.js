// Intervu MVP SPA (의존성 없음)
const TOKEN_KEY = 'intervu.token';
const state = {
  token: localStorage.getItem(TOKEN_KEY) || 'dev-user-a-token',
  profile: null,
  versionId: null,
  session: null,
  remaining: 0,
  timer: null,
  paused: false,
  endAt: 0,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function toast(message, isError = false) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 4200);
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function api(path, { method = 'GET', body, idempotent = false } = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotent) headers['Idempotency-Key'] = uuid();
  const res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `요청 실패 (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'history') loadHistory();
  if (name === 'privacy') loadProvider();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setStep(step, label, done = false) {
  const card = document.querySelector(`.step[data-step="${step}"]`);
  if (!card) return;
  const badge = card.querySelector('[data-state-label]');
  if (badge) { badge.textContent = label; badge.classList.toggle('done', done); }
}

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

async function loadProvider() {
  try {
    const h = await api('/health');
    const chip = $('#providerChip');
    const freeOnly = h.provider.freeOnly !== false;
    if (h.provider.selected === 'gemini') {
      chip.textContent = freeOnly ? 'Gemini 연결됨 · 무료 전용' : 'Gemini 연결됨';
    } else {
      chip.textContent = 'Mock 모드';
    }
    chip.className = `provider-chip ${h.provider.selected}`;
    const detail = $('#providerDetail');
    if (detail) detail.textContent = h.provider.note + (h.provider.killSwitch && h.provider.killSwitch !== 'none' ? ' (외부 호출 차단 중)' : '');
    state.geminiModel = h.provider.textModel || null;
    // 무료 테스트 가능 여부: 키 있음 + 합성 허용(allowUnpaid) → UI에서 synthetic 플래그 전송
    state.freeTestAvailable = !!h.provider.configured && !!h.provider.allowUnpaid && !String(h.provider.killSwitch || '').includes('gemini');
    const freeBox = $('#freeTestRow');
    if (freeBox) freeBox.hidden = !state.freeTestAvailable;
    if (!state.freeTestAvailable) {
      const chip2 = $('#providerChip');
      chip2.textContent = 'Mock 모드 (무료 테스트 불가)';
      chip2.title = '서버에 GEMINI_API_KEY + GEMINI_ALLOW_UNPAID=true가 필요합니다.';
    }
  } catch {
    $('#providerChip').textContent = '서버 연결 실패';
    $('#providerChip').className = 'provider-chip';
  }
  try {
    const s = await api('/stt/status');
    const chip = $('#sttChip');
    state.stt = s;
    if (!s.configured) {
      chip.textContent = 'STT 미설정 · 텍스트 입력';
      chip.className = 'provider-chip stt-off';
      setSttStatus('음성 인식 키가 없습니다. 텍스트로 답해 주세요.', 'warn');
    } else if (s.provider === 'disabled') {
      chip.textContent = 'STT 비활성화';
      chip.className = 'provider-chip stt-off';
      setSttStatus(s.message || '음성 인식이 비활성화되어 있습니다.', 'warn');
    } else {
      chip.textContent = `Groq 전사 · ${s.model || 'whisper'}`;
      chip.className = 'provider-chip stt-ok';
      setSttStatus(s.message || `Groq 한국어 전사를 사용할 수 있습니다. (최대 ${s.maxRecordingSeconds || 120}초)`, 'ok');
    }
  } catch {
    const chip = $('#sttChip');
    if (chip) { chip.textContent = 'STT 확인 실패'; chip.className = 'provider-chip'; }
    setSttStatus('전사 상태를 확인하지 못했습니다. 텍스트로 답할 수 있습니다.', 'warn');
  }
}

function setSttStatus(text, cls = '') {
  const el = $('#sttStatus');
  if (!el) return;
  el.textContent = text;
  el.className = cls;
}

// ---- 1. profile ----
$('#profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const experiences = String(fd.get('experiences') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = '분석 중…';
  try {
    const payload = {
      org_type: fd.get('org_type'),
      target_name: String(fd.get('target_name') || '').trim(),
      role: String(fd.get('role') || '').trim(),
      source_text: String(fd.get('source_text') || '').trim(),
      sources: String(fd.get('source_urls') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).map((url) => ({ url, kind: 'official' })),
      experiences,
    };
    const created = await api('/profiles', { method: 'POST', body: payload, idempotent: true });
    state.profile = created;
    state.institution = created.institution || null;
    state.institutionStatus = created.institution_status || null;
    const detail = await api(`/profiles/${created.id}`);
    state.versionId = created.version_id;
    state.sources = detail.sources || [];
    renderExtract(detail, created);
    $('#extractCard').hidden = false;
    setStep('profile', '완료', true);
    setStep('extract', '확인 필요');
    if (created.pii_warnings?.length) toast(`개인정보 후보(${created.pii_warnings.join(', ')})를 마스킹했습니다.`);
    $('#extractCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = '공고 분석하기';
  }
});

$('#skipProfileBtn').addEventListener('click', () => {
  state.profile = null;
  state.versionId = null;
  $('#extractCard').hidden = true;
  $('#setupCard').hidden = false;
  setStep('profile', '건너뜀(일반)', true);
  setStep('setup', '진행 중');
  $('#setupCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('공고 없이 일반 연습으로 진행합니다.');
});

$('#backToProfileBtn').addEventListener('click', () => {
  $('#extractCard').hidden = true;
  setStep('extract', '대기');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function renderExtract(detail, created) {
  const v = detail.current_version || {};
  const ex = v.extracted || {};
  const claims = ex.claims || [];
  const rows = claims.length
    ? claims.map((c) => `<li><span class="val">${esc(c.value)}</span><span class="tag user">사용자 입력</span><span class="meta">출처: “${esc(c.quote)}” · 원문 위치 ${c.start_cp}–${c.end_cp}</span></li>`).join('')
    : `<li><span class="val">확인된 기관 고유 역량 없음</span><span class="tag">일반 템플릿</span><span class="meta">공고가 없거나 추출하지 못했습니다. 일반 역량으로 연습하며 ‘기관 맞춤 검증 완료’ 배지는 표시하지 않습니다.</span></li>`;
  const missing = (ex.missing_fields || []).map((f) => ({
    discussion_format: '토론면접 여부', interview_duration: '면접 시간', participant_count: '참여 인원', extraction_failed: '공고 분석(일반 템플릿 사용)',
  }[f] || f));
  $('#extractBody').innerHTML = `
    <ul class="claims">${rows}</ul>
    ${missing.length ? `<p class="missing">공고에서 확인되지 않음: ${missing.map(esc).join(', ')} — 연습 가정으로 진행합니다.</p>` : ''}
    ${ex.rejected_spans ? `<p class="missing">출처 구간 불일치 ${ex.rejected_spans}건을 제외했습니다.</p>` : ''}
    <p class="fine">공급자: ${esc(created.provider)} · 사용자 승인 전에는 세션을 시작할 수 없습니다.</p>`;
  renderInstitution(detail.institution || created.institution || null, detail.sources || []);
}

function basisTag(basis) {
  if (basis === 'official') return '<span class="tag official">공식 자료 확인</span>';
  if (basis === 'user') return '<span class="tag user">사용자 입력</span>';
  return '<span class="tag">연습 가정</span>';
}

function renderInstitution(inst, sources) {
  const box = $('#institutionBody');
  if (!box) return;
  if (!inst) { box.innerHTML = ''; return; }
  const values = (inst.core_values || []).map((c) => `<li><span class="val">${esc(c.label)}</span>${basisTag(c.basis)}<span class="meta">${c.source_title ? `근거: “${esc(c.source_quote)}” · ${esc(c.source_title)}` : esc(c.note || '일반 역량으로 연습합니다.')}</span></li>`).join('');
  const formats = (inst.formats || []).map((f) => `<li><span class="val">${esc(f.item)}</span>${basisTag(f.basis)}<span class="meta">${esc(f.note || '')}</span></li>`).join('');
  const recs = (inst.recommended_questions || []).map((q) => `<li><span class="val">${esc(q.text)}</span>${basisTag(q.basis)}<span class="meta">${esc(q.rationale || '')}</span></li>`).join('');
  const unev = (inst.unevaluable || []).map((u) => `<li><span class="val">${esc(u.area)}</span><span class="tag">평가 불가</span><span class="meta">${esc(u.reason)}</span></li>`).join('');
  const fresh = (inst.sources_summary?.freshness || []).map((f) => `<li><span class="val">${esc(f.title || '출처')}</span><span class="tag ${f.state === 'fresh' ? 'official' : ''}">${esc(f.state)}${f.age_days != null ? ` · ${f.age_days}일` : ''}</span><span class="meta">${esc(f.note || '')}</span></li>`).join('');
  const srcs = (sources || []).map((s) => `<li><span class="val">${esc(s.title || s.url || '출처')}</span><span class="tag ${s.kind === 'official' ? 'official' : 'user'}">${esc(s.kind === 'official' ? '공식' : s.kind === 'unofficial' ? '비공식 참고' : s.kind === 'user' ? '사용자 입력' : '가정')}</span><span class="meta">${esc(s.url || '')}${s.published_at ? ` · 발행 ${esc(s.published_at)}` : ' · 발행일 미확인'} · 확인 ${esc((s.retrieved_at || '').slice(0, 10))}</span></li>`).join('');
  const conflicts = (inst.sources_summary?.conflicts || []).map((c) => `<li><span class="val">${esc(c.key)}</span><span class="tag">상충</span><span class="meta">서로 다른 값 ${c.count}건 — 단정하지 않고 해당 항목은 보류합니다.</span></li>`).join('');
  box.innerHTML = `
    <div class="inst-head"><strong>${esc(inst.org_label)} · ${esc(inst.target_name || '기관 미지정')} · ${esc(inst.role || '직무·학과 미지정')}</strong><span class="tag ${inst.fallback_to_general ? '' : 'official'}">${esc(inst.badge)}</span></div>
    <h3>핵심 가치·요구 역량</h3><ul class="claims">${values || '<li>확인된 역량 없음</li>'}</ul>
    <h3>면접 형식·전형 조건</h3><ul class="claims">${formats}</ul>
    <h3>권장 연습 질문 (질문별 근거)</h3><ul class="claims">${recs}</ul>
    <h3>평가 가능한 영역 / 불가 영역</h3><ul class="claims">${(inst.evaluable || []).map((e2) => `<li><span class="val">${esc(e2.label)}</span>${basisTag(e2.basis)}</li>`).join('')}${unev}</ul>
    ${srcs ? `<h3>출처 (URL·발행일·확인일)</h3><ul class="claims">${srcs}</ul>` : ''}
    ${fresh ? `<h3>자료 신선도</h3><ul class="claims">${fresh}</ul>` : ''}
    ${conflicts ? `<h3>상충 자료</h3><ul class="claims">${conflicts}</ul>` : ''}
    <p class="fine">${esc(inst.disclaimer || '')}</p>`;
}

$('#approveBtn').addEventListener('click', async () => {
  if (!state.profile) return;
  try {
    const note = ($('#institutionNote')?.value || '').trim();
    await api(`/profiles/${state.profile.id}/approve`, { method: 'POST', body: { version_id: state.versionId, institution_edits: note ? { note } : {} }, idempotent: true });
    $('#setupCard').hidden = false;
    setStep('extract', '승인 완료', true);
    setStep('setup', '진행 중');
    $('#setupCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('공고 버전과 기관 분석을 승인했습니다. 면접을 설정하세요.');
  } catch (err) { toast(err.message, true); }
});

// ---- 2. session ----
const blindCheckbox = document.querySelector('#sessionForm input[name="blind"]');
blindCheckbox?.addEventListener('change', () => { $('#blindNote').hidden = !blindCheckbox.checked; });

// 면접 유형 카탈로그(서버가 단일 출처) + 유형별 보조 설정
const TYPE_FALLBACK = [
  { id: 'general', label: '일반·인성 면접', desc: '자기소개·지원동기·경험·협업·꼬리질문' },
  { id: 'technical', label: '직무·기술 면접', desc: '직무별 질문·개념 설명·문제해결 과정 검토' },
  { id: 'discussion', label: '토론면접', desc: '사용자 1명 + AI 2명 + 사회자, 입론·반론·합의' },
  { id: 'pt', label: 'PT 면접', desc: '과제 제시 → 준비 → 발표 → 질의응답' },
  { id: 'situational', label: '상황·역할극 면접', desc: '고객 응대·갈등 해결·돌발 상황 시뮬레이션' },
  { id: 'panel', label: '패널 면접', desc: 'HR·실무자·관리자 등 여러 AI 면접관의 질문' },
];
const catalog = { types: TYPE_FALLBACK, roles: [], panel_presets: {}, topics: [], pt_tasks: [], scenarios: [] };
let selectedType = 'general';

function renderTypeGrid() {
  const grid = $('#typeGrid');
  grid.innerHTML = catalog.types.map((t) => `
    <button type="button" class="type-card" role="radio" aria-checked="${t.id === selectedType}" data-type="${esc(t.id)}">
      <strong>${esc(t.label)}</strong><span>${esc(t.desc)}</span>
    </button>`).join('');
  grid.querySelectorAll('.type-card').forEach((b) => b.addEventListener('click', () => selectType(b.dataset.type)));
}

function selectType(id) {
  selectedType = id;
  $('#typeGrid').querySelectorAll('.type-card').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === id)));
  const isPanel = id === 'panel';
  $('#panelRoleRow').hidden = !isPanel;
  const variantLabel = $('#variantRow');
  const variantSelect = $('#variantSelect');
  let opts = [];
  if (id === 'discussion') opts = (catalog.topics || []).map((t) => ({ id: t.id, label: t.title }));
  if (id === 'pt') opts = (catalog.pt_tasks || []).map((t) => ({ id: t.id, label: t.title }));
  if (id === 'situational') opts = (catalog.scenarios || []).map((t) => ({ id: t.id, label: t.title }));
  variantLabel.hidden = opts.length === 0;
  variantLabel.firstChild.textContent = id === 'discussion' ? '토론 주제' : id === 'pt' ? 'PT 과제' : '상황 시나리오';
  variantSelect.innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
  // 역할 기본값: 기술=기술 면접관, 패널=프리셋에 맡김, 그 외 자동
  const roleSel = $('#sessionForm select[name="interviewer_role"]');
  if (id === 'technical') roleSel.value = 'expert';
  else if (id === 'panel' || roleSel.value === 'expert') roleSel.value = '';
  // 토론은 AI 2명 + 사회자 구조라 역할 선택을 사회자 역할로 안내
  roleSel.disabled = false;
}

function renderPanelRoles(roles) {
  const group = $('#panelRoleGroup');
  group.innerHTML = roles.map((r) => `<label><input type="checkbox" name="panel_role" value="${esc(r.id)}" /> ${esc(r.label)}</label>`).join('');
}

$('#panelPreset')?.addEventListener('change', (e) => {
  const preset = catalog.panel_presets?.[e.target.value] || ['hr', 'practitioner', 'executive'];
  $('#panelRoleGroup').querySelectorAll('input').forEach((i) => { i.checked = preset.includes(i.value); });
});

async function loadCatalog() {
  try {
    const data = await api('/interview-types');
    Object.assign(catalog, data);
    renderTypeGrid();
    renderPanelRoles(data.roles || []);
    const preset = catalog.panel_presets?.default || ['hr', 'practitioner', 'executive'];
    $('#panelRoleGroup').querySelectorAll('input').forEach((i) => { i.checked = preset.includes(i.value); });
    selectType(selectedType);
  } catch {
    renderTypeGrid();
    selectType(selectedType);
  }
}
loadCatalog();

// ---- 음성 입력: 브라우저 SpeechRecognition → 텍스트 확인 후 전송 (원음 서버 전송 없음) ----
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
function setMicStatus(text, cls = '') {
  const el = $('#micStatus');
  if (!el) return;
  el.textContent = text;
  el.className = cls;
}
if (!SpeechRec) {
  setMicStatus('이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트로 답해 주세요.', 'warn');
  $('#inputModeSelect').value = 'text';
  const voiceOpt = $('#inputModeSelect').querySelector('option[value="voice"]');
  if (voiceOpt) { voiceOpt.disabled = true; voiceOpt.textContent = '음성 (이 브라우저 미지원)'; }
} else {
  setMicStatus('음성 인식을 사용할 수 있습니다. (Chrome/Edge 권장)', 'ok');
}

$('#micTestBtn')?.addEventListener('click', async () => {
  if (!SpeechRec) return setMicStatus('음성 인식을 지원하지 않는 브라우저입니다.', 'warn');
  const btn = $('#micTestBtn');
  btn.disabled = true;
  setMicStatus('마이크 권한을 확인하는 중…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    const test = new SpeechRec();
    test.lang = 'ko-KR';
    test.interimResults = false;
    test.maxAlternatives = 1;
    let heard = '';
    test.onresult = (ev) => { heard = ev.results[0][0].transcript; };
    test.onerror = (ev) => setMicStatus(`테스트 실패: ${ev.error}. 브라우저 마이크 설정을 확인하세요.`, 'warn');
    test.onend = () => setMicStatus(heard ? `인식됨: “${heard.slice(0, 60)}” — 음성 답변을 사용할 수 있습니다.` : '소리가 인식되지 않았습니다. 마이크 위치를 확인하세요.', heard ? 'ok' : 'warn');
    test.start();
    setTimeout(() => { try { test.stop(); } catch { /* noop */ } }, 3200);
  } catch {
    setMicStatus('마이크 권한이 거부되었습니다. 텍스트로 답해 주세요.', 'warn');
  } finally {
    setTimeout(() => { btn.disabled = false; }, 3600);
  }
});

function stopRecognizer() {
  if (!recognizer) return;
  try { recognizer.stop(); } catch { /* noop */ }
  recognizer = null;
  const b = $('#voiceBtn');
  if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = '🎙 말로 답하기'; }
  const s = $('#voiceStatus');
  if (s) s.textContent = '인식된 텍스트를 확인·수정한 뒤 “답변 완료”를 누르세요.';
}

$('#voiceBtn')?.addEventListener('click', () => {
  if (!SpeechRec) return toast('이 브라우저는 음성 인식을 지원하지 않습니다.', true);
  if (recognizer) return stopRecognizer();
  const answer = $('#answerText');
  const base = answer.value.trim();
  recognizer = new SpeechRec();
  recognizer.lang = 'ko-KR';
  recognizer.continuous = true;
  recognizer.interimResults = true;
  let finalText = base ? `${base} ` : '';
  recognizer.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const chunk = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += `${chunk} `;
      else interim += chunk;
    }
    answer.value = `${finalText}${interim}`.trim();
    $('#charCount').textContent = [...answer.value].length;
  };
  recognizer.onerror = (ev) => {
    const msg = ev.error === 'not-allowed' ? '마이크 권한이 거부되었습니다.' : `음성 인식 오류: ${ev.error}`;
    toast(msg, true);
    stopRecognizer();
  };
  recognizer.onend = () => { if (recognizer) stopRecognizer(); };
  recognizer.start();
  const b = $('#voiceBtn');
  b.setAttribute('aria-pressed', 'true');
  b.textContent = '■ 인식 중지';
  $('#voiceStatus').textContent = '듣는 중입니다. 말이 끝나면 “인식 중지”를 누르세요.';
});

const inputModeSelect = $('#inputModeSelect');
inputModeSelect?.addEventListener('change', () => {
  const v = inputModeSelect.value;
  $('#voiceRow').hidden = v !== 'voice';
  $('#sttRow').hidden = v !== 'groq';
  if (v === 'groq') {
    updateSttButtons();
    setSttStatus(state.stt?.configured ? (state.stt.message || '녹음 후 “전사 요청”을 누르세요.') : '음성 인식 키가 없습니다. 텍스트로 답해 주세요.', state.stt?.configured ? 'ok' : 'warn');
  }
});

// ---- Groq Whisper: 녹음 후 전사 (실시간 스트리밍 없음, 원음은 전사 후 즉시 폐기) ----
let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recBlob = null;
let recMime = '';
let recTimer = null;
let recStartedAt = 0;

function sttLimitSeconds() {
  return Number(state.stt?.maxRecordingSeconds || 120);
}

function updateSttButtons() {
  const recBtn = $('#sttRecBtn');
  const txBtn = $('#sttTranscribeBtn');
  if (!recBtn || !txBtn) return;
  const recording = !!mediaRecorder;
  recBtn.setAttribute('aria-pressed', String(recording));
  recBtn.textContent = recording ? '■ 녹음 중지' : '⏺ 녹음 시작';
  txBtn.disabled = recording || !recBlob;
}

function stopRecTimer() {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
}

function stopMediaStream() {
  if (recStream) { recStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } }); recStream = null; }
}

async function toggleRecording() {
  const recBtn = $('#sttRecBtn');
  if (mediaRecorder) {
    try { mediaRecorder.stop(); } catch { /* noop */ }
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) { setSttStatus('이 브라우저는 녹음을 지원하지 않습니다. 텍스트로 답해 주세요.', 'warn'); return; }
  if (!state.stt?.configured || state.stt?.provider === 'disabled') { setSttStatus('음성 인식을 사용할 수 없습니다. 텍스트로 답해 주세요.', 'warn'); return; }
  try {
    recBtn.disabled = true;
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    recBtn.disabled = false;
    setSttStatus('마이크 권한이 거부되었습니다. 텍스트로 답해 주세요.', 'warn');
    return;
  }
  recChunks = [];
  recBlob = null;
  const limit = sttLimitSeconds();
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
    setSttStatus('녹음을 시작하지 못했습니다. 텍스트로 답해 주세요.', 'warn');
    return;
  }
  recStartedAt = Date.now();
  mediaRecorder.ondataavailable = (ev) => { if (ev.data?.size) recChunks.push(ev.data); };
  mediaRecorder.onstop = () => {
    stopRecTimer();
    stopMediaStream();
    mediaRecorder = null;
    recBtn.disabled = false;
    try {
      recBlob = new Blob(recChunks, { type: recMime || mediaRecorder?.mimeType || 'audio/webm' });
      recMime = recBlob.type || recMime || 'audio/webm';
    } catch { recBlob = null; }
    recChunks = [];
    updateSttButtons();
    if (!recBlob || !recBlob.size) { setSttStatus('녹음된 소리가 없습니다. 다시 녹음하거나 텍스트로 입력하세요.', 'warn'); return; }
    const secs = Math.round((Date.now() - recStartedAt) / 1000);
    const kb = Math.round(recBlob.size / 1024);
    setSttStatus(`녹음 완료 (${secs}초 · ${kb}KB). “전사 요청”을 누르면 텍스트로 바뀝니다.`, 'ok');
  };
  mediaRecorder.onerror = () => {
    stopRecTimer();
    stopMediaStream();
    mediaRecorder = null;
    recBtn.disabled = false;
    updateSttButtons();
    setSttStatus('녹음 중 오류가 발생했습니다. 텍스트로 답해 주세요.', 'warn');
  };
  mediaRecorder.start(250);
  recBtn.disabled = false;
  updateSttButtons();
  setSttStatus(`녹음 중… 최대 ${limit}초. 끝나면 “녹음 중지”를 누르세요.`, 'rec');
  const tick = () => {
    const left = limit - Math.floor((Date.now() - recStartedAt) / 1000);
    if (left <= 0) {
      try { mediaRecorder?.stop(); } catch { /* noop */ }
      return;
    }
    setSttStatus(`녹음 중… ${left}초 남음. 끝나면 “녹음 중지”를 누르세요.`, 'rec');
  };
  stopRecTimer();
  recTimer = setInterval(tick, 1000);
}

async function transcribeRecording() {
  if (!recBlob || mediaRecorder) return;
  const txBtn = $('#sttTranscribeBtn');
  txBtn.disabled = true;
  setSttStatus('전사 중… (Groq Whisper, 한국어)', 'rec');
  try {
    const fd = new FormData();
    const ext = /mp4/i.test(recMime) ? 'm4a' : /ogg/i.test(recMime) ? 'ogg' : 'webm';
    fd.append('file', recBlob, `answer.${ext}`);
    const headers = { Authorization: `Bearer ${state.token}`, 'Idempotency-Key': uuid() };
    const res = await fetch(`/api/v1/sessions/${state.session.id}/transcriptions`, { method: 'POST', headers, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `전사 실패 (${res.status})`;
      throw Object.assign(new Error(res.status === 429 ? '무료 한도를 소진했습니다. 텍스트로 답해 주세요.' : msg), { status: res.status });
    }
    recBlob = null;
    updateSttButtons();
    if (!data.text) {
      setSttStatus(data.note || '전사 결과가 비어 있습니다. 다시 녹음하거나 텍스트로 입력하세요.', 'warn');
      return;
    }
    const answer = $('#answerText');
    answer.value = String(data.text || '').slice(0, 4000);
    $('#charCount').textContent = [...answer.value].length;
    const extra = data.pii_warnings?.length ? ` 개인정보 후보(${data.pii_warnings.join(', ')})가 있으니 제출 전 확인하세요.` : ' 내용을 확인·수정한 뒤 “답변 완료”를 누르세요.';
    setSttStatus(`전사 완료 (${data.model || 'whisper'}).${extra}`, data.pii_warnings?.length ? 'warn' : 'ok');
    toast('전사가 입력창에 채워졌습니다. 확인 후 제출하세요.');
    answer.focus();
  } catch (e) {
    setSttStatus(e.message || '전사에 실패했습니다. 텍스트로 답해 주세요.', 'warn');
    toast(e.message || '전사에 실패했습니다.', true);
  } finally {
    updateSttButtons();
  }
}

$('#sttRecBtn')?.addEventListener('click', toggleRecording);
$('#sttTranscribeBtn')?.addEventListener('click', transcribeRecording);

$('#sessionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = '준비 중…';
  try {
    const inputMode = fd.get('input_mode') || 'text';
    // 무료 테스트: synthetic 플래그를 세션에 저장 → 이후 turn.text에서 Gemini 경로 허용
    const freeTest = fd.get('free_test') === 'on' && state.freeTestAvailable !== false;
    const body = {
      profile_version_id: state.versionId || undefined,
      interview_type: selectedType,
      persona: fd.get('persona') || 'standard',
      interviewer_role: fd.get('interviewer_role') || undefined,
      blind: fd.get('blind') === 'on',
      duration_minutes: Number(fd.get('duration_minutes')),
      input_mode: inputMode,
      consent_version: 'mvp-2026-10',
      synthetic: freeTest === true ? true : undefined,
    };
    if (selectedType === 'panel') {
      const roles = [...$('#panelRoleGroup').querySelectorAll('input:checked')].map((i) => i.value);
      if (roles.length < 2) throw new Error('패널은 면접관을 2명 이상 선택해 주세요.');
      body.panel_roles = roles;
    }
    const variant = fd.get('variant');
    if (variant) {
      if (selectedType === 'discussion') body.topic_id = variant;
      if (selectedType === 'pt') body.pt_task_id = variant;
      if (selectedType === 'situational') body.scenario_id = variant;
    }
    const s = await api('/sessions', { method: 'POST', idempotent: true, body });
    state.session = s;
    state.type = s.interview_type;
    state.discussLog = [];
    // 일회성 접속 티켓 발급(명세 §10: 실제 WSS 미연동, REST 진행)
    try {
      await api(`/sessions/${s.id}/connect`, { method: 'POST', body: {}, idempotent: true });
    } catch { /* 티켓 실패해도 REST 진행 가능 */ }
    const started = await api(`/sessions/${s.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: s.version, type: 'session.start', payload: {} },
    });
    state.session.version = started.version;
    state.paused = false;
    $('#setupCard').hidden = true;
    setStep('setup', '완료', true);
    $('#roomIdle').hidden = true;
    $('#sessionCard').hidden = false;
    const personaLabel = fd.get('persona') === 'challenging' ? '논리 검증형' : fd.get('persona') === 'supportive' ? '친절형' : '일반형';
    const typeLabel = catalog.types.find((t) => t.id === s.interview_type)?.label || s.interview_type;
    $('#sessionMeta').textContent = `${typeLabel} · ${s.limits.duration_minutes}분 · ${personaLabel} · 블라인드 ${s.blind ? 'ON' : 'OFF'}${s.free_test ? ' · 무료 테스트' : ' · Mock'}`;
    $('#roomState').textContent = 'LIVE'; $('#roomState').classList.add('on');
    questionCount = 0;
    questionTotal = started.question_total || s.limits.question_count || 4;
    $('#voiceRow').hidden = inputMode !== 'voice';
    $('#sttRow').hidden = inputMode !== 'groq';
    updateSttButtons();
    setQuestion(started.question);
    setupRoomForType(s, started);
    startTimer(s.limits.duration_seconds || s.limits.duration_minutes * 60);
    $('#sessionCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#answerText').focus();
    const openingText = started.question?.text || started.pt_task?.brief || '';
    if (s.interview_type === 'discussion') speak(s.topic?.brief || openingText);
    else speak(openingText);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = '면접 시작';
  }
});

// 유형별 방 화면: 맥락 카드·단계 표시·다중 발화 로그를 준비한다.
function setupRoomForType(s, started) {
  const ctx = $('#roomContext');
  const bar = $('#phaseBar');
  const log = $('#discussionLog');
  ctx.hidden = true; bar.hidden = true; log.hidden = true;
  log.innerHTML = ''; state.discussLog = [];
  if (s.interview_type === 'discussion' && s.topic) {
    ctx.hidden = false;
    ctx.innerHTML = `<span class="ctx-label">토론 주제 · 연습용 가정</span><strong>${esc(s.topic.title)}</strong><br />${esc(s.topic.brief)}`;
    bar.hidden = false;
    renderPhaseBar('discussion', started.discussion?.phase || 'opening');
    log.hidden = false;
    (started.openings || []).forEach((o) => appendTurn(o.speaker_id, o.speaker_name || (o.speaker_id === 'moderator' ? '사회자' : o.speaker_id), o.utterance));
    $('#questionText').textContent = started.question?.text || '토론을 시작합니다.';
  } else if (s.interview_type === 'pt' && s.pt_task) {
    ctx.hidden = false;
    ctx.innerHTML = `<span class="ctx-label">PT 과제 · 연습용 가정</span><strong>${esc(s.pt_task.title)}</strong><br />${esc(s.pt_task.brief)}`;
    bar.hidden = false;
    renderPhaseBar('pt', started.pt_phase || 'brief');
    $('#questionText').textContent = '과제를 확인한 뒤 “준비 시작”을 누르세요.';
    showPtActions(true);
    $('#answerText').closest('.room')?.setAttribute('data-pt', '1');
    state.ptPhase = started.pt_phase || 'brief';
  } else if (s.interview_type === 'situational' && s.scenario) {
    ctx.hidden = false;
    ctx.innerHTML = `<span class="ctx-label">상황 시나리오</span><strong>${esc(s.scenario.title)}</strong><br />역할극 형식입니다. 상대의 말에 반응하며 대응을 말해 보세요.`;
    showPtActions(false);
    setQuestion(started.question);
  } else if (s.interview_type === 'panel' && s.panel_roles?.length) {
    ctx.hidden = false;
    ctx.innerHTML = `<span class="ctx-label">패널 구성</span>${s.panel_roles.map((r) => esc(r.label)).join(' · ')}<br />질문마다 담당 면접관이 바뀝니다.`;
    showPtActions(false);
    setQuestion(started.question);
  } else {
    showPtActions(false);
    setQuestion(started.question);
  }
  if (s.interview_type !== 'pt') showPtActions(false);
  updateRoomSide();
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
    <button class="ghost small" type="button" data-phase="prepare">1. 준비 시작 (3분)</button>
    <button class="ghost small" type="button" data-phase="present">2. 발표 시작 (3분)</button>
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
    if (phase === 'present') { startTimer(180); $('#questionText').textContent = '발표를 시작하세요. 결론 → 근거 → 실행계획 순서로 입력하면 됩니다.'; }
    if (phase === 'qa') { $('#questionText').textContent = r.utterance || '질의응답을 시작합니다.'; startTimer(Math.max(60, state.endAt ? Math.round((state.endAt - Date.now()) / 1000) : 300)); }
  } catch (err) {
    toast(err.message, true);
  }
}

const PHASES = {
  discussion: [['reading', '자료 읽기'], ['opening', '입론'], ['exchange', '반론·교환'], ['agreement', '합의'], ['closing', '마무리']],
  pt: [['brief', '과제 확인'], ['prepare', '준비'], ['present', '발표'], ['qa', 'Q&A']],
};
function renderPhaseBar(kind, current) {
  const bar = $('#phaseBar');
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
  state.discussLog = [...(state.discussLog || []), { speakerId, speakerName: who, text }];
  if (state.discussLog.length > 24) state.discussLog = state.discussLog.slice(-24);
}

let questionCount = 0;
let questionTotal = 5;
function setQuestion(q) {
  if (!q) return;
  $('#questionText').textContent = q.text;
  updateProgress();
  $('#aiReply').hidden = true;
  updateRoomSide();
}
function updateProgress() {
  const pct = Math.min(100, (questionCount / Math.max(1, questionTotal)) * 100);
  $('#progressBar').style.width = `${pct}%`;
  $('#progressWrap').setAttribute('aria-valuenow', String(Math.round(pct)));
}
function updateRoomSide() {
  $('#roomProgressSide').textContent = `${questionCount}/${questionTotal}`;
}

function startTimer(totalSeconds) {
  clearInterval(state.timer);
  state.endAt = Date.now() + totalSeconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
    const label = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    $('#clock').textContent = label;
    $('#roomClockSide').textContent = label;
    if (left === 0) { clearInterval(state.timer); toast('시간이 종료되었습니다. 면접을 종료합니다.'); finish(); }
  };
  tick();
  state.timer = setInterval(() => { if (!state.paused) tick(); }, 1000);
}

const answerEl = $('#answerText');
answerEl.addEventListener('input', () => { $('#charCount').textContent = [...answerEl.value].length; });
answerEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#answerBtn').click(); }
});

$('#pauseBtn').addEventListener('click', async () => {
  if (!state.session) return;
  try {
    if (!state.paused) {
      const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.pause', payload: {} } });
      state.session.version = r.version;
      state.paused = true;
      state.pausedAt = Date.now();
      $('#pauseBtn').textContent = '다시 시작';
      $('#roomState').textContent = '일시정지';
      toast('일시정지했습니다. 쉬었다가 다시 시작하세요.');
    } else {
      const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.resume', payload: {} } });
      state.session.version = r.version;
      state.paused = false;
      // 일시정지한 시간만큼 종료 시각을 미뤄 표시 타이머와 서버 누적 시간을 맞춘다
      if (state.pausedAt) state.endAt += Date.now() - state.pausedAt;
      state.pausedAt = 0;
      $('#pauseBtn').textContent = '일시정지';
      $('#roomState').textContent = 'LIVE';
      startTimer(Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000)));
      toast('다시 시작합니다.');
    }
  } catch (err) { toast(err.message, true); }
});

$('#ttsBtn').addEventListener('click', () => speak($('#questionText').textContent));
$('#copyQBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#questionText').textContent); toast('질문을 복사했습니다.'); }
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

$('#answerBtn').addEventListener('click', async () => {
  if (recognizer) stopRecognizer();
  const text = answerEl.value.trim();
  if (!text) return toast('답변을 입력하세요.', true);
  const btn = $('#answerBtn');
  btn.disabled = true; btn.textContent = '처리 중…';
  try {
    const r = await api(`/sessions/${state.session.id}/commands`, {
      method: 'POST', idempotent: true,
      // 무료 테스트 세션이면 synthetic 표시를 함께 전송 (개인정보 포함 시 서버가 차단)
      body: { command_id: uuid(), expected_version: state.session.version, type: 'turn.text', payload: { text, ...(state.session.free_test ? { synthetic: true } : {}) } },
    });
    state.session.version = r.version;
    answerEl.value = ''; $('#charCount').textContent = '0';
    if (state.type === 'discussion') {
      appendTurn('user', '나', text);
      (r.utterances || []).forEach((u) => appendTurn(u.speaker_id, u.speaker_name || (u.speaker_id === 'moderator' ? '사회자' : undefined), u.utterance));
      if (r.discussion?.phase) renderPhaseBar('discussion', r.discussion.phase);
      questionCount = r.discussion?.user_turns || questionCount + 1;
      updateProgress(); updateRoomSide();
      if (r.action === 'discussion_complete' || r.state === 'completed') { toast('토론이 끝났습니다. 보고서를 생성합니다.'); return loadReport(); }
      if (r.utterance) { $('#aiReply').innerHTML = `<p class="label">사회자</p><p>${esc(r.utterance)}</p>`; $('#aiReply').hidden = false; speak(r.utterance); }
    } else if (state.type === 'pt') {
      if (r.pt_phase && r.pt_phase !== state.ptPhase) { state.ptPhase = r.pt_phase; renderPhaseBar('pt', r.pt_phase); }
      if (r.state === 'completed') { toast('PT 면접이 끝났습니다.'); return loadReport(); }
      if (r.utterance) {
        $('#aiReply').innerHTML = `<p class="label">${r.pt_phase === 'qa' ? '면접관 · Q&A' : '면접관'}</p><p>${esc(r.utterance)}</p>`;
        $('#aiReply').hidden = false;
        if (r.pt_phase === 'qa') $('#questionText').textContent = r.utterance;
        speak(r.utterance);
      }
      questionCount += 1; updateProgress();
    } else if (state.type === 'situational') {
      if (r.state === 'completed') { toast('상황 면접이 끝났습니다.'); return loadReport(); }
      if (r.utterance) {
        $('#aiReply').innerHTML = `<p class="label">면접관 · 역할극</p><p>${esc(r.utterance)}</p>`;
        $('#aiReply').hidden = false;
        speak(r.utterance);
      }
      $('#questionText').textContent = r.utterance || $('#questionText').textContent;
      questionCount = (r.scenario_index || questionCount + 1);
      updateProgress(); updateRoomSide();
    } else if (r.state === 'completed') {
      return loadReport();
    } else if (r.action === 'ask_followup') {
      $('#aiReply').innerHTML = `<p class="label">AI 면접관 · 추가 확인${r.provider === 'gemini' ? ` · Gemini (${esc(r.model || state.geminiModel || '')})` : ''}</p><p>${esc(r.utterance)}</p>`;
      $('#aiReply').hidden = false;
      speak(r.utterance);
    } else if (r.current_question) {
    } else if (r.current_question) {
      $('#questionText').textContent = r.current_question.text;
      questionCount += 1; updateProgress(); updateRoomSide();
      speak(r.current_question.text);
    }
    questionCount = (r.scenario_index || questionCount + 1);
    updateProgress(); updateRoomSide();
    if (r.provider === 'gemini') {
      $('#turnHint').textContent = `꼬리질문 ${r.followups_used}/3 · Gemini ${esc(r.model || state.geminiModel || '')} · LLM ${r.llm_calls}/14`;
    } else if (r.degraded_reason === 'free_quota_exhausted') {
      toast('Gemini 무료 한도를 소진했습니다. 정적 질문으로 전환합니다.', true);
      $('#turnHint').textContent = `꼬리질문 ${r.followups_used}/3 · 무료 한도 소진 · LLM ${r.llm_calls}/14`;
    } else {
      $('#turnHint').textContent = `꼬리질문 ${r.followups_used}/3 · Mock · LLM ${r.llm_calls}/14`;
    }
    answerEl.focus();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = '답변 완료 ⏎';
  }
});

$('#finishBtn').addEventListener('click', () => finish());

async function finish() {
  clearInterval(state.timer);
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
  try {
    await api(`/sessions/${state.session.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: state.session.version, type: 'session.finish', payload: {} },
    });
  } catch (err) {
    if (err.status !== 409) toast(err.message, true);
  }
  loadReport();
}

async function loadReport() {
  $('#sessionCard').hidden = true;
  $('#roomIdle').hidden = false;
  $('#roomState').textContent = '정리 중'; $('#roomState').classList.remove('on');
  $('#reportCard').hidden = false;
  $('#reportBody').innerHTML = '<p class="hint">보고서를 생성하고 있습니다…</p>';
  try {
    const r = await api(`/sessions/${state.session.id}/report`);
    if (r.status === 'pending') {
      setTimeout(loadReport, 1200);
      return;
    }
    if (r.status !== 'ready') {
      $('#reportBody').innerHTML = `<p class="missing">${esc(r.detail || '평가를 생성하지 못했습니다.')}</p>`;
      return;
    }
    renderReport(r);
    $('#reportCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $('#reportBody').innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}

function renderReport(r) {
  const typeLabel = TYPE_LABEL[r.interview_type] || r.interview_type || '일반·인성';
  $('#reportBadge').textContent = `${r.badge} · ${r.provider} · ${typeLabel} · ${r.rubric_version}${r.role_label ? ` · 면접관 ${r.role_label}` : ''}`;
  const inst = r.institution ? `
    <div class="inst-head"><strong>${esc(r.institution.org_label || '')} ${esc(r.institution.target_name || '')} · ${esc(r.institution.role || '')}</strong><span class="tag ${r.institution.fallback_to_general ? '' : 'official'}">${esc(r.institution.badge || '')}</span></div>
    <div class="inst-link">${renderInstitutionLink(r.institution_link)}</div>
    <p class="fine">${esc(r.institution.disclaimer || '기관의 비공개 채점기준을 아는 것처럼 표현하지 않습니다.')}</p>` : '';
  const rubricNote = r.interview_type === 'discussion'
    ? '토론은 주장 이해·근거·반박·협의 과정을 봅니다. 발언 기회가 부족한 차원은 공개하지 않습니다.'
    : r.interview_type === 'pt'
      ? 'PT는 구성·근거·실행계획·질의응답을 봅니다. 준비 단계의 메모는 평가하지 않습니다.'
      : r.interview_type === 'situational'
        ? '상황 면접은 역할·제약 이해, 상황 대응, 판단, 성찰을 봅니다.'
        : r.interview_type === 'technical'
          ? '기술 면접은 개념 설명·근거·판단·적용 계획을 봅니다. 정답 암기 여부는 평가하지 않습니다.'
          : '일반·패널 면접은 질문 적합성·근거·판단·성찰을 봅니다.';
  const dims = r.dimensions.map((d) => {
    const scored = d.status === 'scored';
    const ev = d.evidence.map((e) => `<li><q>${esc(e.quote)}</q> <span class="lv">· 답변 수준 ${e.answer_level}</span></li>`).join('');
    return `<div class="dim">
      <div class="dim-head">
        <h3>${dimLabel(d.id)}</h3>
        <span class="level ${scored ? '' : 'abstain'}">${scored ? `${d.level} / 4` : '판단 보류'}</span>
      </div>
      <p>${esc(d.observation)}</p>
      ${scored ? `<ul class="evidence">${ev}</ul>` : `<p class="fine">${esc(d.abstention_reason || '')}</p>`}
    </div>`;
  }).join('');
  const actions = (r.next_actions || []).map((a) => `
    <div class="action-card">
      <h3>다음 답변에서 할 행동 · ${esc(dimLabel(a.dimension_id))}</h3>
      <p>${esc(a.action)}</p>
      <p class="fine">재연습 질문: ${esc(a.practice_question)}</p>
      <button class="ghost practice-btn" data-dim="${esc(a.dimension_id)}">90초 재연습 시작</button>
    </div>`).join('');
  $('#reportBody').innerHTML = `${inst}<p class="hint">${esc(rubricNote)}</p>${dims}${actions || '<p class="hint">개선 행동을 제안할 만큼 관찰된 차원이 없습니다.</p>'}
    <div class="actions">
      <button class="ghost" id="copyBtn">텍스트로 복사</button>
      <button class="ghost" id="exportBtn">JSON 내보내기</button>
      <button class="ghost" id="reviseBtn">전사 교정 요청</button>
      <button class="danger" id="deleteBtn">이 세션 삭제</button>
    </div>
    <p class="fine">AI 생성 코칭입니다. 실제 합격 가능성이나 사람의 성격을 평가하지 않습니다. 이의가 있으면 <a href="#" id="appealLink" style="color:var(--green-deep);font-weight:700">이의 제기</a> · <a href="#" id="appealStatusLink" style="color:var(--green-deep)">처리 상태 확인</a>.</p>`;

  $('#copyBtn').addEventListener('click', async () => {
    const text = r.dimensions.map((d) => `${dimLabel(d.id)}: ${d.status === 'scored' ? d.level + '/4' : '보류'} — ${d.observation}`).join('\n');
    try { await navigator.clipboard.writeText(`Intervu 코칭 보고서 (${TYPE_LABEL[r.interview_type] || '일반'})\n${text}\n\n※ AI 생성 코칭, 합격 예측 아님`); toast('복사했습니다.'); } catch { toast('복사에 실패했습니다.', true); }
  });
  $('#exportBtn').addEventListener('click', async () => {
    try {
      const ex = await api('/exports', { method: 'POST', idempotent: true, body: { session_id: state.session.id, format: 'json' } });
      const payload = await api(`/exports/${ex.job_id}`);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `intervu-report-${state.session.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('JSON으로 내보냈습니다. (10분 유효 작업에서 다운로드)');
    } catch (err) { toast(err.message, true); }
  });
  $('#reviseBtn').addEventListener('click', async () => {
    const turnId = prompt('교정할 답변의 turn_id를 입력하세요. (보고서 인용 옆 turn 정보 확인)');
    if (!turnId) return;
    const text = prompt('교정된 전사를 입력하세요. (원문은 유지되고 새 revision으로 기록됩니다)');
    if (!text) return;
    try {
      const out = await api(`/turns/${turnId.trim()}/revisions`, { method: 'POST', idempotent: true, body: { base_revision: 1, text, reason: 'stt_correction' } });
      toast(`전사 교정 완료 (revision ${out.revision}). 보고서는 유지됩니다.`);
    } catch (err) { toast(err.message, true); }
  });
  $('#deleteBtn').addEventListener('click', async () => {
    if (!confirm('이 세션의 답변과 보고서를 삭제할까요?')) return;
    try {
      const d = await api(`/sessions/${state.session.id}`, { method: 'DELETE', idempotent: true });
      toast(`삭제 완료. 백업 만료: ${d.backup_expiry}`);
      resetAll();
    } catch (err) { toast(err.message, true); }
  });
  $('#appealLink').addEventListener('click', async (e) => {
    e.preventDefault();
    const category = prompt('유형 선택: stt(오인식) / fact(사실) / evidence(근거) / inappropriate(부적절)', 'stt');
    if (category === null) return;
    const comment = prompt('어떤 점이 잘못되었나요? (최대 500자)') || '';
    if (!['stt', 'fact', 'evidence', 'inappropriate'].includes((category || '').trim())) return toast('유형이 올바르지 않습니다.', true);
    try {
      const out = await api(`/evaluations/${r.evaluation_id}/appeals`, { method: 'POST', idempotent: true, body: { category: category.trim(), comment: comment.slice(0, 500) } });
      const id = prompt(`이의 접수 완료 (처리 목표 3영업일)\n접수 ID: ${out.appeal_id}\n상태를 확인하려면 확인을 누르세요.`, out.appeal_id);
      if (id) checkAppeal(id.trim());
    } catch (err) { toast(err.message, true); }
  });
  $('#appealStatusLink').addEventListener('click', async (e) => {
    e.preventDefault();
    const id = prompt('접수 ID를 입력하세요.');
    if (id) checkAppeal(id.trim());
  });
  $$('.practice-btn').forEach((b) => b.addEventListener('click', async () => {
    try {
      const p = await api('/practice-attempts', { method: 'POST', idempotent: true, body: { evaluation_id: r.evaluation_id, competency_id: b.dataset.dim } });
      state.session = { id: p.id, version: p.version };
      const started = await api(`/sessions/${p.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: p.version, type: 'session.start', payload: {} } });
      state.session.version = started.version;
      $('#reportCard').hidden = true;
      $('#roomIdle').hidden = true;
      $('#sessionCard').hidden = false;
      $('#sessionMeta').textContent = '90초 재연습 · 같은 역량의 새 질문';
      $('#answerText').value = ''; $('#charCount').textContent = '0';
      $('#turnHint').textContent = '원래 평가를 수정하지 않는 새 연습입니다.';
      questionCount = 0; questionTotal = 1; setQuestion(started.question);
      speak(started.question?.text || '');
      startTimer(p.limits?.duration_seconds || 90);
      $('#sessionCard').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { toast(err.message, true); }
  }));
}

async function checkAppeal(id) {
  try {
    const a = await api(`/appeals/${id}`);
    toast(`이의 ${a.status} · 유형 ${a.category} · 접수 ${new Date(a.created_at).toLocaleString('ko-KR')}`);
  } catch (err) { toast(err.message, true); }
}

function renderInstitutionLink(link) {
  if (!link) return '';
  if (link.mode === 'general') return `<p class="hint">${esc(link.note)}</p>`;
  const rows = (link.links || []).map((l) => `<li><span class="val">${esc(l.requirement)}</span>${basisTag(l.basis)}<span class="meta">${esc(l.note)}${l.observed_with_evidence ? '' : ' · 근거 보완 필요'}</span></li>`).join('');
  const uncovered = (link.uncovered || []).map((u) => `<li><span class="val">${esc(u.requirement)}</span><span class="tag">미관찰</span><span class="meta">${esc(u.note)}</span></li>`).join('');
  return `<h3>기관 요구와 답변의 연결</h3><p class="hint">${esc(link.note)}</p><ul class="claims">${rows || '<li>연결된 요구 없음</li>'}${uncovered}</ul>`;
}

function resetAll() {
  clearInterval(state.timer);
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
  if (recognizer) stopRecognizer();
  state.profile = null; state.versionId = null; state.session = null; state.paused = false; questionCount = 0; questionTotal = 5;
  state.type = 'general'; state.ptPhase = null; state.discussLog = [];
  $('#extractCard').hidden = true; $('#setupCard').hidden = true;
  $('#sessionCard').hidden = true; $('#roomIdle').hidden = false;
  $('#roomState').textContent = '대기 중'; $('#roomState').classList.remove('on');
  $('#reportCard').hidden = true;
  $('#roomContext').hidden = true; $('#phaseBar').hidden = true;
  $('#discussionLog').hidden = true; $('#discussionLog').innerHTML = '';
  $('#aiReply').hidden = true; $('#voiceRow').hidden = true;
  showPtActions(false);
  $('#profileForm').reset();
  setStep('profile', '대기'); setStep('extract', '대기'); setStep('setup', '대기');
  showView('home');
}

$('#newSessionBtn').addEventListener('click', resetAll);

  // ---- 3. history ----
  function historyLabel(s) {
  const t = s.interview_type || s.mode || 'general';
  return `${TYPE_LABEL[t] || t} 면접 연습`;
}
async function loadHistory() {
  const el = $('#historyBody');
  el.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const { sessions } = await api('/sessions');
    if (!sessions.length) { el.innerHTML = '<p class="hint">아직 연습 기록이 없습니다. 첫 면접을 시작해 보세요.</p>'; return; }
    el.innerHTML = sessions.map((s) => `
      <div class="list-item">
        <div>
          <strong>${esc(historyLabel(s))}</strong>
          <div class="meta">${new Date(s.created_at).toLocaleString('ko-KR')} · ${s.question_count}문항 · ${esc(s.persona)} · ${esc(s.state)}${s.blind ? ' · 블라인드' : ''}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="state ${esc(s.state)}">${esc(s.state)}</span>
          <button class="ghost open-session" data-id="${esc(s.id)}" data-state="${esc(s.state)}">${s.state === 'completed' ? '보고서' : '열기'}</button>
        </div>
      </div>`).join('');
    $$('.open-session').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.id;
      if (b.dataset.state === 'completed') {
        state.session = { id, version: 1 };
        showView('home');
        $('#reportCard').hidden = false;
        $('#reportBody').innerHTML = '<p class="hint">보고서를 불러오는 중…</p>';
        const r = await api(`/sessions/${id}/report`);
        if (r.status === 'ready') renderReport(r); else $('#reportBody').innerHTML = `<p class="missing">${esc(r.detail || '보고서가 없습니다.')}</p>`;
        $('#reportCard').scrollIntoView({ behavior: 'smooth' });
      } else {
        showView('home');
        toast('진행 중인 세션은 새 연습 화면에서 이어갈 수 있습니다. MVP는 단일 활성 세션만 지원합니다.');
      }
    }));
  } catch (err) {
    el.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}

$('#exportAllBtn')?.addEventListener('click', async () => {
  try {
    const ex = await api('/exports', { method: 'POST', idempotent: true, body: { format: 'json' } });
    const payload = await api(`/exports/${ex.job_id}`);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'intervu-sessions.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('기록 목록을 내보냈습니다.');
  } catch (err) { toast(err.message, true); }
});

$('#deleteAllBtn').addEventListener('click', async () => {
  if (!confirm('이 계정의 모든 세션과 보고서를 삭제할까요?')) return;
  try {
    const { sessions } = await api('/sessions');
    for (const s of sessions) await api(`/sessions/${s.id}`, { method: 'DELETE', idempotent: true });
    $('#deleteAllResult').textContent = `${sessions.length}개 세션을 삭제했습니다. (백업 최장 30일)`;
    toast('전체 삭제 완료');
  } catch (err) { toast(err.message, true); }
});

$('#deleteAccountBtn').addEventListener('click', async () => {
  if (!confirm('계정의 모든 세션·프로필·보고서·이의를 삭제할까요? 되돌릴 수 없습니다.')) return;
  try {
    const d = await api('/account', { method: 'DELETE', idempotent: true });
    $('#deleteAllResult').textContent = `계정 삭제 완료. 백업 만료: ${d.backup_expiry}`;
    toast('계정 전체 삭제 완료');
    resetAll();
  } catch (err) { toast(err.message, true); }
});

// ---- nav ----
$$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
loadProvider();
