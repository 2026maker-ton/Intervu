// 서버 TTS 프록시(WP-B6): POST /sessions/:id/tts {target}. 합성할 문장은 요청이 아니라 세션에서만 가져온다(임의 텍스트 불가).
// 성공 → 오디오 바이트(저장 없음). 차단·실패·미설정 → 204 + X-TTS-Fallback: browser(본문 없음)로 브라우저 TTS 대체.
const TARGETS = new Set(['current_question', 'last_utterance']);

export function createTtsHandlers(d) {
  const { config, store, err, caller, elevenlabs, requestContext, checkRate } = d;
  const fallback = (trace) => new Response(null, { status: 204, headers: { 'X-TTS-Fallback': 'browser', 'Cache-Control': 'no-store', ...(trace ? { 'X-Provider-Trace': JSON.stringify(trace) } : {}) } });

  function textOf(s, target) {
    if (target === 'current_question') return s.questions?.[s.q_index]?.text || '';
    const evs = store.events.get(s.id) || [];
    for (let i = evs.length - 1; i >= 0; i--) {
      const p = evs[i].payload;
      if (evs[i].type === 'assistant.message' && p?.speaker_id !== 'user' && typeof p?.utterance === 'string' && p.utterance) return p.utterance;
    }
    return '';
  }

  async function synthesize(owner, id, body, requestId) {
    const target = body?.target;
    if (!TARGETS.has(target)) return err('validation_error', 'target은 current_question 또는 last_utterance여야 합니다.', 422, { requestId });
    const s = store.getSession(owner, id);
    if (!s || s.state === 'deleting' || s.state === 'deleted') return err('not_found', '세션을 찾을 수 없습니다.', 404);
    const text = textOf(s, target); // 요청 본문의 text 등 다른 필드는 읽지 않는다.
    if (!text) return err('validation_error', '읽어 줄 문장이 아직 없습니다.', 422, { requestId });
    const limited = checkRate(owner, 'tts');
    if (limited) return limited;
    if (!elevenlabs || [...text].length > config.elevenlabs.charCap) return fallback();
    const cap = config.elevenlabs.maxAudioBytes;
    const res = await caller.call('speech.synthesize', {
      ctx: requestContext(owner, { forceMock: !!s.highschool_mock, synthetic: s.server_synthetic === true }),
      mockAlias: 'none',
      reserve: { key: `session:${s.id}`, amount: ([...text].length / 1000) * config.elevenlabs.pricePer1kChars },
      invoke: (a) => a.synthesize({ text }),
      mock: () => null, fallback: () => null,
      validate: (o) => o?.audio?.byteLength > 0 && o.audio.byteLength <= cap && /^audio\//.test(o.contentType || ''),
    });
    if (res.value === null) return fallback(res.trace);
    return new Response(res.value.audio, { status: 200, headers: { 'Content-Type': res.value.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Provider-Trace': JSON.stringify(res.trace) } });
  }

  return { synthesize };
}
