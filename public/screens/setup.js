// 면접 준비: 답변 방식(음성/텍스트)·마이크 확인·시작. 면접 형태는 일반 면접 5단계로 고정이다.
import { $, $$, esc, setError, uuid } from '../core/format.js';
import { refreshModeChip } from '../core/providers.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { enterRoom } from './room.js';
import { openMic } from '../core/vad.js';

export function updateSetupSummary() {
  const el = $('#setupSummary');
  if (!el || !state.profile) return;
  const p = state.profile;
  el.innerHTML = `<strong>${esc(p.school_name || p.target_name || '')} · ${esc(p.department || p.role || '')}</strong>${p.track ? ` <span class="meta">${esc(p.track)}</span>` : ''}<p class="meta">일반 면접 · 본질문 5개 · 답변당 1분</p>`;
}

// 음성은 서버 전사(Groq)를 쓸 수 있을 때만 고를 수 있다. 막히면 텍스트로 시작하고 이유를 보인다.
function applyInputModes() {
  const stt = state.stt;
  const usable = !!(stt?.configured && stt.provider === 'groq-whisper' && stt.real_data_allowed && navigator.mediaDevices?.getUserMedia);
  const voice = $('#setupForm input[value=groq]');
  voice.disabled = !usable;
  voice.closest('label').classList.toggle('disabled', !usable);
  const note = $('#inputModeUnavailable');
  note.hidden = usable;
  note.textContent = usable ? '' : `음성 답변을 쓸 수 없어 텍스트로 진행합니다. ${stt?.message || ''}`;
  (usable ? voice : $('#setupForm input[value=text]')).checked = true;
  $('#micCheck').hidden = !usable;
}

export async function refreshSetup() {
  updateSetupSummary();
  applyInputModes(); // 마지막으로 알던 상태로 먼저 그리고, 서버 상태로 다시 맞춘다
  try { state.stt = await api('/stt/status' + (state.profile?.id ? `?profile_id=${encodeURIComponent(state.profile.id)}` : '')); } catch { /* 이전 값 유지 */ }
  applyInputModes();
  await refreshModeChip();
}
window.addEventListener('hashchange', () => { if (location.hash === '#/setup') refreshSetup(); });
$$('#setupForm input[name="input_mode"]').forEach((r) => r.addEventListener('change', () => { $('#micCheck').hidden = r.value !== 'groq' || !r.checked; }));

// 마이크 확인: 3초 동안 입력 크기만 보여 준다(녹음·전송 없음).
$('#micTestBtn')?.addEventListener('click', async () => {
  const btn = $('#micTestBtn');
  btn.disabled = true;
  try {
    const mic = await openMic();
    $('#micStatus').textContent = '말해 보세요';
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        $('#micMeter').style.width = `${Math.min(100, Math.round(mic.level() * 400))}%`;
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve();
      };
      tick();
    });
    mic.close();
    $('#micMeter').style.width = '0';
    $('#micStatus').textContent = '마이크 확인 완료';
  } catch {
    $('#micStatus').textContent = '마이크를 사용할 수 없습니다. 텍스트로 진행해 주세요.';
    $('#setupForm input[value=text]').checked = true;
  } finally { btn.disabled = false; }
});

$('#setupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.approved) return setError('#setupError', '근거를 승인해야 시작할 수 있습니다.');
  const btn = $('#startBtn');
  setError('#setupError', '');
  btn.disabled = true;
  try {
    const input_mode = new FormData(e.target).get('input_mode') || 'text';
    const s = await api('/sessions', { method: 'POST', idempotent: true, body: { profile_version_id: state.versionId, interview_format: 'general', input_mode } });
    state.session = { id: s.id, version: s.version, state: 'ready' };
    const started = await api(`/sessions/${s.id}/commands`, { method: 'POST', idempotent: true, body: { command_id: uuid(), expected_version: s.version, type: 'session.start', payload: {} } });
    state.session.version = started.version;
    enterRoom({ session: { ...s, input_mode, answer_seconds: s.limits.answer_seconds }, started });
  } catch (err) {
    setError('#setupError', err.message);
  } finally {
    btn.disabled = false;
  }
});
