// 수동 스모크(WP-B3). 자동 실행 금지: 개발자가 승인한 뒤 합성 문장으로만 1회 호출한다. 실제 지원자 데이터 금지.
// 사용: CLAUDE_API_KEY=... CLAUDE_BASE_URL=... CLAUDE_MODEL=... node tools/claude-smoke.mjs
import { createClaudeAdapter } from '../src/providers/adapters/claude.js';
import { mergeModelClaims, extractApplicantClaims } from '../src/domain/claims.js';

const { CLAUDE_API_KEY, CLAUDE_BASE_URL, CLAUDE_MODEL } = process.env;
if (!CLAUDE_API_KEY || !CLAUDE_BASE_URL || !CLAUDE_MODEL) { console.error('CLAUDE_API_KEY / CLAUDE_BASE_URL / CLAUDE_MODEL 필요'); process.exit(1); }
const SYNTHETIC = '저는 가상의 동아리 앱 프로젝트에서 팀장을 맡아 일정을 조율했습니다. 저는 성실한 사람입니다.';
const a = createClaudeAdapter({ apiKey: CLAUDE_API_KEY, baseUrl: CLAUDE_BASE_URL, model: CLAUDE_MODEL, apiVersion: process.env.CLAUDE_API_VERSION || '', timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS) || 20000 });
const r = await a.extractApplicantClaims({ maskedApplication: SYNTHETIC });
console.log('quotes:', r.quotes, 'usage:', r.usage);
console.log('merged:', mergeModelClaims(extractApplicantClaims(SYNTHETIC), SYNTHETIC, r.quotes));
