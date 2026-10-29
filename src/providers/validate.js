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

// DeepSeek 꼬리질문 검증(04 §1): validateDialogueOutput + 물음표 정확히 1개 + 어휘 중첩 규칙.
// 어휘 중첩: 직전 질문·답변(anchorText)과 글자 2개 조각(bigram)을 2개 이상 공유해야 한다. 무관한 새 주제 차단용 휴리스틱(의미 검증 아님).
const bigrams = (t) => { const c = [...String(t).replace(/[^\p{L}\p{N}]/gu, '')]; const s = new Set(); for (let i = 0; i + 1 < c.length; i++) s.add(c[i] + c[i + 1]); return s; };
export function validateFollowupOutput(out, contextText = '', anchorText = '') {
  if (!validateDialogueOutput(out, contextText)) return false;
  if ((out.utterance.match(/[?？]/g) || []).length !== 1) return false;
  const a = bigrams(anchorText);
  let n = 0;
  for (const g of bigrams(out.utterance)) if (a.has(g) && ++n >= 2) return true;
  return false;
}
