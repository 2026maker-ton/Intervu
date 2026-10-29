// Monthly competency trends: admin-curated, ≤3 per segment/month, versioned, rollback.
// PROJECT.md §2.3: 승인된 것만 사용자 노출, 미승인은 노출 금지. 월간 자동 갱신 없음.
// 영속 저장: TRENDS_FILE(JSON) 기반. 저장 실패 시 메모리로만 동작하고 경고한다.
// node:*를 쓰지 않는다(Workers 이식). 파일 영속은 src/node/trends-file.js가 persist/initial로 주입한다.

export const SEGMENTS = ['company', 'university'];

// persist(snapshot): 변경 시 호출(어댑터 책임, 던지면 메모리 전용으로 계속). initial: 시작 시 복원할 스냅샷. label: status에 표시할 저장 위치.
export function createTrendStore({ filePath = '', onWarn = null, persist: persistFn = null, initial = null, label = filePath } = {}) {
  // key `${segment}:${yyyyMm}` -> { segment, yyyyMm, versions: [ { version, items, comment, sources, status, created_at, published_at } ] }
  const store = new Map();
  const key = (segment, yyyyMm) => `${segment}:${yyyyMm}`;
  let persistedAt = null;
  let persistError = null;

  const warn = (msg, extra = {}) => {
    try { onWarn?.(msg, extra); } catch { /* noop */ }
  };

  const bad = (m) => Object.assign(new Error(m), { code: 422 });
  // 항목마다 출처>=1, 코멘트, 역량 필수(BUG-5). 항목에 출처가 없으면 버전 공통 출처를 물려받는다.
  function validateItems(items, fallbackSources = []) {
    if (!Array.isArray(items) || !items.length || items.length > 3) throw bad('트렌드는 월·분야별 1~3개까지만 승인할 수 있습니다.');
    const strs = (a, n) => (Array.isArray(a) ? a.map((x) => String(x).trim().slice(0, 500)).filter(Boolean).slice(0, n) : []);
    return items.map((it, i) => {
      const competency = String(it?.competency || '').trim().slice(0, 60);
      const comment = String(it?.comment || '').trim().slice(0, 200);
      const own = strs(it?.sources, 5);
      const sources = own.length ? own : strs(fallbackSources, 5);
      if (!competency) throw bad(`${i + 1}번째 항목의 역량명이 비어 있습니다.`);
      if (!comment) throw bad(`${i + 1}번째 항목에 코멘트가 필요합니다.`);
      if (!sources.length) throw bad(`${i + 1}번째 항목에 출처가 1개 이상 필요합니다.`);
      return { id: String(it.id || `trend-${i + 1}`), competency, comment, sources };
    });
  }
  // 영속 데이터(레거시 포함)가 규칙을 만족하는지. 공개 노출 직전에도 검사한다.
  function isValidVersion(v) {
    try { validateItems(v.items); return true; } catch { return false; }
  }

  function snapshot() {
    const rows = {};
    for (const [k, v] of store) rows[k] = v;
    return { version: 1, exported_at: new Date().toISOString(), rows };
  }

  function persist() {
    if (!persistFn) return;
    try {
      persistFn(snapshot());
      persistedAt = new Date().toISOString();
      persistError = null;
    } catch (e) {
      persistError = String(e?.message || e);
      warn('trend persist failed (memory-only mode)', { error: persistError });
    }
  }

  function load() {
    if (!initial) return;
    try {
      const raw = initial;
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
            status: ['published', 'unpublished'].includes(x.status) ? x.status : 'draft',
            created_at: x.created_at || null,
            published_at: x.published_at || null,
            rolled_back_from: x.rolled_back_from ?? null,
            approved_by: x.approved_by ?? null,
            unpublished_at: x.unpublished_at ?? null,
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
        version, items: validateItems(items, sources), comment: String(comment).slice(0, 500),
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
      if (v.status !== 'draft') throw bad('초안 상태의 버전만 공개할 수 있습니다.');
      if (!isValidVersion(v)) throw bad('출처·코멘트 검증을 통과하지 못한 버전은 공개할 수 없습니다.');
      v.status = 'published';
      v.approved_by = 'admin';
      v.published_at = new Date().toISOString();
      persist();
      return v;
    },
    // 관리자: 특정 공개 버전으로 롤백 (새 버전으로 복원 기록).
    rollback({ segment, yyyyMm, version }) {
      const row = store.get(key(segment, yyyyMm));
      const v = row?.versions.find((x) => x.version === Number(version) && ['published', 'unpublished'].includes(x.status));
      if (!v) throw Object.assign(new Error('롤백할 공개 버전을 찾을 수 없습니다.'), { code: 404 });
      if (!isValidVersion(v)) throw bad('검증을 통과하지 못한 버전으로는 롤백할 수 없습니다.');
      const copy = { ...v, version: row.versions.length + 1, status: 'published', published_at: new Date().toISOString(), rolled_back_from: v.version, approved_by: 'admin', unpublished_at: null };
      row.versions.push(copy);
      persist();
      return copy;
    },
    // 사용자 노출: 승인·공개된 최신 버전만. 없으면 null (임의 생성 금지).
    published({ segment, yyyyMm }) {
      const row = store.get(key(segment, yyyyMm));
      const pubs = (row?.versions || []).filter((x) => x.status === 'published' && isValidVersion(x));
      return pubs.length ? pubs[pubs.length - 1] : null;
    },
    // 관리자: 공개 중단. 공개 버전을 unpublished로 바꾸되 이력은 보존한다.
    unpublish({ segment, yyyyMm }) {
      const row = store.get(key(segment, yyyyMm));
      const pubs = (row?.versions || []).filter((x) => x.status === 'published');
      if (!pubs.length) throw Object.assign(new Error('공개 중인 버전이 없습니다.'), { code: 404 });
      const at = new Date().toISOString();
      for (const v of pubs) { v.status = 'unpublished'; v.unpublished_at = at; }
      persist();
      return { segment, yyyyMm, unpublished_versions: pubs.map((v) => v.version) };
    },
    // 관리자: 월·분야 목록과 현재 공개 버전.
    list() {
      return [...store.values()].map((r) => ({
        segment: r.segment, yyyyMm: r.yyyyMm, versions: r.versions.length,
        published_version: this.published({ segment: r.segment, yyyyMm: r.yyyyMm })?.version ?? null,
      })).sort((a, b) => (a.yyyyMm + a.segment).localeCompare(b.yyyyMm + b.segment));
    },
    // 일회성 정리 보고: 규칙 위반인데 공개 상태인 레거시 버전(노출은 이미 차단). 삭제하지 않고 보고만 한다.
    legacyInvalidReport() {
      const out = [];
      for (const r of store.values()) for (const v of r.versions) if (v.status === 'published' && !isValidVersion(v)) out.push({ segment: r.segment, yyyyMm: r.yyyyMm, version: v.version });
      return out;
    },
    history({ segment, yyyyMm }) {
      return (store.get(key(segment, yyyyMm))?.versions || []).map((v) => ({ ...v }));
    },
    status() {
      return { file: label || null, persisted_at: persistedAt, persist_error: persistError, keys: [...store.keys()] };
    },
  };
}
