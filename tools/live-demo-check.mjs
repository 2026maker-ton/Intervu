// 수동 실연동 점검: .env의 실제 키로 서버 fixture(합성 샘플)만 보내 각 AI 단계가 실제로 live인지 확인한다.
// 실제 사용자 데이터는 보내지 않는다. 사용: node tools/live-demo-check.mjs [highschool|university]
import { createApp } from '../src/server.js';
import { FIXTURES } from '../src/domain/fixtures.js';

const kind = process.argv[2] === 'highschool' ? 'highschool' : 'university';
const fx = FIXTURES.find((f) => f.kind === kind);
const app = createApp({ env: { STORE: 'memory', TRENDS_FILE: '' } });
const tok = Object.keys(app.config.devTokens)[0];
if (!tok) { console.error('DEV_TOKEN_A가 없습니다.'); process.exit(2); }
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const call = async (p, method = 'GET', body) => {
  const h = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const show = (label, traces) => console.log(`${label}: ${(traces || []).map((t) => `${t.operation}=${t.provider}/${t.mode}${t.reason ? `(${t.reason})` : ''}`).join(' | ') || '(trace 없음)'}`);
console.log(`fixture=${fx.id} (${kind})  provider status:`);
const ps = await call('/api/v1/providers/status');
for (const [op, v] of Object.entries(ps.data.operations || {})) console.log(`  ${op}: ${v.provider}/${v.mode}${v.blocked_reason ? ` (차단: ${v.blocked_reason})` : ''}`);
await call('/api/v1/consents', 'POST', { age_19_confirmed: true, notice_version: 'live-check' });
const pr = await call('/api/v1/profiles', 'POST', { org_type: kind, fixture_id: fx.id, school_name: fx.school_name, department: fx.department, target_name: fx.school_name, role: fx.department, source_text: fx.posting_text, application_text: fx.application_text });
console.log('profile', pr.status, 'synthetic=', pr.data.synthetic); show('  create', pr.data.provider_trace);
const an = await call(`/api/v1/profiles/${pr.data.id}/school-analysis`, 'POST', {});
console.log('school-analysis', an.status, 'mode=', an.data.analysis_mode, 'traits=', (an.data.talent_traits || []).length, 'unconfirmed=', (an.data.unconfirmed || []).length); show('  analyze', an.data.provider_trace);
const ap = await call(`/api/v1/profiles/${pr.data.id}/approve`, 'POST', { version_id: pr.data.version_id });
console.log('approve', ap.status, 'plan=', JSON.stringify(ap.data.plan || {}).slice(0, 220));
const plan = await call(`/api/v1/profiles/${pr.data.id}/plan?duration_minutes=5&seed=1`);
console.log('plan questions:'); for (const q of plan.data.questions || []) console.log(`  [${q.generator}] ${q.text.slice(0, 90)}`);
const s = await call('/api/v1/sessions', 'POST', { profile_version_id: pr.data.version_id, interview_type: 'general', duration_minutes: 5 });
const st = await call(`/api/v1/sessions/${s.data.id}/commands`, 'POST', { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} });
let v = st.data.version; let last;
for (let i = 0; i < 4; i++) {
  last = await call(`/api/v1/sessions/${s.data.id}/commands`, 'POST', { command_id: crypto.randomUUID(), expected_version: v, type: 'turn.text', payload: { text: fx.answers[i % fx.answers.length] } });
  if (last.status !== 202) { console.log('turn error', last.status, JSON.stringify(last.data).slice(0, 160)); break; }
  show(`  turn${i + 1} ${last.data.action}`, last.data.provider_trace); v = last.data.version;
  if (last.data.state === 'completed') break;
}
const fin = await call(`/api/v1/sessions/${s.data.id}/commands`, 'POST', { command_id: crypto.randomUUID(), expected_version: v, type: 'session.finish', payload: {} });
const rep = await call(`/api/v1/sessions/${s.data.id}/report`);
console.log('report', rep.status, 'evaluator=', JSON.stringify(rep.data.evaluator)); show('  eval', rep.data.provider_trace);
app.store.close?.(); await new Promise((r) => app.server.close(r));
