import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp, A, B, app, base, call, newSession, cleanupAll } from '../helpers/app.mjs';
import { createApp } from '../../src/server.js';
import { startTyped, say, finishAndReport, GOOD_ANSWER } from '../helpers/interview.mjs';

useSharedApp();

test('interview type catalog exposes all six types and axes', async () => {
  const r = await call('/api/v1/interview-types');
  assert.equal(r.status, 200);
  const ids = r.data.types.map((t) => t.id).sort();
  assert.deepEqual(ids, ['discussion', 'general', 'panel', 'pt', 'situational', 'technical']);
  assert.deepEqual(r.data.durations, [5, 10, 15]);
  assert.ok(r.data.roles.length >= 6);
  assert.ok(r.data.topics.length >= 1 && r.data.pt_tasks.length >= 1 && r.data.scenarios.length >= 1);
});

test('duration controls question count (5min=3, 10min=4, 15min=5)', async () => {
  for (const [minutes, expected] of [[5, 3], [10, 4], [15, 5]]) {
    await cleanupAll();
    const s = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'general', duration_minutes: minutes } });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    const detail = await call(`/api/v1/sessions/${s.data.id}`);
    assert.equal(detail.data.questions.length, expected, `${minutes}분 → ${expected}문항`);
    assert.equal(detail.data.duration_seconds, minutes * 60);
  }
});

test('general session keeps behavioral rubric and scores with evidence', async () => {
  const { s, version } = await startTyped({ interview_type: 'general', duration_minutes: 10 });
  assert.equal(s.rubric_version, 'behavioral-ko-v1');
  let v = version;
  for (const t of [GOOD_ANSWER, '다음에는 일정을 먼저 확인하고 바꾸겠습니다.']) {
    const r = await say(s.id, v, t);
    assert.equal(r.status, 202, JSON.stringify(r.data));
    v = r.data.version;
    if (r.data.state === 'completed') break;
  }
  const rep = await finishAndReport(s.id, v);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  assert.equal(rep.data.interview_type, 'general');
  assert.deepEqual(rep.data.dimensions.map((d) => d.id), ['relevance', 'evidence_specificity', 'reasoning', 'reflection']);
});

test('technical session asks concept questions with technical rubric', async () => {
  const { s, start } = await startTyped({ interview_type: 'technical', duration_minutes: 10 });
  assert.equal(s.rubric_version, 'technical-ko-v1');
  assert.equal(s.interviewer_role, 'expert');
  assert.match(start.question.text, /개념|적용|방법/);
  const v1 = (await say(s.id, start.version, GOOD_ANSWER)).data.version;
  const rep = await finishAndReport(s.id, v1);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  assert.deepEqual(rep.data.dimensions.map((d) => d.id), ['concept_clarity', 'evidence_specificity', 'reasoning', 'applicability']);
});

test('discussion: AI 2 participants, moderator openings, user gets 4 opportunities then closing', async () => {
  const { s, start } = await startTyped({ interview_type: 'discussion', duration_minutes: 10 });
  assert.equal(s.participant_layout, 'group');
  assert.equal(s.rubric_version, 'discussion-ko-v1');
  assert.ok(s.topic?.title, 'topic present');
  assert.equal(start.openings.length, 2, 'moderator + AI opening');
  assert.equal(start.openings[0].speaker_id, 'moderator');
  assert.match(start.openings[0].utterance, /사회자/);
  let v = start.version;
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    const r = await say(s.id, v, `${GOOD_ANSWER} ${i + 1}번째 발언입니다.`);
    assert.equal(r.status, 202, JSON.stringify(r.data));
    v = r.data.version;
    last = r.data;
    assert.ok(r.data.discussion.next_speaker !== 'user' || r.data.utterances.length >= 1);
    if (r.data.state === 'completed') break;
  }
  assert.equal(last.state, 'completed', 'discussion ends after 4 user turns');
  assert.equal(last.action, 'discussion_complete');
  assert.equal(last.discussion.phase, 'closing');
  assert.equal(last.discussion.user_opportunities, 4);
  const rep = await call(`/api/v1/sessions/${s.id}/report`);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  assert.deepEqual(rep.data.dimensions.map((d) => d.id), ['claim_understanding', 'evidence_use', 'rebuttal', 'collaboration']);
});

test('discussion with 2 user turns abstains on collaboration instead of guessing', async () => {
  const { s, version } = await startTyped({ interview_type: 'discussion', duration_minutes: 5 });
  let v = version;
  for (let i = 0; i < 2; i += 1) {
    const r = await say(s.id, v, `제가 예산 기준을 먼저 말씀드리겠습니다. ${i}`);
    v = r.data.version;
  }
  const rep = await finishAndReport(s.id, v);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  const collab = rep.data.dimensions.find((d) => d.id === 'collaboration');
  assert.equal(collab.status, 'insufficient_evidence');
  assert.equal(collab.level, null);
  assert.ok(collab.abstention_reason);
});

test('discussion utterances reference previous claim (not fixed script)', async () => {
  const { s, start } = await startTyped({ interview_type: 'discussion', duration_minutes: 10 });
  const aboutLibrary = await say(s.id, start.version, '도서관 주말 운영과 디지털 교육 중 예산 배분 기준을 말씀드립니다.');
  const aboutNight = await say(s.id, aboutLibrary.data.version, '야간 통학과 혼잡 시간대 이용자를 함께 봐야 합니다.');
  const texts = [...(aboutLibrary.data.utterances || []), ...(aboutNight.data.utterances || [])].map((u) => u.utterance);
  assert.ok(texts.some((t) => /직전 발언|사용자 의견|받았습니다/.test(t)), JSON.stringify(texts));
  assert.notEqual(aboutLibrary.data.utterance, aboutNight.data.utterance, 'response changes with user content');
});

test('pt: brief → prepare → present → qa, then report uses presentation rubric', async () => {
  const { s, start } = await startTyped({ interview_type: 'pt', duration_minutes: 10 });
  assert.equal(start.pt_phase, 'brief');
  assert.ok(start.pt_task?.title);
  let v = start.version;
  const skip = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: v, type: 'pt.prepare', payload: { phase: 'qa' } } });
  assert.equal(skip.status, 409, 'cannot skip phases');
  const prep = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: v, type: 'pt.prepare', payload: { phase: 'prepare' } } });
  assert.equal(prep.status, 202); v = prep.data.version;
  assert.equal(prep.data.pt_phase, 'prepare');
  const present = await call(`/api/v1/sessions/${s.id}/commands`, { method: 'POST', body: { command_id: crypto.randomUUID(), expected_version: v, type: 'pt.prepare', payload: { phase: 'present' } } });
  assert.equal(present.status, 202); v = present.data.version;
  const p1 = await say(s.id, v, GOOD_ANSWER); assert.equal(p1.status, 202); v = p1.data.version;
  assert.equal(p1.data.pt_phase, 'present');
  const p2 = await say(s.id, v, `${GOOD_ANSWER} 실행 순서는 1단계 진단, 2단계 시범 운영입니다.`); assert.equal(p2.status, 202); v = p2.data.version;
  assert.equal(p2.data.pt_phase, 'qa', 'second presentation turn moves to Q&A');
  let r = p2;
  while (r.data.state !== 'completed') {
    r = await say(s.id, v, GOOD_ANSWER);
    assert.equal(r.status, 202, JSON.stringify(r.data));
    v = r.data.version;
  }
  const rep = await call(`/api/v1/sessions/${s.id}/report`);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  assert.deepEqual(rep.data.dimensions.map((d) => d.id), ['structure', 'evidence_use', 'execution_plan', 'qa_response']);
});

test('situational: scripted followups then reflection, rubric situational', async () => {
  const { s, start } = await startTyped({ interview_type: 'situational', duration_minutes: 5 });
  assert.equal(s.rubric_version, 'situational-ko-v1');
  assert.ok(s.scenario?.title);
  let v = start.version;
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await say(s.id, v, GOOD_ANSWER);
    assert.equal(r.status, 202, JSON.stringify(r.data));
    v = r.data.version;
    if (r.data.utterance) seen.push(r.data.utterance);
    if (r.data.state === 'completed') break;
  }
  assert.equal(seen.length, 3, 'two scripted followups + one reflection');
  assert.match(seen[2], /다시 한다면/);
  const rep = await call(`/api/v1/sessions/${s.id}/report`);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  assert.deepEqual(rep.data.dimensions.map((d) => d.id), ['role_understanding', 'responsiveness', 'reasoning', 'reflection']);
});

test('panel: roles rotate per question and invalid panel combinations rejected', async () => {
  const bad = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'panel', panel_roles: ['hr'], duration_minutes: 10 } });
  assert.equal(bad.status, 422);
  const dup = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'panel', panel_roles: ['hr', 'hr'], duration_minutes: 10 } });
  assert.equal(dup.status, 422);
  const unknown = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'panel', panel_roles: ['hr', 'ceo'], duration_minutes: 10 } });
  assert.equal(unknown.status, 422);

  const { s, start } = await startTyped({ interview_type: 'panel', panel_roles: ['hr', 'executive'], duration_minutes: 10 });
  assert.deepEqual(s.panel_roles, ['hr', 'executive']);
  let v = start.version;
  const roles = new Set();
  for (let i = 0; i < 10; i += 1) {
    const r = await say(s.id, v, GOOD_ANSWER);
    assert.equal(r.status, 202, JSON.stringify(r.data));
    v = r.data.version;
    if (r.data.current_question?._panel_role) roles.add(r.data.current_question._panel_role);
    if (r.data.speaker_role) roles.add(r.data.speaker_role);
    if (r.data.state === 'completed') break;
  }
  assert.ok(roles.has('hr') && roles.has('executive'), `roles rotated: ${[...roles]}`);
  const rep = await call(`/api/v1/sessions/${s.id}/report`);
  assert.equal(rep.data.status, 'ready', JSON.stringify(rep.data));
  assert.equal(rep.data.rubric_version, 'behavioral-ko-v1');
});

test('blind mode masks school/gender in stored answers and report evidence', async () => {
  const { s, version } = await startTyped({ interview_type: 'general', blind: true, duration_minutes: 5 });
  const text = '저는 서울대학교 출신 여성 지원자입니다. 제가 팀 프로젝트에서 일정을 조정했고 결과적으로 기한 안에 제출했습니다.';
  const r = await say(s.id, version, text);
  assert.equal(r.status, 202);
  const turns = app.store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user');
  const stored = app.store.getRevisions(turns[0].id)[0].normalized_text;
  assert.doesNotMatch(stored, /서울대학교/);
  assert.doesNotMatch(stored, /여성/);
  assert.match(stored, /\[학교\]/);
});

test('typed session rejects unknown interview type axis values', async () => {
  const badDuration = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'general', duration_minutes: 7 } });
  assert.equal(badDuration.status, 422);
  const badInput = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'general', input_mode: 'video' } });
  assert.equal(badInput.status, 422);
  const unknownType = await call('/api/v1/sessions', { method: 'POST', body: { interview_type: 'telepathy', duration_minutes: 10 } });
  assert.equal(unknownType.status, 422, 'unknown type is rejected, not silently mapped');
});
