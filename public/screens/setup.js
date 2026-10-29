import { $, $$, esc, setError, uuid } from '../core/format.js';
import { typeLabel } from '../core/copy.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { enterRoom } from './room.js';

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

export function updateSetupSummary() {
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
