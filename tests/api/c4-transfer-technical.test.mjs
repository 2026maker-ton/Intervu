import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, call, cleanupAll } from '../helpers/app.mjs';
import { startTyped, say, finishAndReport, GOOD_ANSWER } from '../helpers/interview.mjs';
import { TRANSFER_BANK } from '../../src/domain/transfer.js';

useSharedApp();

test('C4: technical-rubric session practice-attempt yields a technical-dimension question', async () => {
  await cleanupAll();
  const { s, start } = await startTyped({ interview_type: 'technical', duration_minutes: 10 });
  const v1 = (await say(s.id, start.version, GOOD_ANSWER)).data.version;
  const rep = await finishAndReport(s.id, v1);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  const p = await call('/api/v1/practice-attempts', { method: 'POST', body: { evaluation_id: rep.data.evaluation_id, competency_id: 'concept_clarity' } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal(p.data.rubric_version, 'technical-ko-v1');
  assert.equal(p.data.transfer_question.target_competency, 'concept_clarity');
  assert.ok(TRANSFER_BANK.concept_clarity.includes(p.data.transfer_question.text));
  assert.notEqual(p.data.transfer_question.text, p.data.baseline_question);
});
