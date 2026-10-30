import { $, $$, esc, fmtDate, stateLabel, uuid } from '../core/format.js';
import { typeLabel } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state, loadSaved, clearSaved } from '../core/state.js';
import { go } from '../core/router.js';
import { loadReport } from './feedback.js';
import { enterRoom } from './room.js';
import { renderEvidence } from './evidence.js';
import { updateSetupSummary } from './setup.js';

// ---- 공급자 상태 ----
export function providerLabel(p) {
  if (!p) return '상태 확인 실패';
  if (p.selected === 'gemini') return p.freeOnly === false ? 'Gemini 연결됨' : 'Gemini 연결 · 무료 전용';
  return 'Mock 모드 · 외부 전송 없음';
}

export async function loadProvider() {
  try {
    const h = await api('/health');
    const provider = h.provider || {};
    state.adminEnabled = typeof provider.adminEnabled === 'boolean' ? provider.adminEnabled : null;
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

export function startJourney(journey) {
  state.journey = journey === 'highschool' ? 'highschool' : 'university';
  const hs = state.journey === 'highschool';
  $('#applicationEyebrow').textContent = hs ? 'High school admission' : 'University admission';
  $('#applicationTitle').textContent = hs ? '고입 지원 정보' : '대입 지원 정보';
  $('#applicationHint').textContent = '학교 모집요강·인재상에서 확인된 내용만 사용합니다. 찾지 못한 정보는 추측하지 않고 “확인되지 않음”으로 표시합니다.'
    + (hs ? ' 고입은 미성년자 대상이므로 실제 입력은 외부 AI로 보내지 않습니다.' : '');
  $('#roleLabel').textContent = hs ? '지원 계열·학과' : '지원 학과·계열';
  const dept = $('#applicationForm [name="department"]');
  if (dept) dept.placeholder = hs ? '예: 일반계 / 과학중점' : '예: 경영학과';
  const school = $('#applicationForm [name="school_name"]');
  if (school) school.placeholder = hs ? '예: ○○고등학교' : '예: ○○대학교';
  const src = $('#sourceText');
  if (src) src.placeholder = '모집요강의 인재상·평가 기준·면접 형식을 붙여넣으세요. (비워 두면 가능한 경우 자동 확인)';
  go('application');
}

const OPEN_STATES = ['ready', 'active', 'paused'];

export async function loadRecent() {
  const box = $('#recentList');
  if (!box) return;
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  const cont = $('#continueCard');
  if (cont) cont.hidden = true;
  try {
    const { sessions } = await api('/sessions');
    const all = sessions || [];
    const open = all.find((s) => OPEN_STATES.includes(s.state));
    if (cont && open) {
      cont.hidden = false;
      $('#continueMeta').textContent = `${typeLabel(open.interview_type)} 면접 · ${fmtDate(open.created_at)} 시작 · ${stateLabel(open.state)}`;
      $('#continueBtn').onclick = () => resumeSession(open.id);
    }
    const rows = all.slice(0, 3);
    if (!rows.length) {
      box.innerHTML = '<p class="hint" id="recentEmpty">아직 연습 기록이 없습니다. 위에서 지원 분야를 고르면 시작할 수 있습니다.</p>';
    } else {
      box.innerHTML = rows.map((s) => `
      <div class="list-item">
        <div>
          <strong>${esc(typeLabel(s.interview_type))} 면접</strong>
          <div class="meta">${esc(fmtDate(s.created_at))} · ${esc(String(s.question_count || 0))}문항 · ${esc(stateLabel(s.state))}${s.blind ? ' · 블라인드' : ''}</div>
        </div>
        <button class="ghost small" type="button" data-open-session="${esc(s.id)}" data-state="${esc(s.state)}">${s.state === 'completed' ? '코칭 보기' : '이어서 하기'}</button>
      </div>`).join('');
      $$('[data-open-session]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.openSession, b.dataset.state)));
    }
  } catch (err) {
    box.innerHTML = `<p class="missing" role="alert">서버에서 기록을 불러오지 못했습니다. 입력한 내용은 그대로 있습니다. ${esc(err.message)}</p><button class="ghost small" type="button" id="dashboardRetry">다시 시도</button>`;
    $('#dashboardRetry')?.addEventListener('click', loadRecent);
  }
  loadFixtureLink();
}

// 샘플로 체험하기: 서버가 DEMO_FIXTURES=on 일 때만(GET /fixtures 성공 시) 노출한다.
async function loadFixtureLink() {
  const link = $('#fixtureLink');
  if (!link) return;
  try {
    const { fixtures } = await api('/fixtures');
    const f = (fixtures || [])[0];
    link.hidden = !f;
    if (f) link.onclick = (e) => { e.preventDefault(); state.pendingFixture = f.id; startJourney(/high/i.test(f.kind || '') ? 'highschool' : 'university'); };
  } catch { link.hidden = true; }
}

export const openSession = (id) => resumeSession(id);

// 서버 상태로 세션을 복원한다: 완료 → 코칭, 준비/진행/일시정지 → 면접실. 실패하면 false.
export async function resumeSession(id) {
  try {
    const s = await api(`/sessions/${encodeURIComponent(id)}`);
    state.session = { id: s.id, version: s.version, state: s.state };
    state.transfer = null;
    state.comparison = null;
    if (s.state === 'completed') {
      state.flow = 'review';
      await loadReport();
      return true;
    }
    if (!OPEN_STATES.includes(s.state)) throw new Error('이어갈 수 없는 상태의 면접입니다.');
    state.flow = 'interview';
    if (s.state === 'ready' || s.state === 'paused') {
      const r = await api(`/sessions/${s.id}/commands`, {
        method: 'POST', idempotent: true,
        body: { command_id: uuid(), expected_version: s.version, type: s.state === 'ready' ? 'session.start' : 'session.resume', payload: {} },
      });
      state.session.version = r.version;
    } else {
      state.session.version = s.version;
    }
    state.session.state = 'active';
    const qs = s.questions || [];
    const left = Math.max(1, (s.duration_seconds || 600) - Math.floor((s.active_elapsed_ms || 0) / 1000));
    enterRoom({
      started: { question: s.current_question, question_total: qs.length || 4, discussion: s.discussion, pt_phase: s.pt_phase },
      session: { ...s, limits: { duration_seconds: s.duration_seconds, question_count: qs.length } },
      inputMode: s.input_mode || 'text', durationSeconds: left,
    });
    state.questionCount = Math.max(0, qs.findIndex((q) => q.id === s.current_question?.id));
    return true;
  } catch (err) {
    toast(err.status === 404 ? '이전 면접을 찾을 수 없어 처음 화면으로 이동했습니다.' : `면접을 이어가지 못했습니다. ${err.message}`, true);
    state.session = null;
    if (err.status === 404) clearSaved();
    go('dashboard');
    return false;
  }
}

// 새로고침·직접 URL 진입 복원: 저장된 id로 서버에서 다시 읽는다(서버 상태가 진실). 실패하면 가드가 안내한다.
export async function restoreFromStorage(target) {
  const saved = loadSaved();
  state.skipped = !!saved.skipped;
  if (['evidence', 'setup'].includes(target) && saved.profile_id && !state.profile) {
    try {
      const p = await api(`/profiles/${encodeURIComponent(saved.profile_id)}`);
      state.profile = p;
      state.versionId = p.approved_version_id || p.version_id;
      state.approved = !!p.approved_version_id;
      state.sources = p.sources || [];
      renderEvidence(p, p);
      updateSetupSummary();
    } catch { /* noop */ }
  }
  if (['room', 'feedback'].includes(target) && saved.session_id && !state.session) {
    await resumeSession(saved.session_id); // 화면 이동까지 처리
    return true;
  }
  return false;
}
