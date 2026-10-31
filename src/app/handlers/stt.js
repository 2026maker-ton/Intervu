// Groq Whisper STT: POST /sessions/:id/transcriptions (multipart audio). 동작 불변 추출(WP-A1).
// 녹음 후 전사 방식. 전사 텍스트는 답변 입력창 확인용으로만 반환하며,
// 기존 turn.text 제출 API를 그대로 사용해 면접을 진행한다.
import { detectPii } from '../../domain/pii.js';
import { readMultipartAudio } from '../body.js';
import { SIGNUP_NOTICE_VERSION } from './auth.js';

export function createSttHandlers(d) {
  const { config, store, err, groq, killedGroq, caller, requestContext, checkRate } = d;
  // 음성 전송 고지가 포함된 동의만 인정한다: 구 STT 전용 동의 또는 가입 동의(만 18세 + Groq 전송 고지).
  const STT_NOTICES = new Set(['stt-groq-2026-10', SIGNUP_NOTICE_VERSION]);
  const realAudioContext = (owner, extra = {}) => {
    const record = store.getConsent?.(owner);
    const ctx = requestContext(owner, { ...extra, forceRealData: true });
    // Generic profile consent is not enough for a real microphone recording sent to Groq.
    ctx.consent = ctx.consent && STT_NOTICES.has(record?.notice_version);
    return { ctx, record };
  };

  function sttStatus(owner, params = new URLSearchParams()) {
    const pid=params.get('profile_id'),sid=params.get('session_id');
    const session=sid?store.getSession(owner,sid):null;
    const profile=pid?store.getProfile(owner,pid):session?store.getProfile(owner,store.getVersion(session.profile_version_id)?.profile_id):null;
    if((pid&&sid)||(pid&&!profile)||(sid&&!session)||profile?.org_type==='highschool') return {configured:false,provider:'disabled',real_data_allowed:false,requires_adult_consent:false,message:'고입·미성년자 연습에서는 실제 음성 전사를 사용할 수 없습니다. 텍스트로 답해 주세요.'};
    if (!config.groq.apiKey) return { configured: false, provider: 'none', message: '음성 인식 키가 없습니다. 텍스트로 답해 주세요.' };
    if (killedGroq) return { configured: true, provider: 'disabled', message: '음성 인식이 비활성화되어 있습니다. 텍스트로 답해 주세요.' };
    // A microphone recording is real personal data even if the profile/session is a demo fixture.
    const { ctx, record } = realAudioContext(owner);
    const plan = caller.plan('speech.transcribe', ctx);
    const base = {
      configured: true, provider: plan.route.provider === 'groq' ? 'groq-whisper' : 'disabled',
      model: plan.route.provider === 'groq' ? groq.model : undefined,
      maxAudioMB: Math.round(config.groq.maxAudioBytes / 1024 / 1024),
      maxRecordingSeconds: config.groq.maxRecordingSeconds,
      real_data_allowed: plan.live === true,
      requires_adult_consent: !ctx.adult,
      requires_stt_consent: !STT_NOTICES.has(record?.notice_version),
      adult_confirmed: ctx.adult,
    };
    // Configured provider and permission to send this user's real audio are separate states.
    if (!plan.live) return {
      ...base, blocked_reason: plan.reason,
      message: plan.reason === 'consent_missing'
        ? '만 18세 이상 확인과 Groq 음성 전송 안내 동의가 필요합니다.'
        : 'Groq 전사를 사용할 수 없습니다. 서버 운영 설정을 확인하거나 텍스트로 답해 주세요.',
    };
    return {
      ...base, message: 'Groq Whisper 한국어 전사를 사용할 수 있습니다.',
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
    // 합성 샘플 세션(서버 fixture 판정)에서는 샘플 답변을 소리 내어 읽는 음성 시연을 허용한다. 그 외 음성은 실데이터 게이트(성인 동의+REAL_DATA_ACK)를 따른다.
    const { ctx } = realAudioContext(owner, { forceMock: !!s.highschool_mock || store.getProfile(owner, store.getVersion(s.profile_version_id)?.profile_id)?.org_type === 'highschool' });
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
