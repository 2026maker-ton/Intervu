// 중앙 설정: 모델 레지스트리(Gemini 우선), 예산, 한도.
// 사양: master-plan 최종결정표 + 2026-10-24 Gemini-first 결정(decisions/2026-10-24-gemini-first.md)
export function loadConfig(env = process.env) {
  const num = (k, d) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  const bool = (v) => String(v || 'false').toLowerCase() === 'true';
  const route = (op, d) => {
    const v = String(env[`ROUTE_${op}`] || d).toLowerCase();
    return ['mock', 'gemini', 'groq', 'claude', 'deepseek'].includes(v) ? v : 'mock';
  };
  const paidAck = bool(env.GEMINI_PAID_ACK);
  const allowUnpaid = bool(env.GEMINI_ALLOW_UNPAID);
  return {
    port: Number(env.PORT) || 3000,
    // 내장 기본 토큰 없음: 환경변수로 명시한 토큰만 유효하다(미설정이면 인증 가능한 사용자가 없다).
    // 실제 로그인은 P3. 그 전까지 데모는 운영자가 나눠 준 접속 토큰을 쓴다.
    devTokens: Object.fromEntries([[env.DEV_TOKEN_A, 'user-a'], [env.DEV_TOKEN_B, 'user-b']].filter(([t]) => typeof t === 'string' && t.trim())),
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
    claude: {
      timeoutMs: num('CLAUDE_TIMEOUT_MS', 20000),
      monthlyCapUsd: num('CLAUDE_MONTHLY_CAP_USD', 0), // 0 = 미설정. 공급자별 상한은 아직 미강제(전역 월 예산만 적용)
      apiVersion: env.CLAUDE_API_VERSION || '',
      price: { input: num('CLAUDE_PRICE_IN_PER_M_USD', 0), output: num('CLAUDE_PRICE_OUT_PER_M_USD', 0) },
    },
    groq: {
      apiKey: env.GROQ_WHISPER_KEY || env.GROQ_API_KEY || '',
      model: env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
      timeoutMs: num('GROQ_TIMEOUT_MS', 30000),
      // 무료 한도 보호: 25MB(무료 tier 상한), 녹음 120초, 1회 재시도 없음(429 즉시 fallback)
      maxAudioBytes: num('GROQ_MAX_AUDIO_BYTES', 25 * 1024 * 1024),
      maxRecordingSeconds: num('GROQ_MAX_RECORDING_SECONDS', 120),
    },
    // 모델 레지스트리(WP-B1): operation -> {provider, alias, maxOutputTokens}. providers/registry.js가 실제 라우팅에 쓴다.
    // 환경변수 ROUTE_<OP>(예: ROUTE_DIALOGUE_NEXT=mock)로 공급자를 바꾼다. 알 수 없는 값은 mock으로 처리한다.
    // 모델 ID는 공급자 블록(gemini.textModel 등)에만 있고, 외부(응답·상태 API)에는 alias만 노출한다.
    registry: {
      'dialogue.next': { provider: route('DIALOGUE_NEXT', String(env.LLM_DIALOGUE_PROVIDER || 'gemini').toLowerCase()), alias: 'dialogue-text', maxOutputTokens: 500 },
      'claims.extract': { provider: route('CLAIMS_EXTRACT', env.LLM_ANALYSIS_PROVIDER || 'gemini'), alias: 'gemini-text', maxOutputTokens: 1500 },
      // 평가는 규칙 기반이 기본(Gemini 평가는 사람 평가 검증 후, DG-8)
      'evaluation.generate': { provider: route('EVALUATION_GENERATE', 'mock'), alias: 'rule-based', maxOutputTokens: 2500 },
      'speech.transcribe': { provider: route('SPEECH_TRANSCRIBE', 'groq'), alias: 'groq-whisper', maxOutputTokens: 1000 },
      'speech.synthesize': { provider: route('SPEECH_SYNTHESIZE', 'mock'), alias: 'browser-tts', maxOutputTokens: 0 },
    },
    // 공급자 게이트 입력(04 §2): 키·BASE_URL·MODEL·LIVE_ACK·REAL_DATA_ACK. 비밀값은 여기에만 있고 응답으로 나가지 않는다.
    // GEMINI_PAID_ACK는 구 설정(유료 확인=약관·데이터 처리 확인)이라 LIVE_ACK+실데이터 허용으로 취급한다(deprecated).
    providerGate: {
      // DeepSeek(WP-B2): 모델·URL은 환경변수에서만 온다(기본값 없음 → 미설정이면 mock, not_configured). 실데이터는 REAL_DATA_ACK+동의+만 19세가 모두 필요.
      deepseek: {
        apiKey: env.DEEPSEEK_API_KEY || '',
        baseUrl: env.DEEPSEEK_BASE_URL || '',
        model: env.DEEPSEEK_MODEL || '',
        liveAck: bool(env.DEEPSEEK_LIVE_ACK),
        realDataAck: bool(env.DEEPSEEK_REAL_DATA_ACK),
        legacyRealData: false,
        syntheticOnly: !bool(env.DEEPSEEK_REAL_DATA_ACK),
      },
      gemini: {
        apiKey: env.GEMINI_API_KEY || '',
        baseUrl: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
        model: env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite',
        liveAck: bool(env.GEMINI_LIVE_ACK) || paidAck || allowUnpaid,
        realDataAck: bool(env.GEMINI_REAL_DATA_ACK),
        legacyRealData: paidAck,
        // 무료/미확인 등급이면 실데이터 차단 사유를 synthetic_only로 표기
        syntheticOnly: !paidAck,
      },
      claude: {
        apiKey: env.CLAUDE_API_KEY || '',
        baseUrl: env.CLAUDE_BASE_URL || '',
        model: env.CLAUDE_MODEL || '',
        liveAck: bool(env.CLAUDE_LIVE_ACK),
        realDataAck: bool(env.CLAUDE_REAL_DATA_ACK),
        legacyRealData: false,
        syntheticOnly: true,
      },
      groq: {
        apiKey: env.GROQ_WHISPER_KEY || env.GROQ_API_KEY || '',
        baseUrl: env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        model: env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
        liveAck: bool(env.GROQ_LIVE_ACK),
        realDataAck: bool(env.GROQ_REAL_DATA_ACK),
        legacyRealData: false,
        syntheticOnly: true,
      },
    },
    deepseek: {
      timeoutMs: num('DEEPSEEK_TIMEOUT_MS', 12000),
      // 단가가 비어 있으면 0(달러 환산 안 함) → 호출 수 상한으로만 방어한다(04 §5).
      priceIn: num('DEEPSEEK_PRICE_IN', 0),
      priceOut: num('DEEPSEEK_PRICE_OUT', 0),
    },
    // 공급자별 월 상한(04 §5). usd: <P>_MONTHLY_CAP_USD(비우면 달러 상한 없음), calls: <P>_MONTHLY_CALL_CAP(기본 500). 호출 래퍼가 인메모리로 집행한다.
    providerCaps: {
      deepseek: { usd: env.DEEPSEEK_MONTHLY_CAP_USD ? num('DEEPSEEK_MONTHLY_CAP_USD', 0) : null, calls: num('DEEPSEEK_MONTHLY_CALL_CAP', 500) },
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
    // 사용자별 속도 제한(분/일): 문서 추출·음성 전사·답변 제출. 환경변수로 조정한다.
    rateLimits: {
      documents: { perMinute: num('DOCS_RATE_PER_MINUTE', 20), perDay: num('DOCS_RATE_PER_DAY', 300) },
      stt: { perMinute: num('STT_RATE_PER_MINUTE', 20), perDay: num('STT_RATE_PER_DAY', 300) },
      fetch: { perMinute: num('OFFICIAL_FETCH_RATE_PER_MINUTE', 5), perDay: num('OFFICIAL_FETCH_RATE_PER_DAY', 30) },
      turns: { perMinute: num('TURN_RATE_PER_MINUTE', 60), perDay: num('TURN_RATE_PER_DAY', 2000) },
    },
    // 프로필 추출 남용 방지(사양 §15: 계정당 분당2회/일10회, 1회예약 $0.01).
    // 통합 테스트처럼 합성 트래픽이 많은 환경에서는 환경변수로 완화한다.
    profileRate: {
      perMinute: num('PROFILE_RATE_PER_MINUTE', 2),
      perDay: num('PROFILE_RATE_PER_DAY', 10),
      reserve: num('PROFILE_EXTRACT_RESERVE_USD', 0.01),
    },
    // WP-C2: 공식 자료 수집. 허용 도메인(접미사, 쉼표) 기본 비어 있음 = 수집 비활성.
    officialFetch: { allow: String(env.OFFICIAL_FETCH_ALLOW || ''), timeoutMs: num('OFFICIAL_FETCH_TIMEOUT_MS', 8000), maxBytes: num('OFFICIAL_FETCH_MAX_BYTES', 1048576) },
    // 킬 스위치(사양 §13·§12): 'gemini'가 포함되면 외부 호출을 차단하고 Mock으로 동작.
    killSwitch: String(env.KILL_PROVIDERS || env.INTERVU_KILL || 'none').toLowerCase(),
    // 관리자 인증 (PROJECT §2.3/§3): /admin/*·/metrics·/diagnostics 는 x-admin-token 헤더가 ADMIN_TOKEN과 일치할 때만 허용.
    // ADMIN_TOKEN 미설정이면 관리 기능은 꺼진다(공개본 조회는 영향 없음).
    adminToken: String(env.ADMIN_TOKEN || ''),
    // 합성 샘플 API(WP-C6). 기본 켬, DEMO_FIXTURES=off로 끔.
    demoFixtures: String(env.DEMO_FIXTURES ?? 'on').toLowerCase() !== 'off',
    // 빈 문자열을 명시하면 영속화를 끈다(테스트·격리 환경). 미설정 시 기본 파일 사용.
    trendsFile: env.TRENDS_FILE === undefined ? 'data/trends.json' : String(env.TRENDS_FILE),
  };
}
