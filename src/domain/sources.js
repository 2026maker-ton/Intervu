// 기관 자료 출처 검증: SSRF 방어 + 공식/비공식 구분 + 신선도(staleness) 판정.
// 외부 fetch를 무분별하게 하지 않는다. URL은 기록·검증용 메타데이터이며,
// MVP에서는 서버가 임의 URL을 요청하지 않는다 (명세 §12: 자동 수집 제외).
// 실제 수집이 필요해지면 이 모듈의 fetchSource() 게이트를 통해서만 허용한다.

const ALLOW_PROTOCOLS = new Set(['http:', 'https:']);

// 사설/로컬/메타데이터 차단용 휴리스틱 (DNS 해석 없이 호스트 문자열 기준 1차 방어)
const BLOCKED_HOST_RE = new Set(['localhost', 'metadata.google.internal']);
const PRIVATE_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^169\.254\./, // link-local (클라우드 메타데이터 169.254.169.254 포함)
  /\.local$/i,
  /\.internal$/i,
  /\.invalid$/i,
];

export const SOURCE_KINDS = ['official', 'unofficial', 'user', 'assumption'];
export const OFFICIAL_HINTS = [
  'go.kr', 'ac.kr', 'edu', 'job.alio.go.kr', 'recruit', 'admission', '입학', '요강', '채용공고',
];

export function validateSourceUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, code: 'empty_url' };
  const s = raw.trim().slice(0, 2000);
  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, code: 'malformed_url' };
  }
  if (!ALLOW_PROTOCOLS.has(u.protocol)) return { ok: false, code: 'blocked_protocol', detail: u.protocol };
  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, code: 'empty_host' };
  if (BLOCKED_HOST_RE.has(host)) return { ok: false, code: 'blocked_host' };
  for (const re of PRIVATE_PATTERNS) {
    if (re.test(host)) return { ok: false, code: 'private_host_blocked' };
  }
  // 숫자 IP 직접 접근은 원칙 차단 (내부망 우회 방지)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return { ok: false, code: 'ip_literal_blocked' };
  if (/^\[?[0-9a-f:]+\]?$/i.test(host) && host.includes(':')) return { ok: false, code: 'ip_literal_blocked' };
  // 비표준 포트는 차단
  if (u.port && !['', '80', '443'].includes(u.port)) return { ok: false, code: 'nonstandard_port_blocked' };
  // 사용자정보 포함 URL 차단
  if (u.username || u.password) return { ok: false, code: 'userinfo_blocked' };
  // 리다이렉트 우회는 실제 fetch 시점에 재검증해야 함을 명시
  return { ok: true, normalized: u.toString().slice(0, 2000), host };
}

// 출처 1건을 정규화한다. 서버가 외부에 접속하지 않으므로 status는
// user_supplied(사용자 제공) 또는 curated(검수됨)이며 verified는 검수 운영자만 부여한다.
export function normalizeSource(input = {}, opts = {}) {
  const now = new Date().toISOString();
  const { url, title, publisher, published_at, kind } = input;
  if (url) {
    const v = validateSourceUrl(url);
    if (!v.ok) {
      const e = new Error(`사용할 수 없는 출처 URL입니다: ${v.code}`);
      e.code = 422;
      e.details = v;
      throw e;
    }
  }
  const k = SOURCE_KINDS.includes(kind) ? kind : inferKind(input);
  return {
    id: input.id || null,
    url: url ? String(url).slice(0, 2000) : null,
    host: url ? safeHost(url) : null,
    title: String(title || '').slice(0, 200),
    publisher: String(publisher || '').slice(0, 200),
    published_at: published_at || null,
    retrieved_at: now,
    confirmed_at: opts.confirmedAt || null,
    kind: k,
    // status: 공식 검증 완료가 아니라 출처 성격 표시. verified는 운영자 검수 전용.
    status: k === 'official' ? 'user_supplied_official' : k === 'unofficial' ? 'user_supplied_unofficial' : k === 'user' ? 'user_supplied' : 'practice_assumption',
    quote: String(input.quote || '').slice(0, 500),
  };
}

function safeHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function inferKind(input = {}) {
  const t = `${input.title || ''} ${input.publisher || ''} ${input.url || ''}`;
  if (/공식|요강|채용공고|직무기술서|인재상|비전|교육목표|go\.kr|ac\.kr/i.test(t)) return 'official';
  if (/후기|블로그|커뮤니티|카페|유튜브|합격수기/i.test(t)) return 'unofficial';
  return 'user';
}

// 오래된 자료 판정. 공고/요강은 기준일로부터 365일 초과 시 stale 권장.
// published_at이 없으면 unknown → '확인되지 않음' 배지.
export function freshnessOf(source, nowMs = Date.now()) {
  if (!source?.published_at) return { state: 'unknown', age_days: null, note: '발행일 미확인 — 최신 자료인지 알 수 없습니다.' };
  const t = Date.parse(source.published_at);
  if (Number.isNaN(t)) return { state: 'unknown', age_days: null, note: '발행일 형식 오류 — 최신 자료인지 알 수 없습니다.' };
  const ageDays = Math.floor((nowMs - t) / 86400000);
  if (ageDays < 0) return { state: 'future', age_days: ageDays, note: '발행일이 미래입니다. 입력값을 확인하세요.' };
  if (ageDays > 365) return { state: 'stale', age_days: ageDays, note: `약 ${Math.floor(ageDays / 30)}개월 전 자료 — 최신 요강·공고로 교체하세요.` };
  if (ageDays > 180) return { state: 'aging', age_days: ageDays, note: '6개월 이상 지난 자료 — 변경 여부를 확인하세요.' };
  return { state: 'fresh', age_days: ageDays, note: '최근 자료로 보입니다.' };
}

// 상충 검사: 같은 요구 키에 서로 다른 값이 오면 conflict로 표시하고
// 어느 쪽도 사실로 단정하지 않는다 (일반 템플릿으로 폴백 아님, 해당 항목만 보류).
export function detectConflicts(requirements = []) {
  const byKey = new Map();
  for (const r of requirements) {
    const k = (r.key || r.text || '').trim();
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const conflicts = [];
  for (const [key, list] of byKey) {
    const vals = new Set(list.map((r) => (r.value || r.text || '').trim()));
    if (vals.size > 1) conflicts.push({ key, count: list.length, values: [...vals].slice(0, 5) });
  }
  return conflicts;
}

// 개인정보가 출처 인용문에 섞였는지 검사 (URL 쿼리의 토큰 유출 방지 포함)
export function sourcePrivacyCheck(sources = []) {
  const issues = [];
  for (const s of sources) {
    const t = `${s.url || ''} ${s.quote || ''} ${s.title || ''}`;
    if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(t)) issues.push({ source: s.title || s.url, issue: 'email_in_source' });
    if (/(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(t)) issues.push({ source: s.title || s.url, issue: 'phone_in_source' });
    if (/token=|sessionid=|auth=/i.test(s.url || '')) issues.push({ source: s.title || s.url, issue: 'credential_query_in_url' });
  }
  return issues;
}
