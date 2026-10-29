// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID } from '../crypto.js';


export function createAccountHandlers(d) {
  const { store, err, now, publicSession } = d;
  function createExport(owner, body) {
    if ((body.format || 'json') !== 'json') return err('validation_error', '현재는 JSON 형식만 지원합니다.', 422);
    const sessionId = body.session_id;
    let payload;
    if (sessionId) {
      const s = store.getSession(owner, sessionId);
      if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
      const report = store.evaluations.get(sessionId) || null;
      const turns = store.sessionTurns(sessionId).map((t) => {
        const revs = store.getRevisions(t.id) || [];
        return { turn_id: t.id, ordinal: t.ordinal, question_id: t.question_id, competency: t.competency, revisions: revs.map((r) => ({ revision: r.revision, text: r.normalized_text, origin: r.origin, created_at: r.created_at })) };
      });
      payload = { exported_at: now(), session: publicSession(s), turns, report };
    } else {
      const sessions = store.listSessions(owner).map((s) => publicSession(s));
      payload = { exported_at: now(), sessions, note: '보고서 원문을 포함하지 않는 요약 목록입니다. 세션별 원문은 session_id로 요청하세요.' };
    }
    const id = randomUUID();
    store.putExport(id, { owner_id: owner, session_id: sessionId || null, created_at: now(), expires_at: Date.now() + 10 * 60_000, payload });
    return { status: 202, body: { job_id: id, status: 'ready', expires_in: 600, download_url: `/api/v1/exports/${id}` } };
  }

  function getExport(owner, id) {
    const e = store.getExport(id);
    if (!e || e.owner_id !== owner) return err('not_found', '내보내기 작업을 찾을 수 없습니다.', 404);
    if (e.expires_at < Date.now()) { store.deleteExport(id); return err('not_found', '만료된 내보내기 작업입니다.', 404); }
    return { status: 200, body: e.payload };
  }

  function deleteAccount(owner) {
    store.purgeOwned(owner);
    const job = store.deleteAccount(owner);
    return { status: 202, body: { deletion_id: job.id, state: 'completed', kind: 'account', backup_expiry: job.backup_expiry } };
  }

  return { createExport, getExport, deleteAccount };
}
