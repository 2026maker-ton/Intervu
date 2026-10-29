// WP-C7 규칙 주장 추출 정확도 측정(합성 49문장: 주장 23 / 비주장 26, 다짐·소개·부정·수동·수치만 포함).
// 측정값(현재 규칙): 개선 전 precision 0.88(22/25) recall 0.957(22/23), 개선 후(부정·전언·수동·선호 제외)
// precision 1.00 recall 0.957 (TP22 FP0 FN1: '만들었' 문장은 표지 없음 — B3 모델 인용 테스트와 충돌해 표지로 추가하지 않음). 소규모 합성 코퍼스라 일반화 성능이 아니다 — 하한(precision 0.95, recall 0.90)은 회귀 방지용.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure } from '../eval/measure-claims.mjs';

test('C7 corpus: precision/recall floors (measured 1.00/0.957 minus ~0.05 tolerance)', () => {
  const m = measure();
  assert.ok(m.n >= 40);
  assert.ok(m.precision >= 0.95, `precision ${m.precision} FP: ${m.fps.join(' | ')}`);
  assert.ok(m.recall >= 0.90, `recall ${m.recall} FN: ${m.fns.join(' | ')}`);
});
