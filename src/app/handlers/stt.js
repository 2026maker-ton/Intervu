// Groq Whisper STT: POST /sessions/:id/transcriptions (multipart audio). 동작 불변 추출(WP-A1).
// 녹음 후 전사 방식. 전사 텍스트는 답변 입력창 확인용으로만 반환하며,
// 기존 turn.text 제출 API를 그대로 사용해 면접을 진행한다.
import { detectPii } from '../../domain/pii.js';
import { readMultipartAudio } from '../body.js';

export function createSttHandlers(d) {
  const { config, store, err, groq, killedGroq } = d;

  function sttStatus() {
    if (!config.groq.apiKey) return { configured: false, provider: 'none', message: '음성 인식 키가 없습니다. 텍스트로 답해 주세요.' };
    if (killedGroq) return { configured: true, provider: 'disabled', message: '음성 인식이 비활성화되어 있습니다. 텍스트로 답해 주세요.' };
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
    try {
      // 합성/개발 표시가 없어도 STT 자체는 PII를 외부로 보내지 않는다:
      // 음성은 전사 목적의 일시 처리이며 텍스트 결과에서 PII 경고를 함께 반환한다.
      const out = await groq.transcribe({ audioBuffer: parsed.audio, filename: parsed.filename, mimeType: mimeBase });
      parsed.audio = null; // 전사 후 메모리에서 폐기
      if (!out.text) {
        return { status: 200, body: { text: '', empty: true, model: out.model, note: '전사 결과가 비어 있습니다. 다시 녹음하거나 텍스트로 입력하세요.' } };
      }
      const pii = detectPii(out.text).map((x) => x.type);
      return {
        status: 200,
        body: {
          text: out.text, model: out.model, language: out.language || 'ko',
          pii_warnings: pii,
          note: pii.length ? '전사에 개인정보 후보가 있습니다. 제출 전 확인·수정하세요.' : '전사 결과를 확인·수정한 뒤 답변 제출 버튼을 누르세요.',
        },
      };
    } catch (e) {
      parsed.audio = null;
      if (e.code === 429) {
        // 무료 한도 소진: 텍스트 입력 유지, 재시도 없음
        return err('quota_exceeded', '음성 인식 무료 한도를 소진했습니다. 텍스트로 답해 주세요.', 429, { retryable: false, requestId });
      }
      if (e.code === 413 || e.code === 422) {
        return err(e.code === 413 ? 'payload_too_large' : 'invalid_audio', e.message, e.code, { requestId });
      }
      return err('stt_failed', '음성 인식에 실패했습니다. 텍스트로 답해 주세요.', 502, { retryable: false, requestId });
    }
  }

  return { sttStatus, transcribe };
}
