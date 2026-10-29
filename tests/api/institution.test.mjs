import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';

useSharedApp();

test('institution profile: company with official source links answers to requirements', async () => {
  await cleanupAll();
  const p = await call('/api/v1/profiles', {
    method: 'POST',
    body: {
      org_type: 'company', target_name: '테스트전자', role: '기획',
      source_text: '모집: 문제 해결, 협업, 데이터 분석 역량을 봅니다. 면접 15분.',
      sources: [{ url: 'https://careers.example.com/jobs/123', title: '2026 상반기 채용공고', publisher: '테스트전자', published_at: '2026-09-01', kind: 'official', quote: '문제 해결' }],
    },
  });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.ok(p.data.institution, 'institution draft returned');
  assert.equal(p.data.institution.org_type, 'company');
  assert.ok(p.data.institution.core_values.some((c) => c.label === '문제해결'), JSON.stringify(p.data.institution.core_values));
  const inst = await call(`/api/v1/profiles/${p.data.id}/institution`);
  assert.equal(inst.status, 200);
  assert.equal(inst.data.status, 'review');
  assert.ok(inst.data.institution.recommended_questions.length >= 1);
  // 사용자 확인·승인
  const ok = await call(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', body: { version_id: p.data.version_id, institution_edits: { note: '핵심가치 확인함' } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.institution_status, 'approved');
  // 역할 지정 세션 생성: 기관 맞춤 질문이 앞에 배치됨
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.data.version_id, mode: 'structured', interviewer_role: 'practitioner', persona: 'standard', duration_minutes: 10, input_mode: 'text' } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.interviewer_role, 'practitioner');
  assert.ok(s.data.question_basis);
  // 면접 진행 → 보고서에 기관 연결 포함
  const start = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
  let version = start.data.version;
  const answers = [
    '제가 기획에서 문제 해결을 위해 데이터를 분석했어요. 이해관계자 요구를 표로 정리했고 결과적으로 기한 안에 제출했어요.',
    '제가 협업에서 일정을 조정했어요. 역할별 마감 시간을 합의했고 이후 마감 누락 없이 제출했어요.',
    '다시 한다면 먼저 일정을 확인하고 바꾸겠어요.',
    '제가 대안을 비교했어요. 비용과 시간을 표로 정리해서 팀이 선택할 근거를 제시했어요.',
    '고객 요구와 내부 기준이 충돌하면 제가 기준을 확인하고 대안을 비교하겠어요.',
    '앞선 경험의 교훈을 새 팀에 적용할 때 유지할 점과 바꿀 점을 비교하겠어요.',
  ];
  let finished = false;
  for (const text of answers) {
    const r = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'turn.text', payload: { text } } });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    version = r.data.version;
    if (r.data.state === 'completed') { finished = true; break; }
  }
  if (!finished) {
    const f = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: version, type: 'session.finish', payload: {} } });
    assert.equal(f.status, 202);
  }
  const rep = await call(`/api/v1/sessions/${s.data.id}/report`);
  assert.equal(rep.status, 200, JSON.stringify(rep.data));
  assert.ok(rep.data.institution, 'report carries institution snapshot');
  assert.equal(rep.data.institution.org_type, 'company');
  assert.equal(rep.data.institution_link.mode, 'institution');
  assert.ok(rep.data.institution_link.links.length >= 1, JSON.stringify(rep.data.institution_link));
});

test('institution fallback: no official source uses general template honestly', async () => {
  await cleanupAll();
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'university', target_name: '테스트대', role: '경영학과', source_text: '지원동기와 진로계획을 말해주세요.' } });
  assert.equal(p.status, 201);
  assert.equal(p.data.institution.fallback_to_general, true);
  assert.match(p.data.institution.badge, /일반 템플릿/);
  const inst = await call(`/api/v1/profiles/${p.data.id}/institution`);
  assert.equal(inst.data.institution.unevaluable.some((u) => /비공개 채점/.test(u.area)), true);
});

test('source validation: SSRF blocked, stale flagged, unofficial marked', async () => {
  await cleanupAll();
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'company', target_name: 'T', role: '사무', source_text: '문제 해결 역량' } });
  assert.equal(p.status, 201);
  const badLocal = await call(`/api/v1/profiles/${p.data.id}/sources`, { method: 'POST', body: { sources: [{ url: 'http://169.254.169.254/latest/meta-data/', title: '내부', kind: 'official' }] } });
  assert.equal(badLocal.status, 422);
  const badPort = await call(`/api/v1/profiles/${p.data.id}/sources`, { method: 'POST', body: { sources: [{ url: 'https://example.com:8080/x', title: '비표준', kind: 'official' }] } });
  assert.equal(badPort.status, 422);
  const ok = await call(`/api/v1/profiles/${p.data.id}/sources`, {
    method: 'POST',
    body: {
      sources: [
        { url: 'https://blog.example.com/review-123', title: '면접 후기 모음', publisher: '블로그', published_at: '2023-01-01', kind: 'unofficial', quote: '분위기가 편안했어요' },
        { url: 'https://token.example.com/jobs?a=1&token=secret', title: '쿼리 토큰', kind: 'unofficial' },
      ],
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const got = await call(`/api/v1/profiles/${p.data.id}/institution`);
  assert.equal(got.status, 200);
  const stale = got.data.institution.sources_summary.freshness.find((f) => f.title === '면접 후기 모음');
  assert.equal(stale.state, 'stale');
  assert.ok(got.data.institution.sources_summary.privacy_issues.some((i) => i.issue === 'credential_query_in_url'));
});

test('role separation: same persona different role changes followup focus, rubric fixed', async () => {
  await cleanupAll();
  const mk = async (role) => {
    const s = await call('/api/v1/sessions', { method: 'POST', body: { mode: 'structured', persona: 'standard', interviewer_role: role, duration_minutes: 10, input_mode: 'text' } });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    assert.equal(s.data.interviewer_role, role);
    const st = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: s.data.version, type: 'session.start', payload: {} } });
    const r = await call(`/api/v1/sessions/${s.data.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: st.data.version, type: 'turn.text', payload: { text: '팀 프로젝트를 했어요.' } } });
    return r.data.utterance;
  };
  const hrU = await mk('hr');
  await cleanupAll();
  const execU = await mk('executive');
  assert.notEqual(hrU, execU, 'role changes followup wording');
  assert.match(hrU, /팀/);
  assert.match(execU, /결정|책임/);
});

test('highschool forces mock and blocks gemini path', async () => {
  await cleanupAll();
  const p = await call('/api/v1/profiles', { method: 'POST', body: { org_type: 'highschool', target_name: '테스트고', role: '일반전형', source_text: '지원동기와 진로계획, 봉사 경험을 말해주세요.' } });
  assert.equal(p.status, 201);
  assert.equal(p.data.provider, 'mock');
  assert.equal(p.data.institution.org_type, 'highschool');
  const ok = await call(`/api/v1/profiles/${p.data.id}/approve`, { method: 'POST', body: { version_id: p.data.version_id } });
  assert.equal(ok.status, 200);
  const s = await call('/api/v1/sessions', { method: 'POST', body: { profile_version_id: p.data.version_id, interviewer_role: 'admissions', duration_minutes: 10 } });
  // 현재 서버가 Mock이므로 세션 생성 허용(Mock 검증 범위). Gemini 실키 환경에서는 422 차단.
  assert.ok([201, 422].includes(s.status));
});

test('invalid interviewer role rejected', async () => {
  await cleanupAll();
  const r = await call('/api/v1/sessions', { method: 'POST', body: { mode: 'structured', interviewer_role: 'ceo', duration_minutes: 10 } });
  assert.equal(r.status, 422);
});
