// 잡음 vs 말 판별(public/core/speech-gate.js): 작은 소리·짧은 소리·주기성 없는 소리는 무음, 지속되고 주기적인 소리만 말.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechGate, thresholdFrom, FLOOR_RMS } from '../../public/core/speech-gate.js';

const run = (g, frames, periodic) => { let last; for (const r of frames) last = g.push(r, () => periodic); return last; };
const rep = (v, n) => Array(n).fill(v);

test('very quiet sound (below the floor) is silence even if the calibrated threshold is tiny', () => {
  assert.equal(thresholdFrom(0.0001), FLOOR_RMS, 'floor wins over avg*3');
  const g = createSpeechGate(0.001);
  run(g, rep(FLOOR_RMS * 0.9, 200), true);
  assert.equal(g.spoke, false);
  assert.equal(g.stats().voiced, 0);
});
test('short bursts (click, cough, keyboard < 150ms) never count as speech', () => {
  const g = createSpeechGate();
  for (let i = 0; i < 50; i++) run(g, [...rep(0.2, 2), ...rep(0, 5)], true);
  assert.equal(g.spoke, false);
});
test('loud but non-periodic noise (fan, wind, rustle) is not speech', () => {
  const g = createSpeechGate();
  run(g, rep(0.2, 120), false);
  assert.equal(g.spoke, false);
  assert.ok(g.stats().voiced >= 100 && g.stats().periodic === 0);
});
test('sustained periodic sound is speech; flicker below the run length resets the run', () => {
  const g = createSpeechGate();
  const r = run(g, rep(0.1, 12), true);
  assert.equal(r.spoke, true);
  assert.equal(r.voice, true);
  const h = createSpeechGate();
  for (let i = 0; i < 60; i++) run(h, [0.1, 0.1, 0], true); // 2프레임 켜짐/1프레임 꺼짐 반복: 연속 3프레임이 없다
  assert.equal(h.spoke, false);
});
test('reset clears the segment', () => {
  const g = createSpeechGate(); run(g, rep(0.1, 12), true); assert.equal(g.spoke, true);
  g.reset(); assert.equal(g.spoke, false); assert.equal(g.stats().voiced, 0);
});
