// Store 계약(WP-A1). 구현: memory.js(테스트·기본). 이후 file / Workers DO 구현이 같은 계약을 따른다.
// 모든 메서드는 동기식이다(인메모리·DO SQLite 동기 API 기준). 비동기 백엔드는 어댑터에서 감싸야 한다.
// 소유자 범위: owner를 받는 get*는 타인의 행에 null을 돌려준다.
export const STORE_METHODS = [
  // 프로필·기관
  'createProfile', 'getProfile', 'setExtracted', 'approveVersion', 'getVersion',
  'addSource', 'listSources', 'setInstitution', 'getInstitution', 'recordProfileCall', 'recordRate',
  // 세션·턴·전사
  'createSession', 'getSession', 'listSessions', 'updateSession',
  'createTurn', 'getTurn', 'sessionTurns', 'addRevision', 'getRevisions', 'pushEvent',
  // 계정 삭제
  'deleteAccount',
  // 구 전역 상태
  'putTicket', 'takeTicket', 'putExport', 'getExport', 'deleteExport',
  'putTransferJob', 'getTransferJob', 'purgeOwned', 'getIdem', 'putIdem', 'ledgerState',
];
// 호환용 컬렉션(Map 모양): events, commands, evaluations, appeals, attempts, deletions
export const STORE_COLLECTIONS = ['events', 'commands', 'evaluations', 'appeals', 'attempts', 'deletions'];

export function assertStore(store) {
  const missing = [
    ...STORE_METHODS.filter((m) => typeof store?.[m] !== 'function'),
    ...STORE_COLLECTIONS.filter((c) => typeof store?.[c]?.get !== 'function'),
  ];
  if (missing.length) throw new Error(`Store 계약 위반: ${missing.join(', ')}`);
  return store;
}

export { createStore } from './memory.js';
