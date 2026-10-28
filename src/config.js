// 중앙 설정: 모델 레지스트리(Gemini 우선), 예산, 한도.
// 사양: master-plan 최종결정표 + 2026-10-24 Gemini-first 결정(decisions/2026-10-24-gemini-first.md)
export function loadConfig(env = process.env) {
  const num = (k, d) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    port: Number(env.PORT) || 3000,
    devTokens: {
      [env.DEV_TOKEN_A || 'dev-user-a-token']: 'user-a',
      [env.DEV_TOKEN_B || 'dev-user-b-token']: 'user-b',
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      // 2026-10-24 실키 검증: gemini-2.5-flash-lite는 신규 사용자 404.
      // gemini-3.5-flash-lite가 무료 tier + 최저가($0.30/$2.50)로 확인됨.
      textModel: env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite',
      fallbackModel: env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash',
      transcribeModel: env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
      timeoutMs: num('GEMINI_TIMEOUT_MS', 12000),
      // Paid 확인(유료 결제계정 + DPA/보존 확인) 없이는 실제 사용자 데이터 전송 금지
      paidAck: String(env.GEMINI_PAID_ACK || 'false').toLowerCase() === 'true',
      allowUnpaid: String(env.GEMINI_ALLOW_UNPAID || 'false').toLowerCase() === 'true',
      // 무료 전용: true면 유료 과금 모델로 절대 전환하지 않는다.
      // Google 실제 결제 상태는 제어하지 않으므로 AI Studio 결제 비활성 별도 확인 필요.
      freeOnly: String(env.GEMINI_FREE_ONLY ?? 'true').toLowerCase() !== 'false',
    },
    groq: {
      apiKey: env.GROQ_WHISPER_KEY || env.GROQ_API_KEY || '',
      model: env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
      timeoutMs: num('GROQ_TIMEOUT_MS', 30000),
      // 무료 한도 보호: 25MB(무료 tier 상한), 녹음 120초, 1회 재시도 없음(429 즉시 fallback)
      maxAudioBytes: num('GROQ_MAX_AUDIO_BYTES', 25 * 1024 * 1024),
      maxRecordingSeconds: num('GROQ_MAX_RECORDING_SECONDS', 120),
    },
    // 모델 레지스트리: operation -> {provider, model, maxOutputTokens}
    // Gemini 우선. gpt-6-luna 등은 품질/비용 비교 후보로 유지(미연동).
    registry: {
      'profile.extract': { provider: 'gemini', model: env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite', maxOutputTokens: 1500 },
      'dialogue.next': { provider: 'gemini', model: env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite', maxOutputTokens: 500 },
      'evaluation.generate': { provider: 'gemini', model: env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite', maxOutputTokens: 2500 },
      'report.repair': { provider: 'gemini', model: env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite', maxOutputTokens: 2500 },
      'speech.transcribe': { provider: 'gemini', model: env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe', maxOutputTokens: 1000 },
    },
    // Gemini 유료 단가 (USD/1M, 2026-10 공식 가격표 기준)
    geminiPricing: {
      'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, version: 'gemini-paid-2026-10' },
      'gemini-3.6-flash': { input: 0.75, output: 3.75, version: 'gemini-paid-2026-10-intro' },
      'gemini-3.7-flash': { input: 0.75, output: 3.75, version: 'gemini-paid-2026-10-intro' },
      'gemini-3.8-flash': { input: 0.75, output: 3.75, version: 'gemini-paid-2026-10-intro' },
      'gemini-3.5-transcribe': { perMinute: 0.005, version: 'gemini-paid-2026-10' },
    },
    budgets: {
      sessionHardCap: num('SESSION_HARD_CAP_USD', 0.08),
      evalReserve: num('EVAL_RESERVE_USD', 0.02),
      finishReserve: num('FINISH_RESERVE_USD', 0.005),
      monthlyApiBudget: num('MONTHLY_API_BUDGET_USD', 30),
      maxLlmCallsPerSession: 14,
      maxDialogueCalls: 11,
      maxOutputDialogue: 500,
      maxOutputEval: 2500,
    },
    limits: {
      maxCoreQuestions: 5,
      maxFollowupsTotal: 3,
      maxFollowupsPerQuestion: 1,
      maxUserTurns: 10,
      maxAnswerChars: 4000,
      maxUtteranceChars: 240,
      dataTtlDaysDefault: num('DATA_TTL_DAYS_DEFAULT', 30),
    },
    // 프로필 추출 남용 방지(사양 §15: 계정당 분당2회/일10회, 1회예약 $0.01).
    // 통합 테스트처럼 합성 트래픽이 많은 환경에서는 환경변수로 완화한다.
    profileRate: {
      perMinute: num('PROFILE_RATE_PER_MINUTE', 2),
      perDay: num('PROFILE_RATE_PER_DAY', 10),
      reserve: num('PROFILE_EXTRACT_RESERVE_USD', 0.01),
    },
    // 킬 스위치(사양 §13·§12): 'gemini'가 포함되면 외부 호출을 차단하고 Mock으로 동작.
    killSwitch: String(env.KILL_PROVIDERS || env.INTERVU_KILL || 'none').toLowerCase(),
    // 관리자 인증 (PROJECT §2.3/§3): ADMIN_TOKEN이 설정되면 /admin/* 은 x-admin-token 일치 시에만 허용.
    // 미설정 시 개발 토큰만으로 동작하는 dev-open 모드이며, 공개본 조회에는 영향이 없다.
    adminToken: String(env.ADMIN_TOKEN || ''),
    // 빈 문자열을 명시하면 영속화를 끈다(테스트·격리 환경). 미설정 시 기본 파일 사용.
    trendsFile: env.TRENDS_FILE === undefined ? 'data/trends.json' : String(env.TRENDS_FILE),
  };
}
