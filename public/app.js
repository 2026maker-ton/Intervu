// Intervu SPA — 로그인 · 대시보드 · 지원 정보 · 근거 확인 · 면접 준비 · 면접실 · 결과
// 의존성 없음. 서버 API(/api/v1)만 사용하며 AI 키는 브라우저에 존재하지 않는다.

import { renderScreen, currentTarget } from './core/router.js';
import { setUnauthorizedHandler } from './core/api.js';
import './screens/application.js';
import './screens/evidence.js';
import './screens/setup.js';
import './screens/room.js';
import { loadMe, signedOut } from './screens/login.js';
import { loadProvider, restoreFromStorage } from './screens/dashboard.js';

setUnauthorizedHandler(signedOut);

(async function boot() {
  if (!location.hash) location.hash = '#/dashboard';
  const target = currentTarget();
  if (!(await loadMe())) { renderScreen('login'); return; }
  await loadProvider();
  // 새로고침·직접 URL: 서버 상태로 복원(복원이 화면 이동까지 처리), 아니면 가드를 거쳐 그리기
  if (!(await restoreFromStorage(target))) renderScreen(target === 'login' ? 'dashboard' : target);
})();
