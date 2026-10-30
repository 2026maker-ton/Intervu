import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { containsBannedExpression, REASON_COPY, SOURCE_STATUS, reasonCopy } from '../../public/core/copy.js';

test('금지 표현 검출', () => {
  for (const t of ['합격 가능성 80%', '합격 확률', '합격 예측 결과', 'AI가 정확히 평가합니다', '상위 순위', '백분위 12', '거짓말 탐지', '감정 분석 결과'])
    assert.equal(containsBannedExpression(t), true, t);
});
test('부정 문맥·일반 문구는 허용', () => {
  for (const t of ['합격 예측이 아닙니다', '감정 분석은 하지 않습니다', '규칙 기반 참고 관찰', '']) assert.equal(containsBannedExpression(t), false, t);
});
test('reason 매핑 완전성', () => {
  const reasons = ['rate_limited', 'timeout', 'invalid_output', 'budget_cap', 'kill_switch', 'not_configured', 'live_ack_missing', 'real_data_ack_missing', 'consent_missing', 'synthetic_only'];
  for (const r of reasons) assert.ok(REASON_COPY[r] && /[가-힣]/.test(REASON_COPY[r]), r);
  assert.equal(Object.keys(REASON_COPY).length, reasons.length);
  assert.ok(reasonCopy('unknown_x'));
});
test('출처 상태 9종 고정 라벨(+demo_fixture, monthly_trend_mock)', () => {
  assert.equal(Object.keys(SOURCE_STATUS).length, 9);
  assert.equal(SOURCE_STATUS.conflict.label, '내용 충돌');
});
test('public/ 사용자 문구에 금지 표현 없음', () => {
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  // 허용: "하지 않는 일" 목록(부정 제목 아래 항목)
  const allow = [/합격 확률·백분위·성격\/감정 진단/, /얼굴·카메라·음성 감정 분석/];
  const bad = [];
  for (const f of walk('public').filter((p) => /\.(js|html)$/.test(p) && !p.endsWith('copy.js'))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (containsBannedExpression(line) && !allow.some((a) => a.test(line))) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
