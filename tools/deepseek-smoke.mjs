// DeepSeek 실호출 스모크(WP-B2). 수동 실행 전용, 합성 데이터만 사용한다. 에이전트·CI는 개발자 승인 없이 실행하지 않는다.
// 사용: DEEPSEEK_API_KEY=... DEEPSEEK_BASE_URL=... DEEPSEEK_MODEL=... DEEPSEEK_LIVE_ACK=true node tools/deepseek-smoke.mjs
// [UNVERIFIED] 요청 형태는 어댑터의 OpenAI 호환 가정을 따른다. 결과(지연·오류)는 docs/validation-results.md에 "실측"으로 기록한다.
import { loadDotEnv } from '../src/env.js';
import { createDeepseekAdapter } from '../src/providers/adapters/deepseek.js';
import { validateFollowupOutput } from '../src/providers/validate.js';

const env = { ...loadDotEnv(process.cwd()), ...process.env };
const need = ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'DEEPSEEK_LIVE_ACK'];
const missing = need.filter((k) => !env[k] || (k === 'DEEPSEEK_LIVE_ACK' && String(env[k]).toLowerCase() !== 'true'));
if (missing.length) { console.error(`거부: 다음 설정이 없거나 유효하지 않습니다 -> ${missing.join(', ')}. 호출하지 않았습니다.`); process.exit(2); }

console.log('주의: 이 스크립트는 DeepSeek에 실제 네트워크 호출을 합니다(합성 문장 3건, 비용 발생 가능).');
const adapter = createDeepseekAdapter({ apiKey: env.DEEPSEEK_API_KEY, baseUrl: env.DEEPSEEK_BASE_URL, model: env.DEEPSEEK_MODEL, timeoutMs: Number(env.DEEPSEEK_TIMEOUT_MS) || 12000 });
const SYNTHETIC = [
  { q: '팀 프로젝트에서 갈등을 해결한 경험을 말씀해 주세요.', a: '팀원과 일정 의견이 달라 제가 회의를 열어 우선순위를 다시 정했습니다.' },
  { q: '가장 도전적이었던 과제는 무엇이었나요?', a: '동아리 행사 준비에서 예산이 부족해 후원처를 직접 찾았습니다.' },
  { q: '실패 경험을 말씀해 주세요.', a: '발표 준비가 부족해 질문에 답하지 못했고 이후 자료를 먼저 정리하게 되었습니다.' },
];
let ok = 0;
for (const { q, a } of SYNTHETIC) {
  const t0 = Date.now();
  try {
    const r = await adapter.next({ persona: 'standard', role: 'hr', followupReason: 'missing_evidence', questionText: q, recentAnswer: a, interviewType: 'general', history: [] });
    const valid = validateFollowupOutput(r, `${q}\n${a}`, `${q} ${a}`);
    if (valid) ok += 1;
    console.log(`지연 ${Date.now() - t0}ms · 검증 ${valid ? '통과' : '실패'} · 길이 ${[...r.utterance].length}자`);
  } catch (e) {
    console.log(`지연 ${Date.now() - t0}ms · 오류 code=${e.code ?? '?'} invalid=${!!e.invalid}`); // 본문·키는 출력하지 않는다.
  }
}
console.log(`검증 통과 ${ok}/${SYNTHETIC.length}`);
