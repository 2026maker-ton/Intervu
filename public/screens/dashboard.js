import { $, $$, esc, fmtDate, stateLabel, uuid } from '../core/format.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state, loadSaved, clearSaved, resetFlow } from '../core/state.js';
import { go } from '../core/router.js';
import { refreshModeChip } from '../core/providers.js';
import { loadReport } from './feedback.js';
import { enterRoom } from './room.js';
import { renderEvidence } from './evidence.js';

// ---- 공급자 상태(모드 칩)·음성 전사 상태 ----
export async function loadProvider() {
  await refreshModeChip();
  try { state.stt = await api('/stt/status'); } catch { state.stt = { configured: false, provider: 'disabled' }; }
}

// ---- 대시보드 ----
$$('[data-journey]').forEach((b) => b.addEventListener('click', () => { resetFlow(); state.journey = 'university'; go('application'); }));

const OPEN_STATES = ['ready', 'active', 'paused'];

export async function loadRecent() {
  const box = $('#recentList');
  if (!box || !state.user) return;
  const cont = $('#continueCard');
  cont.hidden = true;
  try {
    const { sessions } = await api('/sessions');
    const all = (sessions || []).filter((s) => !['deleted', 'deleting'].includes(s.state));
    const open = all.find((s) => OPEN_STATES.includes(s.state));
    if (open) {
      cont.hidden = false;
      $('#continueMeta').textContent = `${fmtDate(open.created_at)} 시작 · ${stateLabel(open.state)}`;
      $('#continueBtn').onclick = () => resumeSession(open.id);
    }
    const rows = all.filter((s) => s.state === 'completed').slice(0, 3);
    box.closest('.card').hidden = !rows.length;
    box.innerHTML = rows.map((s) => `
      <div class="list-item">
        <div><strong>${esc(fmtDate(s.created_at))}</strong><div class="meta">${esc(String(s.question_count || 0))}문항</div></div>
        <button class="ghost small" type="button" data-open-session="${esc(s.id)}">결과 보기</button>
      </div>`).join('');
    $$('[data-open-session]').forEach((b) => b.addEventListener('click', () => resumeSession(b.dataset.openSession)));
  } catch (err) {
    box.innerHTML = `<p class="missing" role="alert">기록을 불러오지 못했습니다. ${esc(err.message)}</p>`;
  }
}

// 서버 상태로 세션을 복원한다: 완료 → 결과, 준비/진행/일시정지 → 면접실. 실패하면 false.
export async function resumeSession(id) {
  try {
    const s = await api(`/sessions/${encodeURIComponent(id)}`);
    state.session = { id: s.id, version: s.version, state: s.state };
    if (s.state === 'completed') { await loadReport(); return true; }
    if (!OPEN_STATES.includes(s.state)) throw new Error('이어갈 수 없는 상태의 면접입니다.');
    if (s.state === 'ready' || s.state === 'paused') {
      const r = await api(`/sessions/${s.id}/commands`, {
        method: 'POST', idempotent: true,
        body: { command_id: uuid(), expected_version: s.version, type: s.state === 'ready' ? 'session.start' : 'session.resume', payload: {} },
      });
      state.session.version = r.version;
      if (s.state === 'ready') { enterRoom({ session: s, started: r }); return true; }
    }
    state.session.state = 'active';
    const q = s.awaiting_followup ? { id: s.current_question?.id, text: s.current_followup, followup: true } : s.current_question;
    enterRoom({ session: s, resumeQuestion: q });
    return true;
  } catch (err) {
    toast(err.status === 404 ? '이전 면접을 찾을 수 없습니다.' : `면접을 이어가지 못했습니다. ${err.message}`, true);
    state.session = null;
    if (err.status === 404) clearSaved();
    go('dashboard');
    return false;
  }
}

// 새로고침·직접 URL 진입 복원: 저장된 id로 서버에서 다시 읽는다(서버 상태가 진실).
export async function restoreFromStorage(target) {
  const saved = loadSaved();
  if (['evidence', 'setup'].includes(target) && saved.profile_id && !state.profile) {
    try {
      const p = await api(`/profiles/${encodeURIComponent(saved.profile_id)}`);
      state.profile = p;
      state.versionId = p.approved_version_id || p.version_id;
      state.approved = !!p.approved_version_id && p.institution_status === 'approved';
      state.sources = p.sources || [];
      renderEvidence(p, p);
    } catch { /* noop */ }
  }
  if (['room', 'feedback'].includes(target) && saved.session_id && !state.session) {
    await resumeSession(saved.session_id); // 화면 이동까지 처리
    return true;
  }
  return false;
}
