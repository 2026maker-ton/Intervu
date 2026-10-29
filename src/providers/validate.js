// 모델 출력 검증(04 §4). 통과 못 하면 호출 래퍼가 정적 폴백으로 대체한다(invalid_output).
const FORBIDDEN_IN_INTERVIEW = /점수|등급|합격|불합격|모범\s*답안|정답은|\d\s*\/\s*4/;

// dialogue.next: {utterance}. 길이 ≤240자, 질문 1개, 평가·점수 어휘 없음, 입력에 없는 새 숫자 없음.
export function validateDialogueOutput(out, contextText = '') {
  const u = typeof out?.utterance === 'string' ? out.utterance.trim() : '';
  if (!u || [...u].length > 240) return false;
  if ((u.match(/[?？]/g) || []).length > 1) return false;
  if (FORBIDDEN_IN_INTERVIEW.test(u)) return false;
  const ctx = String(contextText);
  for (const tok of u.match(/\d+(?:[.,]\d+)*/g) || []) if (!ctx.includes(tok)) return false;
  return true;
}
