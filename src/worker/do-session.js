// Durable Object: 소유자 1명당 인스턴스 1개(라우팅은 index.js의 owner→idFromName). 같은 객체 안에서 요청을 직렬 처리하고
// 메모리 Store를 요청마다 DO 저장소에 스냅샷한다(Store 계약은 동기식이라 메모리가 작업본, 저장소는 영속본).
// 모든 Workers/DO API 세부(ctx.storage.get/put/delete 시그니처, blockConcurrencyWhile, 값 크기 한도)는 [UNVERIFIED — docs not checked].
// ponytail: 전체 스냅샷 저장 → 데이터가 커지면 행 단위 SQLite(ctx.storage.sql)로 교체.
import { createCore } from '../app/core.js';
import { createStore } from '../store/index.js';
import { createTrendStore } from '../domain/trends.js';
import { toConfigEnv } from './env.js';

const CHUNK = 30_000; // 값당 크기 한도 [UNVERIFIED]를 피하려고 JSON을 문자열 조각으로 나눠 저장(한글 3바이트 기준 ≤90KB)

export class SessionDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.chain = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      const store = createStore();
      const maps = store._maps;
      const ledger = store.ledgerState();
      const n = await ctx.storage.get('snap_n');
      let snap = null;
      if (n) {
        const keys = Array.from({ length: n }, (_, i) => `snap_${i}`);
        const got = await ctx.storage.get(keys); // Map<string, string> [UNVERIFIED]
        try { snap = JSON.parse(keys.map((k) => got.get(k)).join('')); } catch { snap = null; }
      }
      for (const [name, m] of Object.entries(maps)) for (const [k, v] of snap?.maps?.[name] || []) m.set(k, v);
      const l = snap?.ledger || {};
      Object.assign(ledger, { monthlySpent: l.monthlySpent || 0, monthlyReserved: l.monthlyReserved || 0 });
      ledger.sessions = new Map(l.sessions || []);
      this.store = store;
      // 트렌드 변경 스냅샷은 persist 콜백이 받아 두고, 요청 직후 save()가 함께 저장한다.
      this.trendSnap = snap?.trends || null;
      const trends = createTrendStore({ initial: this.trendSnap, label: 'durable-object', persist: (s) => { this.trendSnap = s; } });
      this.core = createCore({ env: toConfigEnv(env), store, trends });
    });
  }

  fetch(request) {
    const run = this.chain.then(async () => {
      try { return await this.core.fetch(request, this.env, {}); } finally { await this.save(); }
    });
    this.chain = run.catch(() => {}); // 앞 요청이 실패해도 다음 요청은 진행
    return run;
  }

  async save() {
    const l = this.store.ledgerState();
    const snap = {
      v: 1,
      maps: Object.fromEntries(Object.entries(this.store._maps).map(([n, m]) => [n, [...m]])),
      ledger: { monthlySpent: l.monthlySpent, monthlyReserved: l.monthlyReserved, sessions: [...l.sessions] },
      trends: this.trendSnap,
    };
    const json = JSON.stringify(snap);
    const parts = {};
    let n = 0;
    for (let i = 0; i < json.length; i += CHUNK) parts[`snap_${n++}`] = json.slice(i, i + CHUNK);
    const prev = (await this.ctx.storage.get('snap_n')) || 0;
    await this.ctx.storage.put({ ...parts, snap_n: n });
    if (prev > n) await this.ctx.storage.delete(Array.from({ length: prev - n }, (_, i) => `snap_${n + i}`));
  }
}
