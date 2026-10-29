// ElevenLabs TTS 어댑터(WP-B6). fetch만 사용, 키·BASE_URL·MODEL·VOICE_ID는 호출자(환경변수)가 주입한다. 하드코딩 없음.
// [UNVERIFIED] 요청/응답 형태는 POST {baseUrl}/text-to-speech/{voiceId}, 헤더 xi-api-key, 본문 {text, model_id}, 응답=오디오 바이트
//   (audio/* content-type)로 가정했다. 공식 문서는 확인하지 않았으므로 실호출 전 개발자가 대조해야 한다(이 가정은 이 파일 안에만 있다).
export function createElevenlabsAdapter({ apiKey, baseUrl, model, voiceId, timeoutMs = 15000, maxAudioBytes = 2 * 1024 * 1024, fetchFn = (...a) => globalThis.fetch(...a) }) {
  if (!apiKey || !baseUrl || !model || !voiceId) throw new Error('elevenlabs not configured');
  const base = String(baseUrl).replace(/\/+$/, '');
  const fail = (msg, props) => Object.assign(new Error(msg), props); // 메시지에 응답 본문·키를 넣지 않는다.
  return {
    name: 'elevenlabs',
    model,
    async synthesize({ text }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const t0 = Date.now();
      try {
        const res = await fetchFn(`${base}/text-to-speech/${encodeURIComponent(voiceId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: model }), signal: controller.signal });
        if (res.status === 429) throw fail('elevenlabs rate limited', { code: 429, retryable: false });
        if (!res.ok) throw fail(`elevenlabs error ${res.status}`, { code: res.status >= 500 ? 503 : 502, retryable: res.status >= 500 });
        const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!/^audio\/[a-z0-9.+-]+$/.test(contentType)) throw fail('elevenlabs bad content-type', { code: 502, invalid: true });
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxAudioBytes) throw fail('elevenlabs audio too large', { code: 502, invalid: true });
        const audio = new Uint8Array(await res.arrayBuffer());
        if (!audio.byteLength || audio.byteLength > maxAudioBytes) throw fail('elevenlabs bad audio size', { code: 502, invalid: true });
        return { provider: 'elevenlabs', model, usage: { chars: [...text].length }, latency_ms: Date.now() - t0, audio, contentType };
      } catch (e) {
        if (e?.name === 'AbortError') throw fail('elevenlabs timeout', { code: 504, retryable: false, timeout: true });
        if (e?.code) throw e;
        throw fail('elevenlabs network error', { code: 503, retryable: false });
      } finally { clearTimeout(timer); }
    },
  };
}
