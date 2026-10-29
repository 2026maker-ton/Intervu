import { $, $$, esc, fmtDate, stateLabel } from '../core/format.js';
import { typeLabel } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { loadReport } from './feedback.js';

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

export async function loadRecent() {
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

export async function openSession(id, st) {
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
