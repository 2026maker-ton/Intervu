// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID } from '../crypto.js';


export function createFeedbackHandlers(d) {
  const { config, store, err, now } = d;
  function addRevision(owner, turnId, body) {
    const turn = store.getTurn(turnId);
    if (!turn) return err('not_found', '턴을 찾을 수 없습니다.', 404);
    const s = store.getSession(owner, turn.session_id);
    if (!s) return err('not_found', '턴을 찾을 수 없습니다.', 404);
    const reason = body.reason;
    if (!['stt_correction', 'content_rewrite'].includes(reason)) return err('validation_error', 'reason 값이 올바르지 않습니다.', 422);
    const text = String(body.text || '').trim();
    if (!text || [...text].length > config.limits.maxAnswerChars) return err('validation_error', '텍스트가 올바르지 않습니다.', 422);
    if (reason === 'content_rewrite') {
      const id = randomUUID();
      store.attempts.set(id, { id, owner_id: owner, origin_evaluation_id: store.evaluations.get(s.id)?.evaluation_id || null, turn_id: turnId, text, created_at: now() });
      return { status: 201, body: { practice_attempt_id: id, note: '내용 개선 답변은 새 연습으로 기록되며 원래 평가를 덮어쓰지 않습니다.' } };
    }
    const rev = store.addRevision(turnId, text, 'stt_correction', []);
    store.pushEvent(s.id, 'transcript.final', { turn_id: turnId, revision: rev.revision, corrected: true });
    return { status: 201, body: { turn_id: turnId, revision: rev.revision, reason, note: '전사 교정은 새 revision으로 기록됩니다. 기존 보고서는 유지됩니다.' } };
  }

  function createAppeal(owner, evaluationId, body) {
    let found = null;
    for (const [sid, r] of store.evaluations) {
      const s = store.getSession(owner, sid);
      if (s && r.evaluation_id === evaluationId) { found = { sid, r }; break; }
    }
    if (!found) return err('not_found', '평가를 찾을 수 없습니다.', 404);
    if (!['stt', 'fact', 'evidence', 'inappropriate'].includes(body.category)) return err('validation_error', 'category 값이 올바르지 않습니다.', 422);
    const comment = String(body.comment || '').slice(0, 500);
    if (body.evidence_id) {
      const hit = (found.r.dimensions || []).some((d) => (d.evidence || []).some((e) => e.turn_id === body.evidence_id));
      if (!hit) return err('validation_error', 'evidence_id가 보고서에 없습니다.', 422);
    }
    const id = randomUUID();
    store.appeals.set(id, { id, owner_id: owner, evaluation_id: evaluationId, category: body.category, evidence_id: body.evidence_id || null, comment, status: 'received', resolution_code: null, created_at: now(), resolved_at: null });
    return { status: 201, body: { appeal_id: id, state: 'received', sla: '처리 목표 3영업일(운영 목표)' } };
  }

  // 사양 §10: 이의 제기 조회(처리 단계 received→reviewing→resolved/rejected)
  function getAppeal(owner, appealId) {
    const a = store.appeals.get(appealId);
    if (!a || a.owner_id !== owner) return err('not_found', '이의 제기를 찾을 수 없습니다.', 404);
    // MVP: 접수 후 자동으로 검토중→완료 안내로 전이(수동 검토자를 흉내내지 않음)
    if (a.status === 'received' && Date.now() - Date.parse(a.created_at) > 5_000) {
      a.status = 'reviewing';
    }
    return { status: 200, body: a };
  }

  return { addRevision, createAppeal, getAppeal };
}
