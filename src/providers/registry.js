// operation -> 공급자 라우팅(04 §1). config.registry가 유일한 출처이고, 공급자별 지원 operation을 검증한다.
// Web 표준만 사용한다(Workers 이식).
export const OPERATIONS = ['dialogue.next', 'claims.extract', 'evaluation.generate', 'speech.transcribe', 'speech.synthesize', 'school.analyze', 'trends.decide', 'questions.design', 'questions.write', 'school.search'];
// 공급자가 실제로 구현한 operation. 여기에 없는 조합은 호출하지 않고 mock으로 처리한다.
export const SUPPORTED = { gemini: ['dialogue.next', 'claims.extract', 'evaluation.generate', 'school.analyze', 'trends.decide', 'questions.design', 'school.search'], deepseek: ['dialogue.next'], elevenlabs: ['speech.synthesize'], groq: ['speech.transcribe'], claude: ['claims.extract', 'school.analyze', 'questions.design', 'questions.write', 'evaluation.generate'], mock: OPERATIONS };

export function createRegistry(config) {
  const routes = {};
  for (const op of OPERATIONS) {
    const r = config.registry?.[op] || {};
    const provider = SUPPORTED[r.provider]?.includes(op) ? r.provider : 'mock';
    routes[op] = { operation: op, provider, alias: r.alias || provider };
  }
  return { route: (op) => routes[op] || { operation: op, provider: 'mock', alias: 'mock' }, operations: () => OPERATIONS.slice() };
}
