// 파일 영속 Store(WP-A2). memory 구현을 감싸 상태를 data/store/state.json 한 파일로 원자적(tmp+rename) 저장한다.
// ponytail: 단일 프로세스 가정 — 여러 프로세스가 같은 DATA_DIR을 쓰면 마지막 쓰기가 이긴다. 전체 스냅샷 저장이라
// 대용량이면 SQLite/DO(WP-A3)로 교체. 업로드 원본 바이너리·내보내기·티켓은 저장하지 않는다(메모리 전용).
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './memory.js';

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export function createFileStore({ dir = 'data/store', ttlDays = 30, debounceMs = 200, purgeEveryMs = 3_600_000, warn = (m) => console.warn(m) } = {}) {
  const file = path.join(dir, 'state.json');
  const store = createStore({ ttlDays });
  const maps = store._maps;
  const ledger = store.ledgerState();
  ledger.month = monthKey();
  ledger.providers = {}; // 공급자별 합계(원장이 채우면 함께 저장·월 리셋)

  let dirty = false; let timer = null;

  function load() {
    if (!fs.existsSync(file)) return;
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [name, m] of Object.entries(maps)) for (const [k, v] of d.maps?.[name] || []) m.set(k, v);
      const l = d.ledger || {};
      Object.assign(ledger, { month: l.month || ledger.month, monthlySpent: l.monthlySpent || 0, monthlyReserved: l.monthlyReserved || 0, providers: l.providers || {} });
      ledger.sessions = new Map(l.sessions || []);
    } catch (e) {
      const bak = `${file}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(file, bak); } catch { /* ignore */ }
      for (const m of Object.values(maps)) m.clear();
      warn(`WARNING: 저장 파일을 읽지 못해 빈 상태로 시작합니다(${e.message}). 백업: ${bak}`);
    }
  }

  // 월 경계: YYYY-MM이 바뀌면 같은 객체를 제자리에서 초기화(createLedger가 참조를 쥐고 있음)
  function rolloverLedger() {
    const m = monthKey();
    if (ledger.month === m) return;
    ledger.month = m; ledger.monthlySpent = 0; ledger.monthlyReserved = 0; ledger.providers = {};
    ledger.sessions.clear();
    dirty = true;
  }

  function flush() {
    clearTimeout(timer); timer = null;
    if (!dirty) return;
    dirty = false;
    fs.mkdirSync(dir, { recursive: true });
    const snap = {
      v: 1, saved_at: new Date().toISOString(),
      maps: Object.fromEntries(Object.entries(maps).map(([n, m]) => [n, [...m]])),
      ledger: { month: ledger.month, monthlySpent: ledger.monthlySpent, monthlyReserved: ledger.monthlyReserved, providers: ledger.providers, sessions: [...ledger.sessions] },
    };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap));
    fs.renameSync(tmp, file);
  }
  function markDirty() { dirty = true; if (!timer) { timer = setTimeout(flush, debounceMs); timer.unref?.(); } }
  function purge() { rolloverLedger(); if (store.purgeExpired()) dirty = true; }

  load(); purge(); dirty = true; flush();
  const hourly = setInterval(() => { purge(); flush(); }, purgeEveryMs); hourly.unref?.();
  process.on('exit', () => { try { flush(); } catch { /* ignore */ } });

  // 변경 메서드를 감싸 dirty 표시. 삭제는 즉시 디스크에 반영한다(본문 잔존 방지).
  const wrapped = { ...store };
  for (const m of ['createProfile', 'setExtracted', 'approveVersion', 'addSource', 'setInstitution', 'recordProfileCall', 'createSession', 'updateSession', 'createTurn', 'addRevision', 'pushEvent', 'putTransferJob', 'putIdem']) {
    wrapped[m] = (...a) => { const r = store[m](...a); markDirty(); return r; };
  }
  for (const m of ['deleteAccount', 'purgeOwned']) {
    wrapped[m] = (...a) => { const r = store[m](...a); dirty = true; flush(); return r; };
  }
  wrapped.ledgerState = () => { rolloverLedger(); return ledger; };
  // 핸들러가 객체·컬렉션을 직접 바꾸므로 요청 처리 후 호출한다. flushNow=true면 즉시 기록(삭제 요청).
  wrapped.afterRequest = (flushNow) => { rolloverLedger(); dirty = true; if (flushNow) flush(); else markDirty(); };
  wrapped.flush = () => { dirty = true; flush(); };
  wrapped.purge = () => { purge(); flush(); };
  wrapped.close = () => { clearInterval(hourly); dirty = true; flush(); };
  wrapped.file = file;
  return wrapped;
}
