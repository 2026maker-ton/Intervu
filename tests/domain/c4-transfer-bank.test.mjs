import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTransferQuestion, questionSimilarity, TRANSFER_BANK } from '../../src/domain/transfer.js';
import { RUBRICS } from '../../src/domain/rubrics.js';
import { PACK } from '../../src/domain/questions.js';
import { TECHNICAL_QUESTIONS, PT_TASKS, SITUATION_SCENARIOS } from '../../src/domain/scenarios.js';

const strings = [];
(function walk(v) {
  if (typeof v === 'string') { if ([...v].length >= 12) strings.push(v); } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
})([PACK, TECHNICAL_QUESTIONS, PT_TASKS, SITUATION_SCENARIOS]);
const baselines = [...new Set(strings)];

test('C4: every rubric x dimension has >=3 templates and yields a distinct question', () => {
  assert.ok(baselines.length > 10);
  for (const rub of Object.values(RUBRICS)) {
    for (const dim of rub.dimensions) {
      assert.ok(TRANSFER_BANK[dim]?.length >= 3, `${dim} needs >=3 templates`);
      for (const base of baselines) {
        const q = generateTransferQuestion({ competency: dim, baselineQuestion: base, baselineAnswer: '지난 프로젝트에서 제가 직접 일정을 조정했습니다.' });
        assert.equal(q.target_competency, dim);
        assert.notEqual(q.text, base);
        assert.ok(questionSimilarity(q.text, base) < 0.55);
        assert.ok(q.novelty_guard);
        assert.ok(!q.text.includes('지난 프로젝트에서 제가 직접'));
      }
    }
  }
});

test('C4: no template is similar to any baseline question', () => {
  for (const [dim, ts] of Object.entries(TRANSFER_BANK)) {
    for (const t of ts) for (const b of baselines) assert.ok(questionSimilarity(t, b) < 0.55, `${dim}: ${t} ~ ${b}`);
  }
});

test('C4: unknown competency is rejected (422), never falls back to reflection', () => {
  assert.throws(() => generateTransferQuestion({ competency: 'nope', baselineQuestion: '기존 질문은 충분히 긴 문장입니다.' }), (e) => e.code === 422);
});
