// Monthly competency trends: admin-curated, ≤3 per segment/month, versioned, rollback.
// PROJECT.md §2.3: 승인된 것만 사용자 노출, 미승인은 노출 금지. 월간 자동 갱신 없음.
// 영속 저장: TRENDS_FILE(JSON) 기반. 저장 실패 시 메모리로만 동작하고 경고한다.
import fs from 'node:fs';
import path from 'node:path';

export const SEGMENTS = ['company', 'university'];

export function createTrendStore({ filePath = '', onWarn = null } = {}) {
  // key `${segment}:${yyyyMm}` -> { segment, yyyyMm, versions: [ { version, items, comment, sources, status, created_at, published_at } ] }
  const store = new Map();
  const key = (segment, yyyyMm) => `${segment}:${yyyyMm}`;
  let persistedAt = null;
  let persistError = null;

  const warn = (msg, extra = {}) => {
    try { onWarn?.(msg, extra); } catch { /* noop */ }
  };

  function validateItems(items) {
    if (!Array.isArray(items) || !items.length || items.length > 3) {
      throw Object.assign(new Error('트렌드는 월·분야별 최대 3개까지만 승인할 수 있습니다.'), { code: 422 });
    }
    return items.slice(0, 3).map((it, i) => ({
      id: String(it.id || `trend-${i + 1}`),
      competency: String(it.competency || '').slice(0, 60),
      comment: String(it.comment || '').slice(0, 200),
      sources: Array.isArray(it.sources) ? it.sources.slice(0, 5).map((s) => String(s).slice(0, 500)) : [],
    }));
  }

  function snapshot() {
    const rows = {};
    for (const [k, v] of store) rows[k] = v;
    return { version: 1, exported_at: new Date().toISOString(), rows };
  }

  function persist() {
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
      const tmp = `${filePath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot(), null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
      persistedAt = new Date().toISOString();
      persistError = null;
    } catch (e) {
      persistError = String(e?.message || e);
      warn('trend persist failed (memory-only mode)', { error: persistError });
    }
  }

  function load() {
    if (!filePath) return;
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const rows = raw?.rows || {};
      for (const [k, v] of Object.entries(rows)) {
        if (!v || !Array.isArray(v.versions)) continue;
        store.set(k, {
          segment: v.segment, yyyyMm: v.yyyyMm,
          versions: v.versions.map((x) => ({
            version: Number(x.version),
            items: Array.isArray(x.items) ? x.items : [],
            comment: String(x.comment || ''),
            sources: Array.isArray(x.sources) ? x.sources : [],
            status: x.status === 'published' ? 'published' : 'draft',
            created_at: x.created_at || null,
            published_at: x.published_at || null,
            rolled_back_from: x.rolled_back_from ?? null,
          })),
        });
      }
    } catch (e) {
      persistError = String(e?.message || e);
      warn('trend load failed (start empty)', { error: persistError });
    }
  }

  load();

  return {
    // 관리자: 초안 등록 (출처·코멘트 포함). status=draft.
    draft({ segment, yyyyMm, items, comment = '', sources = [] }) {
      if (!SEGMENTS.includes(segment)) throw Object.assign(new Error('segment는 company/university만 가능합니다.'), { code: 422 });
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yyyyMm || '')) throw Object.assign(new Error('연월 형식이 올바르지 않습니다 (YYYY-MM).'), { code: 422 });
      const k = key(segment, yyyyMm);
      const row = store.get(k) || { segment, yyyyMm, versions: [] };
      const version = row.versions.length + 1;
      row.versions.push({
        version, items: validateItems(items), comment: String(comment).slice(0, 500),
        sources: Array.isArray(sources) ? sources.slice(0, 10) : [],
        status: 'draft', created_at: new Date().toISOString(), published_at: null,
      });
      store.set(k, row);
      persist();
      return row.versions[row.versions.length - 1];
    },
    // 관리자: 승인·공개. 이전 공개 버전은 보존된다.
    publish({ segment, yyyyMm, version }) {
      const row = store.get(key(segment, yyyyMm));
      const v = row?.versions.find((x) => x.version === Number(version));
      if (!v) throw Object.assign(new Error('해당 버전을 찾을 수 없습니다.'), { code: 404 });
      v.status = 'published';
      v.published_at = new Date().toISOString();
      persist();
      return v;
    },
    // 관리자: 특정 공개 버전으로 롤백 (새 버전으로 복원 기록).
    rollback({ segment, yyyyMm, version }) {
      const row = store.get(key(segment, yyyyMm));
      const v = row?.versions.find((x) => x.version === Number(version) && x.status === 'published');
      if (!v) throw Object.assign(new Error('롤백할 공개 버전을 찾을 수 없습니다.'), { code: 404 });
      const copy = { ...v, version: row.versions.length + 1, status: 'published', published_at: new Date().toISOString(), rolled_back_from: v.version };
      row.versions.push(copy);
      persist();
      return copy;
    },
    // 사용자 노출: 승인·공개된 최신 버전만. 없으면 null (임의 생성 금지).
    published({ segment, yyyyMm }) {
      const row = store.get(key(segment, yyyyMm));
      const pubs = (row?.versions || []).filter((x) => x.status === 'published');
      return pubs.length ? pubs[pubs.length - 1] : null;
    },
    history({ segment, yyyyMm }) {
      return (store.get(key(segment, yyyyMm))?.versions || []).map((v) => ({ ...v }));
    },
    status() {
      return { file: filePath || null, persisted_at: persistedAt, persist_error: persistError, keys: [...store.keys()] };
    },
  };
}
