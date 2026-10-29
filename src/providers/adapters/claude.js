// Claude 어댑터(WP-B3, claims.extract 전용). fetch만 사용한다. 모델 ID·URL·키는 모두 설정에서 받는다(하드코딩 없음).
// 요청/응답 형태(경로 /messages, 헤더 x-api-key, content[].text, usage.input_tokens)는 어댑터 내부 가정이며 [UNVERIFIED] — 실호출 전 공식 문서로 확인한다.
import { buildClaimsPrompt } from '../prompts/claims.js';

export function createClaudeAdapter({ apiKey, baseUrl, model, timeoutMs = 20000, apiVersion = '', fetchFn = (...a) => globalThis.fetch(...a) }) {
  async function post(body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey }; // [UNVERIFIED]
    if (apiVersion) headers['anthropic-version'] = apiVersion; // [UNVERIFIED] 값은 CLAUDE_API_VERSION으로만 지정
    let res;
    try {
      res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      const timeout = e?.name === 'AbortError';
      throw Object.assign(new Error(timeout ? 'claude timeout' : 'claude network error'), { code: timeout ? 504 : 502, timeout, retryable: true });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const ra = Number(res.headers?.get?.('retry-after'));
      throw Object.assign(new Error(`claude http ${res.status}`), { code: res.status, retryable: res.status === 429 || res.status >= 500, retryAfter: Number.isFinite(ra) ? ra : undefined });
    }
    return res.json().catch(() => { throw Object.assign(new Error('claude bad body'), { code: 502, invalid: true }); });
  }

  return {
    model,
    // maskedApplication: 서버가 마스킹한 지원서 텍스트만 들어온다. 반환: {quotes:[string], model, usage}
    async extractApplicantClaims({ maskedApplication }) {
      const { system, user } = buildClaimsPrompt(maskedApplication);
      const j = await post({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] });
      const text = Array.isArray(j?.content) ? j.content.map((c) => c?.text || '').join('') : '';
      let parsed;
      try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw Object.assign(new Error('claude bad json'), { code: 502, invalid: true }); }
      if (!Array.isArray(parsed?.claims)) throw Object.assign(new Error('claude bad schema'), { code: 502, invalid: true });
      const quotes = parsed.claims.map((c) => (typeof c === 'string' ? c : c?.quote)).filter((q) => typeof q === 'string');
      return { quotes, model, usage: { input: j?.usage?.input_tokens || 0, output: j?.usage?.output_tokens || 0 } };
    },
  };
}
