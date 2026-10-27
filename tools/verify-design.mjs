import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { calculate } from './cost-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const a = read('docs/cost-assumptions.json');
const schema = read('docs/contracts/evaluation.schema.json');
const report = read('docs/fixtures/evaluation.valid.json');
const transcripts = read('docs/fixtures/transcripts.json');

function validateEvidence(r) {
  assert.equal(r.session_id, transcripts.session_id);
  assert.equal(r.schema_version, '1.0');
  assert.equal(new Set(r.dimensions.map(d => d.id)).size, r.dimensions.length, 'duplicate dimension');
  for (const d of r.dimensions) {
    assert(schema.properties.dimensions.items.properties.id.enum.includes(d.id));
    const levels = new Map();
    for (const e of d.evidence) {
      const t = transcripts.turns.find(t => t.turn_id === e.turn_id && t.revision === e.revision);
      assert(t && t.speaker === 'user', 'unknown/non-user turn');
      assert(t.elicited_dimensions.includes(d.id), 'dimension not elicited');
      const chars = Array.from(t.text.normalize('NFC'));
      assert(e.start_cp >= 0 && e.end_cp > e.start_cp && e.end_cp <= chars.length, 'bad span');
      assert.equal(chars.slice(e.start_cp, e.end_cp).join(''), e.quote, 'quote mismatch');
      assert.equal(e.anchor_id, `${d.id}:${e.answer_level}`);
      assert(Number.isInteger(e.answer_level) && e.answer_level >= 1 && e.answer_level <= 4);
      if (levels.has(e.turn_id)) assert.equal(levels.get(e.turn_id), e.answer_level, 'conflicting same-turn levels');
      levels.set(e.turn_id, e.answer_level);
    }
    if (d.status === 'scored') {
      assert(levels.size >= 2, 'insufficient distinct turns');
      assert.equal(d.abstention_reason, null);
      const sorted = [...levels.values()].sort((x,y) => x-y), mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
      assert.equal(d.level, median, 'server-computed median mismatch');
    } else {
      assert.equal(d.status, 'insufficient_evidence');
      assert.equal(d.level, null);
      assert(d.abstention_reason?.length > 0);
    }
  }
}

validateEvidence(report);
for (const mutate of [
  r => r.dimensions[0].evidence[0].quote = '존재하지 않는 발언',
  r => r.dimensions[0].evidence[0].turn_id = 'another-user-turn',
  r => r.dimensions[0].evidence[1] = {...r.dimensions[0].evidence[0]},
  r => r.dimensions[0].level = 4,
  r => r.dimensions[1].level = 0,
  r => r.dimensions.push(structuredClone(r.dimensions[0]))
]) {
  const invalid = structuredClone(report); mutate(invalid);
  assert.throws(() => validateEvidence(invalid));
}
const c = calculate(a);
assert(Math.abs(c.per_session.baseline - 0.021133333333333334) < 1e-12);
assert(Math.abs(c.streaming_per_session.full_session_regular - 0.1885) < 1e-12);
const tiny = structuredClone(a); tiny.scenario.user_audio_seconds_per_turn = [1, 2];
assert.equal(calculate(tiny).per_session.billed_stt_seconds, 20);
assert.equal(calculate(a, 0).monthly.api, 0);
assert(calculate(a, 1000, true).monthly.api < c.monthly.api);
assert.throws(() => calculate(a, -1));
assert.throws(() => calculate(a, 1.5));
const files = ['README.md','docs/master-plan.md','docs/implementation-spec.md','docs/ai-contracts.md','docs/research-market.md','docs/research-technology.md','docs/research-evaluation-legal.md'];
for (const file of files) assert(fs.existsSync(path.join(root, file)), `missing ${file}`);
console.log('PASS: JSON parsing, evidence spans/ownership references/coverage/median, six invalid fixtures, cost arithmetic/minimum billing/free-tier and required files.');
console.log('Scope: document fixtures only; not full JSON Schema validation, live APIs, database policies, or browser E2E.');
