// Groq Whisper STT: POST /sessions/:id/transcriptions (multipart audio). 동작 불변 추출(WP-A1).
// 녹음 후 전사 방식. 전사 텍스트는 답변 입력창 확인용으로만 반환하며,
// 기존 turn.text 제출 API를 그대로 사용해 면접을 진행한다.
import { detectPii } from '../../domain/pii.js';
import { readMultipartAudio } from '../body.js';

export function createSttHandlers(d) {
  const { config, store, err, groq, killedGroq, caller, requestContext, checkRate } = d;

  function sttStatus(owner) {
    if (!config.groq.apiKey) return { configured: false, provider: 'none', message: '음성 인식 키가 없습니다. 텍스트로 답해 주세요.' };
    if (killedGroq) return { configured: true, provider: 'disabled', message: '음성 인식이 비활성화되어 있습니다. 텍스트로 답해 주세요.' };
    // 게이트가 닫혀 있으면(확인·동의 미충족) 사용 가능으로 보이지 않게 한다. 사유 코드만 노출한다.
    const plan = caller.plan('speech.transcribe', requestContext(owner));
    if (!plan.live) return { configured: true, provider: 'disabled', blocked_reason: plan.reason, message: '음성 인식을 사용할 수 없습니다. 텍스트로 답해 주세요.' };
    return {
      configured: true, provider: 'groq-whisper', model: groq.model,
      maxAudioMB: Math.round(config.groq.maxAudioBytes / 1024 / 1024),
      maxRecordingSeconds: config.groq.maxRecordingSeconds,
      message: 'Groq Whisper 한국어 전사를 사용할 수 있습니다.',
    };
  }

  // 보안: 허용 오디오 형식만(브라우저 MediaRecorder 출력 + 호환 포맷)
  const ALLOWED_AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/m4a', 'video/webm']);

  async function transcribe(owner, id, request, requestId) {
    const s = store.getSession(owner, id);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (s.state === 'deleting' || s.state === 'deleted') return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (!groq || killedGroq || !config.groq.apiKey) {
      return err('stt_unavailable', '음성 인식을 사용할 수 없습니다. 텍스트로 답해 주세요.', 503, { retryable: false });
    }
    const limited = checkRate(owner, 'stt');
    if (limited) return limited;
    let parsed;
    try {
      parsed = await readMultipartAudio(request, config.groq.maxAudioBytes);
    } catch (e) {
      if (e?.error) return e;
      return err('invalid_audio', '음성 데이터를 읽지 못했습니다.', 422);
    }
    const mimeBase = String(parsed.mimeType || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_AUDIO.has(mimeBase)) {
      return err('validation_error', `지원하지 않는 음성 형식입니다: ${mimeBase || 'unknown'}`, 422, { requestId });
    }
    // 게이트(LIVE_ACK·데이터 등급)·타임아웃·429를 호출 래퍼가 처리한다. 음성 크기·형식 오류(413/422)는 그대로 돌려준다.
    const ctx = requestContext(owner, { forceMock: !!s.highschool_mock, synthetic: s.server_synthetic === true });
    let res;
    try {
      res = await caller.call('speech.transcribe', {
        ctx, mockAlias: 'none',
        invoke: (a) => a.transcribe({ audioBuffer: parsed.audio, filename: parsed.filename, mimeType: mimeBase }),
        mock: () => null, fallback: () => null,
        passthrough: (e) => e?.code === 413 || e?.code === 422,
      });
    } catch (e) {
      parsed.audio = null;
      return err(e.code === 413 ? 'payload_too_large' : 'invalid_audio', e.message, e.code, { requestId });
    }
    parsed.audio = null; // 전사 후 메모리에서 폐기
    const trace = res.trace;
    if (res.value === null) {
      const details = { provider_trace: [trace] };
      if (trace.mode === 'fallback' && trace.reason === 'rate_limited') {
        // 무료 한도 소진: 텍스트 입력 유지, 재시도 없음
        return err('quota_exceeded', '음성 인식 무료 한도를 소진했습니다. 텍스트로 답해 주세요.', 429, { retryable: false, requestId, details });
      }
      if (trace.mode === 'fallback') return err('stt_failed', '음성 인식에 실패했습니다. 텍스트로 답해 주세요.', 502, { retryable: false, requestId, details });
      return err('stt_unavailable', '음성 인식을 사용할 수 없습니다. 텍스트로 답해 주세요.', 503, { retryable: false, requestId, details });
    }
    const out = res.value;
    if (!out.text) {
      return { status: 200, body: { text: '', empty: true, model: out.model, provider_trace: [trace], note: '전사 결과가 비어 있습니다. 다시 녹음하거나 텍스트로 입력하세요.' } };
    }
    const pii = detectPii(out.text).map((x) => x.type);
    return {
      status: 200,
      body: {
        text: out.text, model: out.model, language: out.language || 'ko',
        pii_warnings: pii, provider_trace: [trace],
        note: pii.length ? '전사에 개인정보 후보가 있습니다. 제출 전 확인·수정하세요.' : '전사 결과를 확인·수정한 뒤 답변 제출 버튼을 누르세요.',
      },
    };
  }

  return { sttStatus, transcribe };
}
