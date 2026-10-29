// Workers 어댑터 공용(WP-A3). 코드·바인딩 API 세부는 모두 [UNVERIFIED — docs not checked].
// node:* 없음. Workers env는 문자열(vars·secrets)과 객체(바인딩)가 섞여 있으므로 문자열만 설정 env로 넘긴다.
import { loadConfig } from '../config.js';

export const toConfigEnv = (env = {}) => Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string'));

// Authorization 헤더 → 소유자(config.devTokens). 소유자 → DO 이름 라우팅에 쓴다. 토큰 자체는 이름에 넣지 않는다.
export function ownerOf(request, env) {
  const m = /^Bearer\s+(.+)$/.exec(request.headers.get('authorization') || '');
  return (m && loadConfig(toConfigEnv(env)).devTokens[m[1]]) || null;
}
