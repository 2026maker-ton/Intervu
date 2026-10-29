// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.


export function createAdminHandlers(d) {
  const { trends, err, checkAdmin } = d;
  async function draftTrend(owner, body, req) {
    void owner;
    const gate = await checkAdmin(req);
    if (gate) return gate;
    try {
      const v = trends.draft({ segment: body.segment, yyyyMm: body.yyyy_mm || body.yyyyMm, items: body.items, comment: body.comment, sources: body.sources });
      return { status: 201, body: v };
    } catch (e) {
      return err('validation_error', e.message, e.code || 422);
    }
  }
  // id는 encodeURIComponent(`${segment}|${yyyyMm}`) 형식을 기대한다. 그대로 split('|')한다.
  function parseTrendId(rawId) {
    const decoded = String(rawId || '');
    const bar = decoded.indexOf('|');
    if (bar === -1) throw Object.assign(new Error('트렌드 ID 형식이 올바르지 않습니다 (segment|YYYY-MM).'), { code: 422 });
    return { segment: decoded.slice(0, bar), yyyyMm: decoded.slice(bar + 1) };
  }
  async function publishTrend(owner, id, body, req) {
    void owner;
    const gate = await checkAdmin(req);
    if (gate) return gate;
    try {
      const { segment, yyyyMm } = parseTrendId(id);
      const v = trends.publish({ segment, yyyyMm, version: body.version });
      return { status: 200, body: v };
    } catch (e) {
      return err(e.code === 404 ? 'not_found' : 'validation_error', e.message, e.code || 422);
    }
  }
  async function rollbackTrend(owner, id, body, req) {
    void owner;
    const gate = await checkAdmin(req);
    if (gate) return gate;
    try {
      const { segment, yyyyMm } = parseTrendId(id);
      const v = trends.rollback({ segment, yyyyMm, version: body.version });
      return { status: 200, body: v };
    } catch (e) {
      return err(e.code === 404 ? 'not_found' : 'validation_error', e.message, e.code || 422);
    }
  }

  async function unpublishTrend(owner, id, body, req) {
    void owner; void body;
    const gate = await checkAdmin(req);
    if (gate) return gate;
    try {
      const { segment, yyyyMm } = parseTrendId(id);
      return { status: 200, body: trends.unpublish({ segment, yyyyMm }) };
    } catch (e) {
      return err(e.code === 404 ? 'not_found' : 'validation_error', e.message, e.code || 422);
    }
  }
  async function listTrends(owner, req) {
    void owner;
    const gate = await checkAdmin(req);
    if (gate) return gate;
    return { status: 200, body: { trends: trends.list(), legacy_invalid: trends.legacyInvalidReport() } };
  }

  return { unpublishTrend, listTrends, draftTrend, publishTrend, rollbackTrend, parseTrendId };
}
