// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID } from '../crypto.js';
import { getRubric } from '../../domain/rubrics.js';
import { generateTransferQuestion, compareTransfer, questionSimilarity } from '../../domain/transfer.js';

export function createTransferHandlers(d) {
  const { store, err, now } = d;
  function createPractice(owner, body) {
    const eid = body.evaluation_id;
    if (!eid) return err('validation_error', 'evaluation_id가 필요합니다.', 422);
    // 원 평가의 루브릭 차원을 그대로 사용한다(유형별 차원 포함).
    let rubricVersion = 'behavioral-ko-v1';
    let allowed = ['relevance', 'evidence_specificity', 'reasoning', 'reflection'];
    let baselineSessionId = null;
    for (const [sid, r] of store.evaluations) {
      if (r.evaluation_id !== eid || !store.getSession(owner, sid)) continue;
      rubricVersion = r.rubric_version || rubricVersion;
      allowed = getRubric(rubricVersion).dimensions;
      baselineSessionId = sid;
      break;
    }
    const comp = body.competency_id;
    if (!allowed.includes(comp)) return err('validation_error', '역량 값이 올바르지 않습니다.', 422);
    // P4 전이: 기준 세션의 목표 역량 질문·답변을 찾아 새 질문을 만든다.
    let baselineQ = '';
    let baselineAnswer = '';
    let baselineExcerpt = '';
    let baselineTurnId = null;
    let baselineRevision = null;
    if (baselineSessionId) {
      const bs = store.getSession(owner, baselineSessionId);
      const bturns = store.sessionTurns(baselineSessionId).filter((t) => t.speaker_id === 'user' && (t.competency === comp || (t.elicited_dims || []).includes(comp)));
      const pick = bturns[0] || store.sessionTurns(baselineSessionId).filter((t) => t.speaker_id === 'user')[0];
      if (pick) {
        const qq = bs.questions.find((x) => x.id === pick.question_id);
        baselineQ = qq?.text || bs.questions[0]?.text || '';
        baselineTurnId = pick.id;
        const revs = store.getRevisions(pick.id);
        const last = revs[revs.length - 1];
        baselineAnswer = last?.normalized_text || '';
        baselineExcerpt = baselineAnswer.slice(0, 200);
        baselineRevision = last?.revision ?? null;
      }
    }
    const baseline = baselineQ || '최근에 가장 중요한 일을 고른 기준과 다른 일을 미룬 이유를 설명해 주세요.';
    let transfer;
    try {
      transfer = generateTransferQuestion({
        competency: comp, baselineQuestion: baseline, baselineAnswer,
        evidenceRefs: baselineTurnId ? [baselineTurnId] : [],
        sourceStatus: baselineSessionId ? 'user_supplied' : 'practice_assumption',
      });
    } catch (e) {
      return err(e.code === 409 ? 'conflict' : 'validation_error', e.message, e.code === 409 ? 409 : 422);
    }
    if (questionSimilarity(transfer.text, baseline) >= 0.55) {
      return err('conflict', '새 질문이 기존 질문과 너무 유사합니다. 다시 시도하세요.', 409);
    }
    const s = store.createSession(owner, {
      mode: 'structured', interview_type: 'general', duration_minutes: 3, input_mode: 'text', persona: 'standard',
      questions: [{
        id: transfer.id, text: transfer.text, primary: comp, secondary: [],
        followup: '방금 답변에서 본인이 직접 한 행동을 한 가지 더 구체적으로 설명해 주세요.',
        followup_dimensions: [comp],
      }],
      duration_seconds: 90,
      // 재연습도 원 평가와 같은 루브릭으로 채점해 전후 비교가 성립하게 한다.
      policy_snapshot: { rubric: rubricVersion, practice_of: eid, transfer_of: baselineSessionId, baseline_question: baseline },
    });
    store.updateSession(s, { state: 'ready' });
    const transferId = randomUUID();
    store.putTransferJob(transferId, {
      owner_id: owner, evaluation_id: eid, competency: comp, rubric_version: rubricVersion,
      baseline_session_id: baselineSessionId, retry_session_id: s.id,
      baseline: { questionId: baselineTurnId ? undefined : 'baseline', questionText: baseline, excerpt: baselineExcerpt, rubricVersion, turnId: baselineTurnId, revision: baselineRevision, levels: levelsOfSession(owner, baselineSessionId, rubricVersion) },
      transfer_question: transfer, created_at: now(),
    });
    return { status: 201, body: { id: s.id, state: s.state, version: s.version, limits: { duration_seconds: s.duration_seconds }, rubric_version: rubricVersion, competency_id: comp, transfer_id: transferId, transfer_question: transfer, baseline_question: baseline, baseline_excerpt: baselineExcerpt, note: '같은 역량의 새 질문으로 연습합니다. 원래 평가를 수정하지 않습니다.' } };
  }
  // 세션 평가에서 차원별 수준을 꺼내 전이 비교용 baseline으로 쓴다.
  function levelsOfSession(owner, sid, rubricVersion) {
    if (!sid) return {};
    const r = store.evaluations.get(sid);
    if (!r || r.status !== 'ready') return {};
    if ((r.rubric_version || '') !== (rubricVersion || '')) return {};
    const out = {};
    for (const d of r.dimensions || []) {
      if (d.status === 'scored' && Number.isFinite(d.level)) out[d.id] = d.level;
    }
    return out;
  }

  function createTransferComparison(owner, body) {
    const transferId = body.transfer_id;
    const job = transferId ? store.getTransferJob(transferId) : null;
    if (!job || job.owner_id !== owner) return err('not_found', '전이 연습을 찾을 수 없습니다.', 404);
    const retrySessionId = body.retry_session_id || job.retry_session_id;
    const retry = store.evaluations.get(retrySessionId);
    if (!retry || retry.status !== 'ready') return err('conflict', '재연습 세션의 평가가 아직 준비되지 않았습니다.', 409);
    if (!store.getSession(owner, retrySessionId)) return err('not_found', '재연습 세션을 찾을 수 없습니다.', 404);
    const comp = job.competency;
    const dim = (retry.dimensions || []).find((d) => d.id === comp);
    const retryExcerpt = (dim?.evidence?.[0]?.quote || excerptOfSession(owner, retrySessionId, comp) || '').slice(0, 500);
    const retryLevels = {};
    for (const d of retry.dimensions || []) if (d.status === 'scored' && Number.isFinite(d.level)) retryLevels[d.id] = d.level;
    const retryQ = (store.getSession(owner, retrySessionId)?.questions?.[0]?.text) || '';
    if (!job.baseline.excerpt && job.baseline_session_id) {
      job.baseline.excerpt = excerptOfSession(owner, job.baseline_session_id, comp).slice(0, 500);
      job.baseline.levels = levelsOfSession(owner, job.baseline_session_id, job.rubric_version);
    }
    const cmp = compareTransfer({
      rubricVersion: job.rubric_version, competency: comp,
      baseline: { ...job.baseline, rubricVersion: job.rubric_version },
      retry: { questionId: retrySessionId, questionText: retryQ, excerpt: retryExcerpt, rubricVersion: retry.rubric_version, turnId: null, revision: null, levels: retryLevels },
    });
    job.retry_session_id = retrySessionId;
    job.retry = { session_id: retrySessionId, question: retryQ, excerpt: retryExcerpt, levels: retryLevels, rubric_version: retry.rubric_version };
    job.comparison = cmp;
    job.compared_at = now();
    return { status: 201, body: job };
  }

  function excerptOfSession(owner, sid, comp) {
    if (!sid) return '';
    const s = store.getSession(owner, sid);
    if (!s) return '';
    const turns = store.sessionTurns(sid).filter((t) => t.speaker_id === 'user');
    for (const t of turns) {
      const revs = store.getRevisions(t.id);
      const last = revs[revs.length - 1];
      if (!last?.normalized_text) continue;
      if (t.competency === comp || (t.elicited_dims || []).includes(comp)) return last.normalized_text.slice(0, 500);
    }
    const first = turns[0] ? store.getRevisions(turns[0].id) : [];
    return (first[first.length - 1]?.normalized_text || '').slice(0, 500);
  }

  function getTransferJob(owner, id) {
    const job = store.getTransferJob(id);
    if (!job || job.owner_id !== owner) return err('not_found', '전이 비교를 찾을 수 없습니다.', 404);
    return { status: 200, body: job };
  }

  return { createPractice, createTransferComparison, getTransferJob };
}
