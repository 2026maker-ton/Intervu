// Intervu SPA — 9화면 (대시보드 · 지원 정보 · 근거 확인 · 설정 · 면접실 · 피드백 · 재연습 · 기록 · 관리자)
// 의존성 없음. 서버 API(/api/v1)만 사용하며 AI 키는 브라우저에 존재하지 않는다.

import { SCREENS, renderScreen } from './core/router.js';
import './screens/application.js';
import './screens/evidence.js';
import './screens/room.js';
import { loadProvider, restoreFromStorage } from './screens/dashboard.js';
import { loadCatalog, updateSetupSummary } from './screens/setup.js';

(async function boot() {
  await loadProvider();
  await loadCatalog();
  updateSetupSummary();
  const initial = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  const target = SCREENS.includes(initial) ? initial : 'dashboard';
  if (!location.hash) location.hash = '#/dashboard';
  // 새로고침·직접 URL: 서버 상태로 복원(복원이 화면 이동까지 처리), 아니면 가드를 거쳐 그리기
  if (!(await restoreFromStorage(target))) renderScreen(target);
})();
