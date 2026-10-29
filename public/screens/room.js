import { $, esc, setError, uuid } from '../core/format.js';
import { typeLabel } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { loadReport } from './feedback.js';

// ---- 5. 면접실 ----
let voiceRecognizer = null;
let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recBlob = null;
let recMime = '';
let recTimer = null;
let recStartedAt = 0;

export function enterRoom({ started, session, inputMode = 'text', durationSeconds, meta }) {
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
      speak(r.utterance);
    }
    if (phase === 'prepare') startTimer(180);
    if (phase === 'present') { startTimer(180); setQuestion({ text: '발표를 시작하세요. 결론 → 근거 → 실행 계획 순서로 입력하면 됩니다.' }); }
    if (phase === 'qa') { setQuestion({ text: r.utterance || '질의응답을 시작합니다.' }); }
  } catch (err) {
    setError('#roomError', err.message);
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

export function setQuestion(q) {
  if (!q || !q.text) return;
  $('#roomTitle').textContent = q.text;
  const ev = q.application_evidence?.[0];
  if (ev) {
    setHint(`지원서 근거: “${ev.quote}” (원문 위치 ${ev.start_cp}–${ev.end_cp})`);
    state.evHint = true;
  } else if (state.evHint) {
    setHint('');
    state.evHint = false;
  }
  updateProgress();
  $('#aiReply').hidden = true;
}

export function setHint(text) {
  const el = $('#roomHint');
  if (el) el.textContent = text || '';
}

export function updateProgress() {
  const pct = Math.min(100, (state.questionCount / Math.max(1, state.questionTotal)) * 100);
  const bar = $('#progressBar');
  if (bar) bar.style.width = `${pct}%`;
  const wrap = $('#progressWrap');
  if (wrap) wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
}

export function startTimer(totalSeconds) {
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

export function speak(text) {
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
export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
export function setMicStatus(text, cls = '') {
  const el = $('#voiceStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `fine ${cls}`;
}
if (!SpeechRec) {
  const opt = $('#setupForm input[name="input_mode"][value="voice"]');
  if (opt) { opt.disabled = true; opt.closest('label')?.classList.add('disabled'); }
}

export function stopVoice() {
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
export function sttLimitSeconds() {
  return Number(state.stt?.maxRecordingSeconds || 120);
}
export function updateSttButtons() {
  const recBtn = $('#sttRecBtn');
  const txBtn = $('#sttTranscribeBtn');
  if (!recBtn || !txBtn) return;
  const recording = !!mediaRecorder;
  recBtn.setAttribute('aria-pressed', String(recording));
  recBtn.textContent = recording ? '녹음 중지' : '녹음 시작';
  txBtn.disabled = recording || !recBlob;
}
export function stopRecTimer() {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
}
export function stopMediaStream() {
  if (recStream) { recStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } }); recStream = null; }
}
export function setSttStatus(text, cls = '') {
  const el = $('#sttStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `fine ${cls}`;
}

export async function toggleRecording() {
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

export async function transcribeRecording() {
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

export async function finishRoom() {
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
