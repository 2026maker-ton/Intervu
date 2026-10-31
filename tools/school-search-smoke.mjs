// 수동 도구: 샘플 10건을 Gemini Google Search grounding으로 검색해 면접 형태 검증표의 "AI 결과" 열을 채운다.
// 유료 기능이라 GEMINI_API_KEY + GEMINI_GROUNDING_ACK=true + GEMINI_FREE_ONLY=false가 모두 있어야 실행한다(호출 10건 ≈ 검색 10회 과금).
// 결과는 콘솔에만 출력하고 파일로 저장하지 않는다(약관: 결과 캐시·수집 금지). 지원서·개인정보는 보내지 않는다(학교·학과·전형 이름만).
import { loadDotEnv } from '../src/env.js';
import { loadConfig } from '../src/config.js';
import { createGeminiAdapter } from '../src/providers/adapters.js';
import { SAMPLE_SCHOOLS } from '../src/domain/sample-schools.js';

const env = loadDotEnv(process.cwd());
const config = loadConfig(env);
if (!config.gemini.apiKey || !config.gemini.groundingAck || config.gemini.freeOnly !== false) {
  console.error('실행하지 않음: GEMINI_API_KEY, GEMINI_GROUNDING_ACK=true, GEMINI_FREE_ONLY=false가 모두 필요합니다.');
  process.exit(2);
}
const gemini = createGeminiAdapter({ apiKey: config.gemini.apiKey, textModel: config.gemini.textModel, fallbackModel: config.gemini.fallbackModel, timeoutMs: 30000, freeOnly: false, baseUrl: config.providerGate.gemini.baseUrl });
const year = String(new Date().getFullYear() + 1);
for (const s of SAMPLE_SCHOOLS) {
  try {
    const r = await gemini.searchSchool({ school: s.school_name, department: s.department, track: s.admission_track, year });
    const n = (r.grounding?.groundingChunks || []).length;
    console.log(`\n## ${s.school_name} · ${s.admission_track} (출처 ${n}건)\n${r.text.trim()}`);
  } catch (e) {
    console.log(`\n## ${s.school_name} · 실패: ${e.message}`);
  }
}
