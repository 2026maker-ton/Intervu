// 트렌드 파일 영속(Node 전용). 도메인(trends.js)은 fs를 모르고 여기서 persist/initial을 주입받는다.
import fs from 'node:fs';
import path from 'node:path';
import { createTrendStore } from '../domain/trends.js';

export function createFileTrendStore({ filePath = '', onWarn = null } = {}) {
  let initial = null;
  let loadErr = null;
  if (filePath) {
    try { if (fs.existsSync(filePath)) initial = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { loadErr = e; }
  }
  const persist = !filePath ? null : (snap) => {
    const dir = path.dirname(filePath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  };
  const store = createTrendStore({ filePath, onWarn, persist, initial });
  if (loadErr) onWarn?.('trend load failed (start empty)', { error: String(loadErr?.message || loadErr) });
  return store;
}
