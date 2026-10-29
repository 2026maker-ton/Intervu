// Gemini 실키 E2E (합성 데이터만). GEMINI_PAID_ACK=true + GEMINI_ALLOW_UNPAID=true 로
// '합성 트래픽'만 허용한 상태에서 어댑터 경로를 검증한다. 실제 사용자 데이터는 보내지 않는다.
// 사용: node tools/gemini-e2e.mjs
import { createApp } from '../src/server.js';
import { loadDotEnv } from '../src/env.js';

const env = loadDotEnv(process.cwd());
if (!env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY missing'); process.exit(2); }

const app = createApp({
  // 합성 전용 인스턴스는 코드로만 켠다(HTTP·환경변수로는 불가). PROJECT.md §5 #3.
  syntheticTraffic: true,
  env: {
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_TEXT_MODEL: env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite',
    GEMINI_FALLBACK_MODEL: env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash',
    // 합성 트래픽만: 무료 quota 사용을 명시적으로 허용
    GEMINI_ALLOW_UNPAID: 'true',
    GEMINI_PAID_ACK: 'false',
    DEV_TOKEN_A: 'dev-user-a-token',
  },
});
await new Promise((r) => app.server.listen(0, r));
const base = `http://127.0.0.1:${app.server.address().port}`;
console.log('provider selected:', app.providerName);
if (app.providerName !== 'gemini') { console.error('expected gemini for synthetic traffic'); app.server.close(); process.exit(1); }

const headers = () => ({ Authorization: 'Bearer dev-user-a-token', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() });
async function call(path, method, body) {
  const res = await fetch(base + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

await call('/api/v1/consents', 'POST', { age_19_confirmed: true, notice_version: 'e2e-1' }); // WP-C6 동의 선기록
const t0 = Date.now();
const p = await call('/api/v1/profiles', 'POST', {
  org_type: 'public', target_name: '합성테스트기관', role: '사무',
  source_text: '합성 공고입니다. 담당업무는 문제 해결, 협업, 데이터 분석입니다. 면접은 1:1로 15분 진행됩니다. 토론면접은 없습니다.',
});
console.log('profile:', p.status, 'pii:', p.data.pii_warnings, 'provider:', p.data.provider);
const detail = await call(`/api/v1/profiles/${p.data.id}`, 'GET');
const ex = detail.data.current_version.extracted;
console.log('claims:', JSON.stringify(ex.claims?.map((c) => [c.value, c.start_cp, c.end_cp])));
console.log('rejected spans:', ex.rejected_spans || 0, 'missing:', ex.missing_fields);

await call(`/api/v1/profiles/${p.data.id}/approve`, 'POST', { version_id: p.data.version_id });
const s = await call('/api/v1/sessions', 'POST', { profile_version_id: p.data.version_id, mode: 'structured', persona: 'standard', duration_minutes: 10, input_mode: 'text' });
const st = await call(`/api/v1/sessions/${s.data.id}/commands`, 'POST', { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} });
let v = st.data.version;
console.log('first question:', st.data.question?.text?.slice(0, 50));
const answer = '제가 팀 일정을 조정했어요. 역할별 마감을 합의했고, 이후 누락 없이 제출했어요.';
const r = await call(`/api/v1/sessions/${s.data.id}/commands`, 'POST', { command_id: crypto.randomUUID(), expected_version: v, type: 'turn.text', payload: { text: answer } });
console.log('turn:', r.status, 'action:', r.data.action, 'degraded:', r.data.degraded_reason || 'none');
console.log('utterance:', r.data.utterance);
console.log('elapsed ms:', Date.now() - t0);
console.log('gemini stats:', app.providerInfo().selected, app.store ? '' : '');
const rep = await call(`/api/v1/sessions/${s.data.id}/report`, 'GET');
console.log('report before finish:', rep.status);
app.server.close();
