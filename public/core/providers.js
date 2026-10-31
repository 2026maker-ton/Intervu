import { $ } from './format.js';
import { api } from './api.js';
import { state } from './state.js';

// GET /providers/status 캐시 + 앱바 모드 칩(06 §5.2). 키·모델 ID는 서버가 내려주지 않는다.
export const OP_LABEL = {
  'school.analyze':'학교 분석', 'trends.decide':'보조 자료 선택', 'questions.design':'질문 설계', 'dialogue.next': '꼬리질문', 'claims.extract': '주장 추출', 'evaluation.generate': '평가',
  'speech.transcribe': '음성 전사', 'speech.synthesize': '음성 합성', 'school.search': '학교 검색',
};
export const MODE_TEXT = { mock: 'Mock 모드 · 외부 전송 없음', partial_live: '일부 실모델', live: '실모델' };

export async function fetchProviderStatus() {
  try { state.providerStatus = await api('/providers/status' + (state.profile?.id ? '?profile_id='+encodeURIComponent(state.profile.id) : '')); } catch { state.providerStatus = null; }
  return state.providerStatus;
}

export async function refreshModeChip() {
  const st = await fetchProviderStatus();
  const chip = $('#modeChip');
  if (!chip) return st;
  if (!st) { chip.textContent = '서버 연결 실패'; chip.dataset.mode = 'error'; return st; }
  chip.textContent = MODE_TEXT[st.summary] || MODE_TEXT.mock;
  chip.dataset.mode = st.summary === 'partial_live' ? 'partial-live' : st.summary === 'live' ? 'live' : 'mock';
  chip.title = Object.entries(st.operations || {}).map(([op, o]) => `${OP_LABEL[op] || op}: ${o.mode === 'live' ? '실모델' : 'Mock'}`).join(' · ');
  return st;
}
