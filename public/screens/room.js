import { $, esc, setError, uuid } from '../core/format.js';
import { typeLabel, FIXED, reasonCopy } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { askConfirm } from '../core/dialog.js';
import { loadReport } from './feedback.js';

// ---- 5. 면접실 ----
const SESSION_KEY = 'intervu.room'; // 새로고침 복원용 세션 id(탭 단위, 본문·답변은 저장하지 않는다)
const storeSet = (v) => { try { if (v) sessionStorage.setItem(SESSION_KEY, v); else sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ } };
const storeGet = () => { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } };

let voiceRecognizer = null;
let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recBlob = null;
let recMime = '';
let recTimer = null;
let recStartedAt = 0;

export function enterRoom({ started, session, inputMode = 'text', durationSeconds, meta, restored = false }) {
  state.questionCount = restored ? (started.q_index ?? 0) : 0;
  state.finished = false;
  state.finishing = false;
  state.questionTotal = started.question_total || session.limits?.question_count || 4;
  state.paused = false;
  state.pausedAt = 0;
  state.inputMode = inputMode;
  storeSet(state.flow === 'interview' && state.session?.id ? state.session.id : null);
  $('#roomMeta').textContent = meta || `${typeLabel(session.interview_type)} 면접`;
  setRoomState('live');
  setError('#roomError', '');
  setEvidence(null);
  state.evHint = false;
  setStatusLine('');
  showBanner(null);
  setBusy('');
  $('#answerText').value = '';
  $('#charCount').textContent = '0';
  $('#aiReply').hidden = true;
  $('#discussionLog').innerHTML = '';
  $('#discussionLog').hidden = true;
  $('#phaseBar').hidden = true;
  $('#roomContext').hidden = true;
  $('#pauseBtn').textContent = '일시정지';
  initVoice(inputMode);
  initTtsButtons();
  setupRoomForType(session, started);
  startTimer(durationSeconds || session.limits?.duration_seconds || 600);
  go('room');
  setTimeout(() => { try { $('#answerText').focus(); } catch { /* noop */ } }, 80);
}

// ---- 상태 표시 ----
function setRoomState(kind) {
  const el = $('#roomState');
  if (!el) return;
  el.textContent = kind === 'live' ? 'LIVE' : '일시정지';
  el.className = kind === 'live' ? 'room-state on' : 'room-state';
  const paused = kind !== 'live';
  const overlay = $('#pauseOverlay');
  if (overlay) overlay.hidden = !paused;
  const qa = $('#roomQA');
  if (qa) { if (paused) qa.setAttribute('inert', ''); else qa.removeAttribute('inert'); }
  $('#answerBtn').disabled = paused || !!state.submitting;
  if (paused) { try { $('#resumeBtn').focus(); } catch { /* noop */ } }
}

export function setBusy(text) {
  const el = $('#roomBusy');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}
export function setStatusLine(text) {
  const el = $('#roomStatus');
  if (el) el.textContent = text || '';
}

// ProviderBanner: 폴백·일시 저하만 알린다. Mock은 정상 상태이므로 배너가 아니라 모드 칩이 알린다(06 §5.2).
export function showBanner(r) {
  const el = $('#providerBanner');
  if (!el) return;
  const trace = (r?.provider_trace || [])[0];
  const reason = r?.degraded_reason || (trace?.mode === 'fallback' ? trace.reason : null);
  if (!(trace?.mode === 'fallback' || r?.degraded_reason)) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = `${FIXED.fallback} ${reasonCopy(reason)}`;
}

export function setupRoomForType(s, started) {
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

export function showPtActions(on) {
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

export async function advancePt(phase) {
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
      autoSpeak(r.utterance);
    }
    if (phase === 'prepare') startTimer(180);
    if (phase === 'present') { startTimer(180); setQuestion({ text: '발표를 시작하세요. 결론 → 근거 → 실행 계획 순서로 입력하면 됩니다.' }); }
    if (phase === 'qa') { setQuestion({ text: r.utterance || '질의응답을 시작합니다.' }); }
  } catch (err) {
    await roomFailure(err, '진행 단계를 바꾸지 못했습니다.');
  }
}

export const PHASES = {
  discussion: [['reading', '자료 읽기'], ['opening', '입론'], ['exchange', '반론·교환'], ['agreement', '합의'], ['closing', '마무리']],
  pt: [['brief', '과제 확인'], ['prepare', '준비'], ['present', '발표'], ['qa', 'Q&A']],
};

export function renderPhaseBar(kind, current) {
  const bar = $('#phaseBar');
  if (!bar) return;
  const list = PHASES[kind] || [];
  const idx = list.findIndex(([id]) => id === current);
  bar.innerHTML = list.map(([id, label], i) => `<span class="phase-chip ${id === current ? 'on' : i < idx ? 'done' : ''}">${esc(label)}</span>`).join('');
}

export function appendTurn(speakerId, speakerName, text) {
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

// ---- QuestionCard + 근거 칩 ----
export function setQuestion(q) {
  if (!q || !q.text) return;
  $('#roomTitle').textContent = q.text;
  const ev = q.application_evidence?.[0];
  if (ev) {
    setEvidence(ev);
    state.evHint = true;
  } else if (state.evHint) {
    setEvidence(null);
    state.evHint = false;
  }
  updateProgress();
  $('#aiReply').hidden = true;
}

// 근거 칩: "지원서 근거: “…” (원문 위치 a–b)". 긴 인용은 접어 두고 클릭하면 전체 원문을 펼친다.
export function setEvidence(ev) {
  const el = $('#roomHint');
  if (!el) return;
  if (!ev) { el.hidden = true; el.innerHTML = ''; return; }
  const full = String(ev.quote || '');
  const short = [...full].length > 48 ? `${[...full].slice(0, 48).join('')}…` : full;
  el.hidden = false;
  el.innerHTML = `<span class="ev-label">지원서 근거:</span> <button type="button" class="ev-toggle" aria-expanded="false" aria-controls="evFull">“${esc(short)}”</button> <span class="meta">(원문 위치 ${esc(String(ev.start_cp))}–${esc(String(ev.end_cp))})</span><blockquote id="evFull" hidden><q>${esc(full)}</q></blockquote>`;
  const btn = el.querySelector('.ev-toggle');
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    el.querySelector('#evFull').hidden = !open;
  });
}
// 호환: 기존 호출부(텍스트 안내)는 상태 줄로 보낸다.
export function setHint(text) { setStatusLine(text); }

export function updateProgress() {
  const total = Math.max(1, state.questionTotal);
  const pct = Math.min(100, (state.questionCount / total) * 100);
  const bar = $('#progressBar');
  if (bar) bar.style.width = `${pct}%`;
  const wrap = $('#progressWrap');
  if (wrap) { wrap.setAttribute('aria-valuenow', String(Math.round(pct))); wrap.setAttribute('aria-valuetext', `${Math.min(total, state.questionCount + 1)} / ${total}번째 질문`); }
  const t = $('#roomProgressText');
  if (t) t.textContent = `질문 ${Math.min(total, state.questionCount + 1)} / ${total}`;
}

// ---- 타이머: 서버 시계 기준으로 복원, 임박 표시(<60s)는 색+텍스트, 낭독은 1분·10초만 ----
export function startTimer(totalSeconds) {
  clearInterval(state.timer);
  state.endAt = Date.now() + totalSeconds * 1000;
  const announced = { 60: false, 10: false };
  const tick = () => {
    const left = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
    const label = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    const clock = $('#clock');
    if (clock) clock.textContent = label;
    const critical = left > 0 && left < 60;
    const box = $('#roomClock');
    if (box) {
      box.classList.toggle('critical', critical);
      const small = box.querySelector('small');
      if (small) small.textContent = critical ? '남은 시간 · 곧 종료' : '남은 시간';
    }
    const ann = $('#clockAnnounce');
    if (ann) {
      if (left <= 60 && left > 10 && !announced[60]) { announced[60] = true; ann.textContent = '남은 시간 1분'; }
      if (left <= 10 && left > 0 && !announced[10]) { announced[10] = true; ann.textContent = '남은 시간 10초'; }
    }
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

// ---- 일시정지 / 재개 ----
async function togglePause() {
  if (!state.session || state.submitting) return;
  try {
    if (!state.paused) {
      if (voiceRecognizer) stopVoice();
      if (mediaRecorder) { try { mediaRecorder.stop(); } catch { /* noop */ } }
      const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.pause', payload: {} } });
      state.session.version = r.version;
      state.paused = true;
      state.pausedAt = Date.now();
      $('#pauseBtn').textContent = '다시 시작';
      setRoomState('paused');
    } else {
      const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.resume', payload: {} } });
      state.session.version = r.version;
      state.paused = false;
      if (state.pausedAt) state.endAt += Date.now() - state.pausedAt;
      state.pausedAt = 0;
      $('#pauseBtn').textContent = '일시정지';
      setRoomState('live');
      startTimer(Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000)));
      try { $('#answerText').focus(); } catch { /* noop */ }
    }
    setError('#roomError', '');
  } catch (err) {
    await roomFailure(err, '일시정지 상태를 바꾸지 못했습니다.');
  }
}
$('#pauseBtn')?.addEventListener('click', togglePause);
$('#resumeBtn')?.addEventListener('click', togglePause);
$('#pauseFinishBtn')?.addEventListener('click', () => confirmFinish());

// ---- 오류·연결 끊김: 입력은 보존하고, 서버 상태로 복구를 시도한다 ----
async function syncSession() {
  const s = await api(`/sessions/${state.session.id}`);
  state.session.version = s.version;
  state.session.state = s.state;
  return s;
}
export async function roomFailure(err, what = '요청을 처리하지 못했습니다.') {
  const net = !err.status; // fetch 자체 실패 = 연결 끊김
  let msg = `${what} 입력한 내용은 그대로 있습니다.`;
  if (err.status === 429) msg = `${what} 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나 텍스트로 이어서 답해 주세요. 입력한 내용은 그대로 있습니다.`;
  else if (net || err.status === 409 || err.status >= 500) {
    try {
      await syncSession();
      msg = `${what} 연결을 복구했습니다. 입력한 내용은 그대로 있으니 다시 눌러 주세요.`;
    } catch { msg = `${what} 서버에 연결하지 못했습니다. 입력한 내용은 그대로 있습니다. 연결을 확인한 뒤 다시 시도해 주세요.`; }
  } else if (err.message) msg = `${err.message} 입력한 내용은 그대로 있습니다.`;
  setError('#roomError', msg);
}

// ---- 질문 듣기(TTS) ----
let ttsAudio = null;
function browserSpeakOk() { return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; }
export function stopSpeak() {
  try { if (browserSpeakOk()) speechSynthesis.cancel(); } catch { /* noop */ }
  if (ttsAudio) { try { ttsAudio.pause(); } catch { /* noop */ } ttsAudio = null; }
  const stop = $('#ttsStopBtn');
  if (stop) stop.hidden = true;
}
function showSpeaking(on) {
  const stop = $('#ttsStopBtn');
  if (stop) stop.hidden = !on;
}
function browserSpeak(text) {
  if (!browserSpeakOk() || !text) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 1;
    u.onstart = () => showSpeaking(true);
    u.onend = u.onerror = () => showSpeaking(false);
    speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}
// 서버 TTS(WP-B6)는 /providers/status의 speech.synthesize가 live일 때만 시도하고, 실패하면 조용히 브라우저 TTS로 대체한다.
async function serverTts(text) {
  const op = state.providerStatus?.operations?.['speech.synthesize'];
  if (!op || op.mode !== 'live' || !state.session) return false;
  try {
    const res = await fetch(`/api/v1/sessions/${state.session.id}/tts`, {
      method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': uuid() }, body: JSON.stringify({ text }),
    });
    if (!res.ok || !/^audio\//.test(res.headers.get('content-type') || '')) return false;
    const url = URL.createObjectURL(await res.blob());
    ttsAudio = new Audio(url);
    ttsAudio.onended = () => { showSpeaking(false); URL.revokeObjectURL(url); };
    await ttsAudio.play();
    showSpeaking(true);
    const note = $('#ttsNote');
    if (note) note.textContent = '합성 음성입니다.';
    return true;
  } catch { return false; }
}
export async function speak(text) {
  if (!text) return;
  stopSpeak();
  if (await serverTts(text)) return;
  if (!browserSpeak(text)) { const note = $('#ttsNote'); if (note) note.textContent = '이 브라우저에서는 질문 듣기를 사용할 수 없습니다. 화면의 질문을 읽어 주세요.'; }
  else { const note = $('#ttsNote'); if (note) note.textContent = '브라우저 합성 음성입니다.'; }
}
// 자동 낭독은 설정에서 켠 경우에만(자동재생 금지, 06 §10).
export function autoSpeak(text) { if (state.tts) speak(text); }
function initTtsButtons() {
  const btn = $('#ttsBtn');
  const ok = browserSpeakOk();
  if (btn) { btn.disabled = !ok; btn.title = ok ? '' : '이 브라우저는 음성 낭독을 지원하지 않습니다.'; }
  const note = $('#ttsNote');
  if (note) note.textContent = ok ? '' : '이 브라우저는 질문 듣기를 지원하지 않습니다.';
  stopSpeak();
}
$('#ttsBtn')?.addEventListener('click', () => speak($('#roomTitle').textContent));
$('#ttsStopBtn')?.addEventListener('click', stopSpeak);
$('#copyQBtn')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#roomTitle').textContent); toast('질문을 복사했습니다.'); }
  catch { toast('복사에 실패했습니다.', true); }
});

// ---- VoiceControl 상태 머신(06 §10): idle → permission → recording → uploading → review / error. 항상 텍스트로 계속할 수 있다. ----
export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function setVoice(st, text = '') {
  const box = $('#voiceBox');
  if (box) box.dataset.state = st;
  const el = $('#voiceStatus');
  if (el) { el.textContent = text; el.className = `fine voice-${st}`; }
  const rec = st === 'recording';
  const busy = st === 'permission' || st === 'uploading';
  const vb = $('#voiceBtn');
  if (vb) { vb.setAttribute('aria-pressed', String(rec)); vb.textContent = rec ? '인식 중지' : '말로 답하기'; vb.disabled = busy; }
  const rb = $('#sttRecBtn');
  if (rb) { rb.setAttribute('aria-pressed', String(rec)); rb.textContent = rec ? '녹음 중지' : '녹음 시작'; rb.disabled = busy; }
  const tb = $('#sttTranscribeBtn');
  if (tb) { tb.hidden = !(st === 'error' && recBlob); tb.disabled = busy; }
}
export const setMicStatus = (text) => setVoice($('#voiceBox')?.dataset.state || 'idle', text);

function initVoice(inputMode) {
  stopRecTimer();
  stopMediaStream();
  voiceRecognizer = null; mediaRecorder = null; recBlob = null; recChunks = [];
  const box = $('#voiceBox');
  const voice = inputMode === 'voice';
  const groq = inputMode === 'groq';
  box.hidden = !(voice || groq);
  $('#voiceRow').hidden = !voice;
  $('#sttRow').hidden = !groq;
  if (voice) {
    $('#voiceNotice').textContent = '음성 인식은 브라우저가 처리합니다(브라우저·OS 제공 업체에 음성이 전달될 수 있습니다). 이 서비스 서버에는 확인·수정한 텍스트만 전송됩니다.';
    if (!SpeechRec) { $('#voiceBtn').disabled = true; setVoice('error', '이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트로 답해 주세요.'); $('#voiceBtn').disabled = true; }
    else setVoice('idle', '“말로 답하기”를 누르면 마이크 사용 권한을 묻습니다.');
  } else if (groq) {
    $('#voiceNotice').textContent = '녹음은 전사를 위해서만 전송되며 저장하지 않습니다. 개인정보는 말하지 마세요.';
    if (!state.stt?.configured || state.stt?.provider === 'disabled') { $('#sttRecBtn').disabled = true; setVoice('error', '녹음 전사를 사용할 수 없습니다(서버에 전사 설정이 없습니다). 텍스트로 답해 주세요.'); $('#sttRecBtn').disabled = true; }
    else if (!navigator.mediaDevices?.getUserMedia) { setVoice('error', '이 브라우저는 녹음을 지원하지 않습니다. 텍스트로 답해 주세요.'); $('#sttRecBtn').disabled = true; }
    else setVoice('idle', '“녹음 시작”을 누르면 마이크 사용 권한을 묻습니다.');
  }
}

export function stopVoice() {
  if (!voiceRecognizer) return;
  const rec = voiceRecognizer;
  voiceRecognizer = null;
  try { rec.stop(); } catch { /* noop */ }
  setVoice('review', $('#answerText').value ? '인식된 텍스트를 확인·수정한 뒤 “답변 완료”를 누르세요.' : '인식된 내용이 없습니다. 다시 말하거나 텍스트로 답해 주세요.');
}

$('#voiceBtn')?.addEventListener('click', () => {
  if (!SpeechRec) { setVoice('error', '이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트로 답해 주세요.'); return; }
  if (voiceRecognizer) { stopVoice(); return; }
  setVoice('permission', '마이크 사용 권한을 확인하는 중…');
  const answer = $('#answerText');
  const rec = new SpeechRec();
  voiceRecognizer = rec;
  rec.lang = 'ko-KR';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = answer.value.trim() ? `${answer.value.trim()} ` : '';
  rec.onstart = () => setVoice('recording', '듣는 중입니다. 말이 끝나면 “인식 중지”를 누르세요.');
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const chunk = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += `${chunk} `;
      else interim += chunk;
    }
    answer.value = `${finalText}${interim}`.trim();
    $('#charCount').textContent = String([...answer.value].length);
  };
  rec.onerror = (ev) => {
    voiceRecognizer = null;
    const msg = ev.error === 'not-allowed' ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용하거나 텍스트로 답해 주세요.'
      : ev.error === 'no-speech' ? '말소리가 들리지 않았습니다. 다시 시도하거나 텍스트로 답해 주세요.'
        : ev.error === 'audio-capture' ? '마이크를 찾지 못했습니다. 텍스트로 답해 주세요.'
          : `음성 인식에 실패했습니다(${ev.error}). 텍스트로 답해 주세요.`;
    setVoice('error', msg);
  };
  rec.onend = () => { if (voiceRecognizer === rec) stopVoice(); };
  try { rec.start(); } catch { voiceRecognizer = null; setVoice('error', '음성 인식을 시작하지 못했습니다. 텍스트로 답해 주세요.'); }
});

// 녹음 전사(서버 STT)
export function sttLimitSeconds() {
  return Number(state.stt?.maxRecordingSeconds || 120);
}
export function stopRecTimer() {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
}
export function stopMediaStream() {
  if (recStream) { recStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } }); recStream = null; }
}

export async function toggleRecording() {
  if (mediaRecorder) {
    try { mediaRecorder.stop(); } catch { /* noop */ }
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) { setVoice('error', '이 브라우저는 녹음을 지원하지 않습니다. 텍스트로 답해 주세요.'); return; }
  if (!state.stt?.configured || state.stt?.provider === 'disabled') { setVoice('error', '전사를 사용할 수 없습니다. 텍스트로 답해 주세요.'); return; }
  setVoice('permission', '마이크 사용 권한을 확인하는 중…');
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    setVoice('error', e?.name === 'NotFoundError' ? '마이크를 찾지 못했습니다. 텍스트로 답해 주세요.' : '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용하거나 텍스트로 답해 주세요.');
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
    setVoice('error', '녹음을 시작하지 못했습니다. 텍스트로 답해 주세요.');
    return;
  }
  recStartedAt = Date.now();
  mediaRecorder.ondataavailable = (ev) => { if (ev.data?.size) recChunks.push(ev.data); };
  mediaRecorder.onstop = () => {
    stopRecTimer();
    stopMediaStream();
    const mime = mediaRecorder?.mimeType || recMime || 'audio/webm';
    mediaRecorder = null;
    const secs = Math.round((Date.now() - recStartedAt) / 1000);
    try { recBlob = new Blob(recChunks, { type: mime }); } catch { recBlob = null; }
    recMime = recBlob?.type || mime;
    recChunks = [];
    if (!recBlob || !recBlob.size) { recBlob = null; setVoice('error', '녹음된 소리가 없습니다. 마이크를 확인하고 다시 녹음하거나 텍스트로 답해 주세요.'); return; }
    if (secs < 1) { recBlob = null; setVoice('error', '녹음이 너무 짧습니다. 다시 녹음해 주세요.'); return; }
    transcribeRecording();
  };
  mediaRecorder.onerror = () => {
    stopRecTimer();
    stopMediaStream();
    mediaRecorder = null;
    setVoice('error', '녹음 중 오류가 발생했습니다. 텍스트로 답해 주세요.');
  };
  mediaRecorder.start(250);
  const tick = () => {
    const el = Math.floor((Date.now() - recStartedAt) / 1000);
    if (el >= sttLimitSeconds()) { try { mediaRecorder?.stop(); } catch { /* noop */ } return; }
    setVoice('recording', `녹음 중 ${fmtSec(el)} / 최대 ${fmtSec(sttLimitSeconds())}`);
  };
  tick();
  stopRecTimer();
  recTimer = setInterval(tick, 1000);
}

export async function transcribeRecording() {
  if (!recBlob || mediaRecorder || !state.session) return;
  setVoice('uploading', '전사 중… (녹음은 전사 후 폐기됩니다)');
  try {
    const fd = new FormData();
    const ext = /mp4/i.test(recMime) ? 'm4a' : /ogg/i.test(recMime) ? 'ogg' : 'webm';
    fd.append('file', recBlob, `answer.${ext}`);
    const headers = { Authorization: `Bearer ${state.token}`, 'Idempotency-Key': uuid() };
    const res = await fetch(`/api/v1/sessions/${state.session.id}/transcriptions`, { method: 'POST', headers, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || `전사에 실패했습니다 (${res.status})`), { status: res.status });
    if (!data.text) { recBlob = null; setVoice('error', data.note || '전사 결과가 비어 있습니다. 다시 녹음하거나 텍스트로 답해 주세요.'); return; }
    recBlob = null;
    const answer = $('#answerText');
    answer.value = String(data.text || '').slice(0, 4000);
    $('#charCount').textContent = String([...answer.value].length);
    const pii = data.pii_warnings?.length ? ' 개인정보로 보이는 내용이 있을 수 있으니 제출 전에 지워 주세요.' : '';
    setVoice('review', `전사 결과를 입력란에 넣었습니다. 확인·수정 후 “답변 완료”를 누르세요.${pii}`);
    answer.focus();
  } catch (err) {
    // 원음은 재시도용으로만 메모리에 둔다. 한도 초과(429)는 재시도해도 소용없으므로 버린다.
    if (err.status === 429 || err.status === 503) recBlob = null;
    setVoice('error', `${err.message} 텍스트로 계속 답할 수 있습니다.`);
  }
}

$('#sttRecBtn')?.addEventListener('click', toggleRecording);
$('#sttTranscribeBtn')?.addEventListener('click', transcribeRecording);

// ---- 답변 제출 ----
$('#answerBtn')?.addEventListener('click', async () => {
  if (state.submitting || state.paused) return;
  if (voiceRecognizer) stopVoice();
  const answerEl = $('#answerText');
  const text = answerEl.value.trim();
  if (!text) { setError('#roomError', '답변을 입력해 주세요. 말로 답했다면 인식된 텍스트가 입력란에 보이는지 확인하세요.'); answerEl.focus(); return; }
  state.submitting = true;
  const btn = $('#answerBtn');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '처리 중…';
  answerEl.readOnly = true;
  setError('#roomError', '');
  setBusy('면접관이 답변을 확인하는 중…');
  try {
    const r = await api(`/sessions/${state.session.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: state.session.version, type: 'turn.text', payload: { text } },
    });
    state.session.version = r.version;
    answerEl.value = '';
    $('#charCount').textContent = '0';
    showBanner(r);
    await afterTurn(r, text);
  } catch (err) {
    await roomFailure(err, '답변 제출이 늦어지고 있습니다.');
  } finally {
    state.submitting = false;
    answerEl.readOnly = false;
    setBusy('');
    btn.disabled = !!state.paused || !!state.finishing || !!state.finished;
    btn.textContent = prev;
  }
});

export async function afterTurn(r, text) {
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
      autoSpeak(r.utterance);
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
      autoSpeak(r.utterance);
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
      autoSpeak(r.utterance);
    }
    state.questionCount = r.scenario_index || state.questionCount + 1;
    updateProgress();
    return;
  }
  if (r.state === 'completed') return finishRoom();
  if (r.action === 'ask_followup' && r.utterance) {
    $('#aiReply').innerHTML = `<p class="label">면접관 · 추가 확인</p><p>${esc(r.utterance)}</p>`;
    $('#aiReply').hidden = false;
    autoSpeak(r.utterance);
  } else if (r.current_question?.text) {
    setQuestion(r.current_question);
    autoSpeak(r.current_question.text);
    state.questionCount += 1;
  }
  updateProgress();
  // 실제 사용한 공급자는 provider_trace 기준(Mock을 실모델로 표기하지 않는다).
  const t = (r.provider_trace || [])[0];
  const provider = t?.mode === 'live' ? `${t.provider}${r.model ? ` · ${r.model}` : ''}` : 'Mock';
  setStatusLine(`꼬리질문 ${r.followups_used ?? 0}/3 · ${provider} · ${FIXED.evaluator}`);
}

// ---- 종료 ----
async function confirmFinish() {
  if (state.finishing || state.finished || state.submitting) return;
  const ok = await askConfirm('면접을 종료할까요?', '면접을 종료하면 지금까지의 답변으로 보고서를 만듭니다.', { okText: '종료하고 보고서 보기', danger: true });
  if (ok) finishRoom();
}
$('#finishBtn')?.addEventListener('click', confirmFinish);

export async function finishRoom() {
  if (state.finishing || state.finished) return;
  if (!state.session) { go('dashboard'); return; }
  state.finishing = true;
  clearInterval(state.timer);
  stopSpeak();
  if (voiceRecognizer) stopVoice();
  if (mediaRecorder) { try { mediaRecorder.stop(); } catch { /* noop */ } }
  setBusy('보고서를 만드는 중…');
  ['answerBtn', 'pauseBtn', 'finishBtn', 'resumeBtn', 'pauseFinishBtn'].forEach((id) => { const b = $(`#${id}`); if (b) b.disabled = true; });
  const reenable = () => ['answerBtn', 'pauseBtn', 'finishBtn', 'resumeBtn', 'pauseFinishBtn'].forEach((id) => { const b = $(`#${id}`); if (b) b.disabled = false; });
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
        setBusy('');
        reenable();
        setRoomState(state.paused ? 'paused' : 'live');
        await roomFailure(err, '면접을 종료하지 못했습니다.');
        return;
      }
    }
  }
  state.session.state = 'completed';
  state.finishing = false;
  state.finished = true;
  storeSet(null);
  setBusy('');
  reenable();
  $('#pauseOverlay').hidden = true;
  $('#roomQA')?.removeAttribute('inert');
  await loadReport();
}

// ---- 새로고침 복원: #/room에서 열렸고 이 탭에 진행 중 세션이 있으면 서버 상태(질문·남은 시간)를 다시 불러온다 ----
export async function restoreRoom() {
  const id = storeGet();
  if (!id || state.session || location.hash !== '#/room') return false;
  try {
    const s = await api(`/sessions/${id}`);
    if (!['ready', 'active', 'paused'].includes(s.state)) { storeSet(null); return false; }
    state.session = { id: s.id, version: s.version, state: s.state };
    state.flow = 'interview';
    state.type = s.interview_type;
    state.tts = false;
    if (!state.stt) { try { state.stt = await api('/stt/status'); } catch { state.stt = { configured: false, provider: 'disabled' }; } }
    const left = Math.max(0, (s.duration_seconds || 0) - Math.floor((s.active_elapsed_ms || 0) / 1000));
    const started = { question: s.current_question, question_total: s.questions?.length, q_index: s.q_index, pt_phase: s.pt_phase, discussion: s.discussion, openings: [] };
    enterRoom({ started, session: { ...s, limits: { duration_seconds: s.duration_seconds } }, inputMode: s.input_mode || 'text', durationSeconds: left, meta: `${typeLabel(s.interview_type)} · ${Math.round((s.duration_seconds || 0) / 60)}분 · 블라인드 ${s.blind ? 'ON' : 'OFF'}`, restored: true });
    if (s.state === 'paused') {
      state.paused = true;
      state.pausedAt = Date.now();
      $('#pauseBtn').textContent = '다시 시작';
      setRoomState('paused');
    }
    showBanner({ degraded_reason: s.degraded_reason });
    toast('진행 중이던 면접을 이어서 불러왔습니다.');
    return true;
  } catch { storeSet(null); return false; }
}
setTimeout(restoreRoom, 0); // 순환 import(state↔setup↔room)가 모두 평가된 뒤 실행
