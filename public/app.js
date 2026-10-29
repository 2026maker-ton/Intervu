// Intervu SPA — 9화면 (대시보드 · 지원 정보 · 근거 확인 · 설정 · 면접실 · 피드백 · 재연습 · 기록 · 관리자)
// 의존성 없음. 서버 API(/api/v1)만 사용하며 AI 키는 브라우저에 존재하지 않는다.

import { SCREENS, renderScreen } from './core/router.js';
import './screens/application.js';
import './screens/evidence.js';
import './screens/room.js';
import { loadProvider } from './screens/dashboard.js';
import { loadCatalog, updateSetupSummary } from './screens/setup.js';

(async function boot() {
  await loadProvider();
  await loadCatalog();
  updateSetupSummary();
  const initial = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  renderScreen(SCREENS.includes(initial) ? initial : 'dashboard');
  if (!location.hash) location.hash = '#/dashboard';
})();
