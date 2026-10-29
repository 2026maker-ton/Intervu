// WP-C2 공식 자료 수집기. Web 표준 fetch만 쓴다(Node 전용 API 없음). 기본값은 "수집 비활성"(허용 도메인 목록 비어 있음).
// 가져온 페이지 텍스트는 비신뢰 데이터다: 지시로 쓰지 않고, LLM에도 넣지 않는다(키워드 발췌만, 규칙 기반).
// 한계(ponytail): fetch는 연결 시 DNS를 다시 해석하므로 해석→연결 사이 rebinding 틈은 남는다.
//   완화: 허용 도메인 목록(운영자 통제) + 매 홉 재해석·재검사. 완전 차단은 IP 고정 연결 가능한 런타임에서.
import { validateSourceUrl, freshnessOf, detectConflicts } from './sources.js';
import { COMPETENCY_KEYWORDS } from './institution.js';

export const FETCH_UA = 'IntervuBot';
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = ['text/html', 'text/plain', 'application/xhtml+xml'];
const TEXT_CAP_CP = 100000;

export const parseAllowList = (raw) => String(raw || '').split(',').map((s) => s.trim().toLowerCase().replace(/^\*?\./, '')).filter(Boolean);
export const hostAllowed = (host, allow) => allow.some((d) => host === d || host.endsWith(`.${d}`));

// ---- IP 검사 ----
export function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
}
function parseIPv6(ip) {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const g = [...head, ...Array(fill).fill('0'), ...tail].map((x) => parseInt(x || '0', 16));
  return g.length === 8 && g.every((n) => n >= 0 && n <= 0xffff) ? g : null;
}
export function isPrivateIPv6(ip) {
  const g = parseIPv6(ip);
  if (!g) return true; // 해석 불가 = 차단
  if (g.every((n) => n === 0) || (g.slice(0, 7).every((n) => n === 0) && g[7] === 1)) return true; // :: , ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIPv4(embedded); // ::ffff:a.b.c.d, ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIPv4(embedded); // NAT64
  if (g[0] === 0x2002) return isPrivateIPv4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
  return false;
}
export const isPrivateIp = (ip) => (String(ip).includes(':') ? isPrivateIPv6(ip) : /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? isPrivateIPv4(ip) : true);

class Fail extends Error { constructor(reason) { super(reason); this.reason = reason; } }

// URL 1건 사전검사: 문자열 규칙 → 허용 도메인 → DNS 해석 후 모든 주소가 공인 IP여야 함
async function checkUrl(raw, { allow, resolveDns }) {
  const v = validateSourceUrl(raw);
  if (!v.ok) throw new Fail(v.code);
  const u = new URL(v.normalized);
  if (!hostAllowed(u.hostname, allow)) throw new Fail('host_not_allowed');
  if (typeof resolveDns !== 'function') throw new Fail('dns_unavailable'); // 해석 불가 = fail closed
  let addrs;
  try { addrs = await resolveDns(u.hostname); } catch { throw new Fail('dns_failed'); }
  addrs = (addrs || []).map((a) => (typeof a === 'string' ? a : a?.address)).filter(Boolean);
  if (!addrs.length) throw new Fail('dns_failed');
  if (addrs.some(isPrivateIp)) throw new Fail('private_ip_blocked');
  return u;
}

const withTimeout = (p, ms, ctl) => new Promise((res, rej) => {
  const t = setTimeout(() => { ctl.abort(); rej(new Fail('timeout')); }, ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e instanceof Fail ? e : new Fail(ctl.signal.aborted ? 'timeout' : 'fetch_error')); });
});

async function readBody(res, maxBytes) {
  const cl = Number(res.headers.get('content-length'));
  if (cl > maxBytes) throw new Fail('too_large');
  const chunks = []; let n = 0;
  if (res.body?.getReader) {
    const rd = res.body.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      n += value.byteLength;
      if (n > maxBytes) { rd.cancel().catch(() => {}); throw new Fail('too_large'); }
      chunks.push(value);
    }
  } else {
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.byteLength > maxBytes) throw new Fail('too_large');
    chunks.push(b); n = b.byteLength;
  }
  const all = new Uint8Array(n); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return all;
}

// 리디렉션을 직접 따라가며 매 홉 재검증. 쿠키·자격증명 없음.
async function safeGet(url, opts) {
  const { fetchFn, maxBytes, timeoutMs, types } = opts;
  let cur = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await checkUrl(cur, opts);
    const ctl = new AbortController();
    const res = await withTimeout(Promise.resolve().then(() => fetchFn(u.toString(), { method: 'GET', redirect: 'manual', credentials: 'omit', signal: ctl.signal, headers: { 'user-agent': FETCH_UA, accept: types.join(',') } })), timeoutMs, ctl);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      res.body?.cancel?.().catch?.(() => {});
      if (!loc) throw new Fail('bad_redirect');
      try { cur = new URL(loc, u).toString(); } catch { throw new Fail('bad_redirect'); }
      continue;
    }
    const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (res.ok && !types.includes(ct)) { res.body?.cancel?.().catch?.(() => {}); throw new Fail('content_type_blocked'); }
    const body = res.ok ? await withTimeout(readBody(res, maxBytes), timeoutMs, ctl) : null;
    return { status: res.status, ok: res.ok, ct, body, finalUrl: u.toString() };
  }
  throw new Fail('too_many_redirects');
}

// ---- robots.txt (필요 최소 구현: UA 그룹, Allow/Disallow, * 와 $) ----
export function robotsAllows(txt, path, ua = FETCH_UA) {
  const groups = []; let cur = null; let lastWasUa = false;
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(); const v = line.slice(i + 1).trim();
    if (k === 'user-agent') { if (!lastWasUa) { cur = { uas: [], rules: [] }; groups.push(cur); } cur.uas.push(v.toLowerCase()); lastWasUa = true; continue; }
    lastWasUa = false;
    if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', pat: v });
  }
  const me = ua.toLowerCase();
  const g = groups.filter((x) => x.uas.some((a) => a !== '*' && me.includes(a)));
  const use = g.length ? g : groups.filter((x) => x.uas.includes('*'));
  let best = null;
  for (const grp of use) for (const r of grp.rules) {
    if (!r.pat) continue;
    const re = new RegExp('^' + r.pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.pat.length > best.pat.length || (r.pat.length === best.pat.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// ---- 텍스트 추출 ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function extractText(body, contentType = 'text/html') {
  let s = new TextDecoder('utf-8').decode(body);
  if (contentType !== 'text/plain') {
    s = s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<\/?(p|div|br|li|ul|ol|tr|h[1-6]|section|article|table|header|footer)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ');
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ' '; } }
      return ENT[e.toLowerCase()] ?? m;
    });
  }
  s = s.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/[ \t ]+/g, ' ').replace(/ *\n[ \n]*/g, '\n').trim();
  return Array.from(s).slice(0, TEXT_CAP_CP).join('');
}

const cpLen = (s) => Array.from(s).length;
// 핵심 가치 키워드별 발췌. start_cp/end_cp는 저장된 text의 코드포인트 오프셋(text 슬라이스 == 발췌).
export function pickExcerpts(text, { max = 12, radius = 60 } = {}) {
  const cps = Array.from(text); const out = [];
  for (const { kw, label, competency } of COMPETENCY_KEYWORDS) {
    const i = text.indexOf(kw);
    if (i < 0) continue;
    const ks = cpLen(text.slice(0, i));
    let s = Math.max(0, ks - radius); let e = Math.min(cps.length, ks + cpLen(kw) + radius);
    for (let j = ks; j > s; j--) if (cps[j - 1] === '\n') { s = j; break; }
    for (let j = ks; j < e; j++) if (cps[j] === '\n') { e = j; break; }
    out.push({ keyword: kw, label, competency, start_cp: s, end_cp: e, text: cps.slice(s, e).join('') });
    if (out.length >= max) break;
  }
  return out;
}

// "항목: 값" 줄을 상충 검사용 키-값으로 추출
export function extractKeyValues(text) {
  const kv = [];
  for (const line of text.split('\n')) {
    const m = /^([^:：\s][^:：]{0,24})\s*[:：]\s*(\S.{0,100})$/.exec(line.trim());
    if (m) kv.push({ key: m[1].trim(), value: m[2].trim() });
    if (kv.length >= 50) break;
  }
  return kv;
}

// 수집 1건. 항상 {status, reason, ...} 를 반환(예외 없음).
export async function fetchOfficialSource(source, o = {}) {
  const { allow = [], fetchFn = globalThis.fetch, resolveDns, maxBytes = 1048576, timeoutMs = 8000, now = Date.now(), otherKv = [] } = o;
  const base = { url: source.url, host: source.host || null, fetched_at: new Date(now).toISOString() };
  if (!allow.length) return { ...base, status: 'unavailable', reason: 'fetch_disabled' };
  const opts = { allow, fetchFn, resolveDns, maxBytes, timeoutMs, types: ALLOWED_TYPES };
  try {
    const u0 = await checkUrl(source.url, opts);
    // robots: 같은 검사를 거친다. 4xx=제한 없음, 5xx·차단·오류=보수적으로 수집 안 함.
    const rr = await safeGet(`${u0.origin}/robots.txt`, { ...opts, maxBytes: 262144, types: ['text/plain', 'text/html'] });
    if (rr.status >= 500) throw new Fail('robots_unavailable');
    if (rr.ok && !robotsAllows(new TextDecoder().decode(rr.body), u0.pathname + u0.search)) return { ...base, status: 'unavailable', reason: 'robots_disallowed' };
    const r = await safeGet(source.url, opts);
    if (!r.ok) throw new Fail(`http_${r.status}`);
    const text = extractText(r.body, r.ct);
    const fin = { ...base, final_url: r.finalUrl, content_type: r.ct, bytes: r.body.byteLength, text, text_cp: cpLen(text) };
    const excerpts = pickExcerpts(text);
    const kv = extractKeyValues(text);
    const conflicts = detectConflicts([...kv, ...otherKv]).map((c) => c.key);
    if (!excerpts.length) return { ...fin, status: 'unverified', reason: 'no_excerpt', excerpts: [], kv };
    if (conflicts.length) return { ...fin, status: 'conflict', reason: 'conflicting_values', conflict_keys: conflicts, excerpts, kv };
    if (freshnessOf(source, now).state === 'stale') return { ...fin, status: 'stale', reason: 'older_than_365d', excerpts, kv };
    return { ...fin, status: 'official_verified', reason: null, excerpts, kv };
  } catch (e) {
    return { ...base, status: 'unavailable', reason: e instanceof Fail ? e.reason : 'fetch_error' };
  }
}
