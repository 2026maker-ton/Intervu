import { test } from 'node:test';
import assert from 'node:assert/strict';

test('P0: PII blind masking keeps common words', async () => {
  const { buildBlindContext } = await import('../../src/domain/pii.js');
  const out = buildBlindContext('이번 이유 이해, 21세기 프로젝트');
  const s = typeof out === 'string' ? out : JSON.stringify(out);
  for (const w of ['이번', '이유', '이해', '21세기']) assert.ok(s.includes(w), w);
});

test('P0: keyword stuffing does not reach L3/L4', async () => {
  const { buildMockEvaluation } = await import('../../src/domain/mock-eval.js');
  const t = (id) => ({ turn_id: id, revision: 1, text: '저는 이유 결과', elicited: ['evidence_specificity', 'reasoning', 'relevance', 'reflection'] });
  const r = buildMockEvaluation({ sessionId: 's', turnsWithText: [t('a'), t('b'), t('c')] });
  for (const d of r.dimensions) if (d.status === 'scored') assert.ok(d.level < 3, `${d.id} ${d.level}`);
});

test('P4: transfer question is different and trends are capped', async () => {
  const { generateTransferQuestion, compareTransfer } = await import('../../src/domain/transfer.js');
  const base = '갈등을 해결한 경험에서 본인의 행동을 구체적으로 설명해 주세요.';
  const q = generateTransferQuestion({ competency: 'evidence_specificity', baselineQuestion: base });
  assert.notEqual(q.text, base);
  const c = compareTransfer({ rubricVersion: 'behavioral-ko-v1', competency: 'reasoning', baseline: { excerpt: '짧은 답변', levels: {} }, retry: { excerpt: '짧은 답변', levels: {} } });
  assert.equal(c.status, 'insufficient_evidence');
  const { createTrendStore } = await import('../../src/domain/trends.js');
  const ts = createTrendStore();
  assert.throws(() => ts.draft({ segment: 'company', yyyyMm: '2026-10', items: [1, 2, 3, 4].map((i) => ({ competency: 'c' + i })) }));
  ts.draft({ segment: 'company', yyyyMm: '2026-10', items: [{ competency: 'a', comment: 'c', sources: ['https://e.com'] }] });
  assert.equal(ts.published({ segment: 'company', yyyyMm: '2026-10' }), null);
});
