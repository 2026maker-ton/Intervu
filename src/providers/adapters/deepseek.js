// DeepSeek 꼬리질문 어댑터(WP-B2). fetch만 사용, 키·BASE_URL·MODEL은 호출자(환경변수)가 주입한다. 하드코딩 없음.
// [UNVERIFIED] 요청/응답 형태는 OpenAI 호환 chat-completions(POST {baseUrl}/chat/completions, Bearer 키,
//   choices[0].message.content, usage.prompt_tokens/completion_tokens)로 가정했다. 공식 문서는 확인하지 않았으므로
//   실호출 전 개발자가 문서와 대조해야 한다(이 가정은 이 파일 안에만 있다).
import { estimateTokens } from '../../domain/ledger.js';
import { buildFollowupMessages } from '../prompts/followup.js';

export function createDeepseekAdapter({ apiKey, baseUrl, model, timeoutMs = 12000, fetchFn = (...a) => globalThis.fetch(...a) }) {
  if (!apiKey || !baseUrl || !model) throw new Error('deepseek not configured');
  const base = String(baseUrl).replace(/\/+$/, '');
  const fail = (msg, props) => Object.assign(new Error(msg), props); // 메시지에 응답 본문·키를 넣지 않는다.
  return {
    name: 'deepseek',
    model,
    async next(input) {
      const { system, user } = buildFollowupMessages(input);
      const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 500, temperature: 0.2, response_format: { type: 'json_object' } };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const t0 = Date.now();
      try {
        const res = await fetchFn(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: controller.signal });
        if (res.status === 429) {
          const ra = res.headers.get('retry-after');
          throw fail('deepseek rate limited', { code: 429, retryable: true, retryAfter: ra !== null && ra !== '' && Number.isFinite(Number(ra)) ? Number(ra) : 5 });
        }
        if (!res.ok) throw fail(`deepseek error ${res.status}`, { code: res.status >= 500 ? 503 : 502, retryable: res.status >= 500 });
        const data = await res.json().catch(() => ({}));
        let utterance = null;
        try { utterance = JSON.parse(data?.choices?.[0]?.message?.content).utterance; } catch { /* 아래에서 처리 */ }
        if (typeof utterance !== 'string' || !utterance.trim()) throw fail('deepseek bad output', { code: 502, invalid: true });
        const u = data?.usage || {};
        // 스키마 밖 필드는 버리고 utterance만 전달한다.
        return { provider: 'deepseek', model, usage: { input: u.prompt_tokens || estimateTokens(system + user), output: u.completion_tokens || estimateTokens(utterance) }, latency_ms: Date.now() - t0, utterance: utterance.slice(0, 1000) };
      } catch (e) {
        if (e?.name === 'AbortError') throw fail('deepseek timeout', { code: 504, retryable: true, timeout: true });
        if (e?.code) throw e;
        throw fail('deepseek network error', { code: 503, retryable: true }); // 원본 오류 문자열(URL·헤더 포함 가능)은 버린다.
      } finally { clearTimeout(timer); }
    },
  };
}
