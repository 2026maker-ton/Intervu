// 면접실: 실제 면접처럼 질문과 면접관 말만 보인다(지원서 근거·단계·진행률 없음).
// 음성: 질문을 읽은 뒤 자동 녹음 → 발화 후 3초 정적이면 구간 전사 → 종결어미로 끝났으면 완료, 아니면 계속 듣기.
// 질문별 제한시간(기본 60초)이 지나면 "네, 거기까지만…" 후 제출. 제출과 동시에 "네 답변 잘 들었습니다."
import { $, setError, uuid } from '../core/format.js';
import { FIXED } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { api, apiUrl } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { askConfirm } from '../core/dialog.js';
import { loadReport } from './feedback.js';
import { openMic, createCapture, calibrate } from '../core/vad.js';
import { endsSentence } from '../core/sentence.js';

let room = null; // { voice, seconds, timer, endAt, parts, capture, busy, done }
let mic = null;

// ---- 면접관 음성(브라우저 합성) ----
export function speak(text) {
  return new Promise((resolve) => {
    if (!text || !('speechSynthesis' in window)) return resolve();
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 1;
      const fallback = setTimeout(resolve, 1500 + [...text].length * 160); // onend가 오지 않는 브라우저 대비
      u.onend = u.onerror = () => { clearTimeout(fallback); resolve(); };
      speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}
export function stopVoice() {
  try { speechSynthesis.cancel(); } catch { /* noop */ }
  clearInterval(room?.timer);
  room?.capture?.stop();
  mic?.close(); mic = null;
}

const setListen = (st, text) => { const b = $('#listenBox'); b.hidden = !room?.voice; b.dataset.state = st; $('#listenStatus').textContent = text; };
const showError = (msg) => { const el = $('#roomError'); el.hidden = !msg; el.textContent = msg || ''; };

function setQuestion(text, line = '') {
  $('#roomTitle').textContent = text;
  $('#interviewerLine').textContent = line;
  $('#liveTranscript').hidden = true; $('#liveTranscript').textContent = '';
  try { $('#roomTitle').focus({ preventScroll: true }); } catch { /* noop */ }
}

// ---- 답변 제한시간 ----
function startClock() {
  clearInterval(room.timer);
  room.endAt = Date.now() + room.seconds * 1000;
  const paint = () => {
    const left = Math.max(0, Math.ceil((room.endAt - Date.now()) / 1000));
    $('#clock').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    $('#roomClock').classList.toggle('critical', left <= 10);
    if (left === 10) $('#clockAnnounce').textContent = '10초 남았습니다';
    if (left === 0) { clearInterval(room.timer); timeUp(); }
  };
  paint();
  room.timer = setInterval(paint, 250);
}

// ---- 한 질문 진행: 말하기 → 답변 받기 ----
async function ask(text, line = '') {
  setQuestion(text, line);
  $('#textAnswer').hidden = true; $('#answerBtn').hidden = true; $('#listenBox').hidden = true;
  // 마이크는 질문을 읽기 전에 열고 소음 기준을 잡아 둔다: 질문이 끝나는 순간 지연 없이 바로 녹음·인식 상태로 들어가기 위해서다.
  if (room.voice) { try { mic ||= await openMic(); if (!mic.threshold) await calibrate(mic); } catch { /* beginAnswer가 텍스트로 전환한다 */ } }
  await speak(line ? `${line} ${text}` : text);
  if (room?.done) return;
  beginAnswer();
}

async function beginAnswer() {
  room.parts = []; room.busy = false; room.submitting = false;
  showError('');
  startClock();
  if (room.voice) {
    try {
      mic ||= await openMic();
      room.capture = createCapture(mic, { onSegment, onState: (st) => setListen(st, { listening: '듣고 있습니다', speaking: '말하는 중', processing: '정리 중' }[st] || '') });
      room.capture.start();
      room.nudge = setTimeout(() => { if (room && !room.capture?.spoke) setListen('listening', '답변을 시작해 주세요'); }, 10_000);
      return;
    } catch {
      room.voice = false;
      toast('마이크를 사용할 수 없어 텍스트로 답합니다.', true);
    }
  }
  $('#textAnswer').hidden = false; $('#answerBtn').hidden = false;
  $('#answerText').value = ''; $('#charCount').textContent = '0';
  $('#answerText').focus();
}

async function transcribe(blob) {
  const fd = new FormData();
  fd.append('file', blob, `answer.${/mp4/.test(blob.type) ? 'm4a' : 'webm'}`);
  const res = await fetch(apiUrl(`/sessions/${state.session.id}/transcriptions`), { method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Idempotency-Key': uuid() }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || '음성 인식에 실패했습니다.'), { status: res.status });
  return String(data.text || '').trim();
}

// 3초 정적으로 끊긴 구간: 전사 → 종결어미로 끝났으면 답변 완료. 아니면(시간이 남았으면) 다시 듣는다.
async function onSegment(blob) {
  if (!room || room.submitting) return;
  room.busy = true;
  try {
    const t = await transcribe(blob);
    if (t) room.parts.push(t);
    const joined = room.parts.join(' ');
    $('#liveTranscript').hidden = !joined; $('#liveTranscript').textContent = joined;
    if (room.submitting) return;
    if (endsSentence(joined)) return submit(false);
    if (Date.now() < room.endAt) room.capture.start();
  } catch (err) {
    // 전사가 막히면 이 답변은 텍스트로 이어간다.
    room.voice = false;
    showError(`${err.message} 텍스트로 답해 주세요.`);
    $('#listenBox').hidden = true;
    $('#textAnswer').hidden = false; $('#answerBtn').hidden = false;
    $('#answerText').value = room.parts.join(' ');
  } finally { if (room) room.busy = false; }
}

async function timeUp() {
  if (!room || room.submitting) return;
  if (room.voice) {
    const tail = await room.capture.stop();
    const say = speak(FIXED.cutoff);
    $('#interviewerLine').textContent = FIXED.cutoff;
    if (tail && room.capture.spoke) { try { const t = await transcribe(tail); if (t) room.parts.push(t); } catch { /* 남은 구간 전사 실패는 넘어간다 */ } }
    await say;
  } else {
    $('#interviewerLine').textContent = FIXED.cutoff;
    await speak(FIXED.cutoff);
  }
  submit(true);
}

async function submit(cutOff) {
  if (!room || room.submitting) return;
  room.submitting = true;
  clearInterval(room.timer); clearTimeout(room.nudge);
  if (room.voice) await room.capture?.stop();
  const text = (room.voice ? room.parts.join(' ') : $('#answerText').value).trim() || '(시간 안에 답변하지 못했습니다.)';
  const voice_metrics = room.voice ? room.capture?.metrics() : undefined;
  $('#textAnswer').hidden = true; $('#answerBtn').hidden = true;
  setListen('processing', '');
  // 제출과 동시에 면접관이 답변을 받았다고 말한다(시간 초과일 때는 이미 마감 문장을 말했다).
  if (!cutOff) $('#interviewerLine').textContent = FIXED.ack;
  const said = cutOff ? Promise.resolve() : speak(FIXED.ack);
  try {
    const r = await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'turn.text', payload: { text, cut_off: cutOff, ...(voice_metrics ? { voice_metrics } : {}) } } });
    await said;
    if (r.version) state.session.version = r.version;
    if (r.state === 'completed' || r.action === 'finish') return endInterview(r.closing || FIXED.closing);
    if (r.action === 'ask_followup') return ask(r.utterance, '');
    return ask(r.question?.text || r.utterance, r.bridge || '');
  } catch (err) {
    room.submitting = false;
    showError(err.message);
    $('#textAnswer').hidden = false; $('#answerBtn').hidden = false; $('#answerText').value = text;
    room.voice = false;
  }
}

async function endInterview(closing) {
  room.done = true;
  setQuestion(closing);
  $('#listenBox').hidden = true;
  await speak(closing);
  stopVoice();
  state.session.state = 'completed';
  await loadReport();
}

// ---- 진입 ----
// started: session.start 응답(인사 + 첫 질문). resumeQuestion: 새로고침 복원 시 현재 질문.
export function enterRoom({ session, started = null, resumeQuestion = null }) {
  stopVoice();
  room = { voice: session.input_mode === 'groq', seconds: session.answer_seconds || session.limits?.answer_seconds || 60, parts: [], done: false };
  state.session.state = 'active';
  showError('');
  go('room');
  if (started?.question) ask(started.question.text, started.opening || FIXED.opening);
  else if (resumeQuestion?.text) ask(resumeQuestion.text);
}

$('#answerBtn')?.addEventListener('click', () => {
  if (!$('#answerText').value.trim()) return setError('#roomError', '답변을 입력해 주세요.');
  submit(false);
});
$('#answerText')?.addEventListener('input', (e) => { $('#charCount').textContent = String([...e.target.value].length); });
$('#answerText')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#answerBtn').click(); } });

$('#finishBtn')?.addEventListener('click', async () => {
  if (!state.session || !(await askConfirm('면접 종료', '지금까지의 답변으로 결과를 만듭니다.', { okText: '종료' }))) return;
  if (room) { room.done = true; room.submitting = true; }
  stopVoice();
  try {
    await api(`/sessions/${state.session.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: state.session.version, type: 'session.finish', payload: {} } });
  } catch (err) { if (err.status !== 409) return toast(err.message, true); }
  state.session.state = 'completed';
  await loadReport();
});

// 다른 화면으로 나가면 녹음·음성을 멈춘다.
window.addEventListener('hashchange', () => { if (location.hash !== '#/room' && room && !room.done) { room.done = true; stopVoice(); } });
