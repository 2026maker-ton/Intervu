// 기관 맞춤형 E2E: 기업/학교/차단 케이스를 실제 HTTP로 검증 (Mock 경로)
// 전용 ephemeral 서버(PROFILE_RATE 완화)로 실행해 공용 서버 제한과 분리한다.
import { createApp } from '../src/server.js';
const app = createApp({ env: { GEMINI_API_KEY: '', DEV_TOKEN_A: 'dev-user-a-token', DEV_TOKEN_B: 'dev-user-b-token', PROFILE_RATE_PER_MINUTE: '100', PROFILE_RATE_PER_DAY: '100' } });
await new Promise((r) => app.server.listen(0, r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const TOKEN = process.env.DEV_TOKEN_A || 'dev-user-a-token';
let pass = 0, fail = 0;
async function call(path, { method = 'GET', body } = {}) {
  const h = { Authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (method !== 'GET') h['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
await fetch(base + '/api/v1/consents', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ age_19_confirmed: true, notice_version: 'e2e-1' }) }); // WP-C6 동의 선기록
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`); }
}
async function finishAll(sid, version, texts) {
  let v = version;
  for (const text of texts) {
    const r = await call(`/api/v1/sessions/${sid}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: v, type: 'turn.text', payload: { text } } });
    if (r.status !== 202) return { error: r };
    v = r.data.version;
    if (r.data.state === 'completed') return { version: v, completed: true };
  }
  const f = await call(`/api/v1/sessions/${sid}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: v, type: 'session.finish', payload: {} } });
  return { version: v, completed: f.status === 202 };
}

// 1) 일반기업 + 공식 출처 + HR 역할
{
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', target_name: 'E2E전자', role: '기획', source_text: '모집: 문제 해결, 협업, 데이터 분석 역량을 봅니다. 면접 15분.', sources: [{ url: 'https://careers.example.com/jobs/e2e', title: 'E2E 채용공고', published_at: '2026-09-01', kind: 'official', quote: '문제 해결' }] } });
  ok('company profile 201', p.status === 201, JSON.stringify(p.data).slice(0, 300));
  ok('company institution draft', !!p.data.institution && p.data.institution.org_label === '일반기업', JSON.stringify(p.data.institution || {}).slice(0, 300));
  const ap = await call(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', body: { version_id: p.data.version_id } });
  ok('company approve', ap.status === 200 && ap.data.institution_status === 'approved');
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.data.version_id, interviewer_role: 'hr', persona: 'standard', duration_minutes: 10, input_mode: 'text' } });
  ok('company session hr', s.status === 201 && s.data.interviewer_role === 'hr', JSON.stringify(s.data).slice(0, 300));
  const st = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  ok('company start', st.status === 202);
  const fin = await finishAll(s.data.id, st.data.version, [
    '제가 기획에서 문제 해결을 위해 데이터를 분석했어요. 이해관계자 요구를 표로 정리했고 결과적으로 기한 안에 제출했어요.',
    '제가 협업에서 일정을 조정했어요. 역할별 마감 시간을 합의했고 이후 마감 누락 없이 제출했어요.',
    '다시 한다면 먼저 일정을 확인하고 바꾸겠어요.',
    '제가 대안을 비교했어요. 비용과 시간을 표로 정리해서 팀이 선택할 근거를 제시했어요.',
    '고객 요구와 내부 기준이 충돌하면 제가 기준을 확인하고 대안을 비교하겠어요.',
    '앞선 경험의 교훈을 새 팀에 적용할 때 유지할 점과 바꿀 점을 비교하겠어요.',
  ]);
  ok('company finish', !fin.error, JSON.stringify(fin.error || {}).slice(0, 300));
  const rep = await call(`/api/v1/sessions/${s.data.id}/report`);
  ok('company report institution link', rep.status === 200 && rep.data.institution_link?.mode === 'institution' && rep.data.institution_link.links.length >= 1, JSON.stringify(rep.data.institution_link || {}).slice(0, 400));
}

// 2) 대학교 + 입학전형위원 + 폴백 없음(공식 키워드 포함)
{
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'university', target_name: 'E2E대', role: '경영학과', source_text: '지원동기와 진로계획, 탐구 경험을 평가합니다. 학업 역량을 봅니다.' } });
  ok('univ profile', p.status === 201 && p.data.institution.org_type === 'university');
  ok('univ focus school', (p.data.institution.focus_areas || []).includes('지원동기'));
  await call(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', body: { version_id: p.data.version_id } });
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.data.version_id, interviewer_role: 'admissions', persona: 'supportive', duration_minutes: 10, input_mode: 'text' } });
  ok('univ session admissions', s.status === 201 && s.data.interviewer_role === 'admissions', JSON.stringify(s.data).slice(0, 200));
  const one = await call(`/api/v1/sessions/${s.data.id}`, {});
  ok('univ role label', one.data.role_label === '입학전형위원', JSON.stringify(one.data).slice(0, 200));
}

// 3) SSRF 차단
{
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', target_name: 'X', role: '사무', source_text: '문제 해결' } });
  const bad = await call(`/api/v1/profiles/${p.data.id}/sources`, { method: 'POST', body: { sources: [{ url: 'http://localhost:3000/admin', title: '내부', kind: 'official' }] } });
  ok('ssrf localhost blocked', bad.status === 422);
}

// 4) 고등학교: Mock 강제 + 보고서 면책
{
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'highschool', target_name: 'E2E고', role: '일반전형', source_text: '지원동기와 진로계획, 봉사 경험을 말해주세요.' } });
  ok('highschool mock forced', p.status === 201 && p.data.provider === 'mock');
}

// 5) 상충·오래된 자료 표시
{
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'public', target_name: 'E2E공사', role: '사무', source_text: '문제 해결, 협업 역량을 봅니다.', sources: [{ url: 'https://blog.example.com/old', title: '후기', kind: 'unofficial', published_at: '2022-01-01', quote: '편안했어요' }] } });
  const inst = await call(`/api/v1/profiles/${p.data.id}/institution`);
  ok('stale flagged', inst.data.institution.sources_summary.freshness.some((f) => f.state === 'stale'), JSON.stringify(inst.data.institution.sources_summary.freshness).slice(0, 300));
}

console.log(`\nE2E done: ${pass} pass, ${fail} fail`);
app.server.close();
process.exit(fail ? 1 : 0);
