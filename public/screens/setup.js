import { $, $$, esc, setError, uuid } from '../core/format.js';
import { typeLabel, reasonCopy } from '../core/copy.js';
import { OP_LABEL, refreshModeChip } from '../core/providers.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { enterRoom, SpeechRec } from './room.js';

// ---- 4. 면접 설정 ----
export async function loadCatalog() {
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

// 설정 요약(#setupSummary): 근거 승인 상태 · 사용할 근거 수 · operation별 외부 AI 사용(/providers/status) · 예상 소요.
export function renderProviderLines(st) {
  if (!st) return '<li>외부 AI 사용 상태를 확인하지 못했습니다. 서버 연결을 확인해 주세요.</li>';
  return Object.entries(st.operations || {}).map(([op, o]) => {
    const live = o.mode === 'live';
    const why = !live && o.blocked_reason ? ` — ${esc(reasonCopy(o.blocked_reason))}` : '';
    return `<li><span class="op-name">${esc(OP_LABEL[op] || op)}</span> <span class="tag ${live ? 'official' : ''}">${live ? '실모델' : 'Mock'}</span>${why}</li>`;
  }).join('');
}

export function updateSetupSummary() {
  const el = $('#setupSummary');
  if (!el) return;
  const uni = state.journey === 'university';
  const mins = Number($('#setupForm input[name=duration_minutes]:checked')?.value || 10);
  const qn = { 5: 3, 10: 4, 15: 5 }[mins] || 4;
  let head;
  if (state.profile) {
    const n = state.profile.applicant_claims_count;
    head = `<span class="tag ${state.approved ? 'official' : ''}">${state.approved ? '근거 승인 완료' : '승인 필요'}</span> ${esc(state.profile.org_label || (uni ? '대학' : '고등학교'))} · ${esc(state.profile.target_name || '기관 미지정')} · ${esc(state.profile.role || '학과·계열 미지정')}<br><span class="fine">사용할 근거: 지원서 주장 ${Number.isFinite(n) ? n : 0}개 · 자료 ${state.sources?.length || 0}건</span>`;
  } else {
    head = `<span class="tag">자료 없이 일반 기준</span> ${state.journey === 'highschool' ? '고입' : '대입'} · 학교 맞춤 검증 없이 기본 역량으로 연습합니다.`;
  }
  el.innerHTML = `${head}<p class="fine summary-sub">외부 AI 사용 (이 연습에서 실제로 쓰이는 공급자)</p><ul class="plain op-list">${renderProviderLines(state.providerStatus)}</ul><p class="fine">예상 소요 약 ${mins}분 · ${qn}문항</p>`;
}

// 쓸 수 없는 답변 방식은 비활성화하고 이유를 보여 준다(06 §10).
export function updateInputModeAvailability() {
  const why = [];
  const off = (v, reason) => {
    const r = $(`#setupForm input[name="input_mode"][value="${v}"]`);
    if (!r) return;
    r.disabled = true; r.closest('label')?.classList.add('disabled'); why.push(reason);
    if (r.checked) $('#setupForm input[name="input_mode"][value="text"]').checked = true;
  };
  if (!SpeechRec) off('voice', '이 브라우저는 음성 인식을 지원하지 않아 “음성 인식”을 쓸 수 없습니다.');
  if (state.stt && (!state.stt.configured || state.stt.provider === 'disabled')) off('groq', '서버에 전사 설정이 없어 “녹음 전사”를 쓸 수 없습니다.');
  const note = $('#inputModeUnavailable');
  if (note) { note.textContent = why.join(' '); note.hidden = !why.length; }
}

// 기본 답변 방식: 서버 전사(groq)가 사용 가능할 때만 '녹음 전사', 아니면 텍스트 + 사유 표시.
let modeDefaulted = false;
function applyDefaultInputMode() {
  const g = $('#setupForm input[name="input_mode"][value="groq"]');
  const t = $('#setupForm input[name="input_mode"][value="text"]');
  const note = $('#inputModeUnavailable');
  const usable = state.stt && state.stt.configured && !['disabled', 'none'].includes(state.stt.provider);
  if (usable && g && !modeDefaulted) { g.checked = true; g.dispatchEvent(new Event('change')); }
  else if (!usable && t && !modeDefaulted) {
    t.checked = true;
    if (note) { note.textContent = `녹음 전사를 쓸 수 없어 텍스트로 시작합니다. ${state.stt?.message || '서버 전사 설정을 확인하지 못했습니다.'}`; note.hidden = false; }
  }
  if (state.stt) modeDefaulted = true;
}

export async function refreshSetup() {
  applyDefaultInputMode();
  updateInputModeAvailability();
  updateSetupSummary();
  await refreshModeChip();
  updateSetupSummary();
}
window.addEventListener('hashchange', () => { if (/^#\/(setup|room)$/.test(location.hash)) refreshSetup(); });
$$('#setupForm input[name="duration_minutes"]').forEach((r) => r.addEventListener('change', updateSetupSummary));

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
  state.tts = fd.get('tts') === 'on'; // 자동 낭독은 사용자가 켠 경우만(06 §10)
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
    state.sampleAnswers = Array.isArray(s.sample_answers) && s.sample_answers.length ? s.sample_answers : null;
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

// 면접관 음성 듣기(TTS) 토글: 브라우저 SpeechSynthesis가 있을 때만 노출한다.
if (!("speechSynthesis" in window)) { const t = $("#ttsToggle"); if (t) t.hidden = true; }
