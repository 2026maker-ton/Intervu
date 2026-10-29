// WP-E3: 데모 12단계 API 리허설을 npm test에 포함한다(Mock, 외부 호출 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRehearsal, formatTable } from '../../tools/rehearsal.mjs';

test('E3: 12-step API rehearsal passes for company + university, restart, and provider-down fallback', async () => {
  const { ok, rows } = await runRehearsal();
  assert.ok(ok, '\n' + formatTable(rows));
  assert.equal(rows.length, 26);
});
