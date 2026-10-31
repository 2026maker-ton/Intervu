// 잡음 vs 말 판별(순수 함수, 브라우저·테스트 공용). 매 프레임(50ms)의 소리 크기(rms)와 "주기성(사람 목소리처럼 규칙적인 떨림이 있는가)"을 받아
// 말이 시작됐는지 판단한다. 아래는 모두 무음으로 취급한다: ① 바닥값 이하의 아주 작은 소리 ② 150ms 안에 끝나는 짧은 소리(클릭·기침 소리·키보드)
// ③ 크기는 있어도 주기성이 없는 소리(바람·선풍기·에어컨 같은 넓은 대역 잡음). 무음 구간은 정적 판정에 쓰고 전사로 보내지 않는다.
export const FLOOR_RMS = 0.02;     // 이보다 작으면 임계값 계산 결과와 무관하게 무음(약 -34 dBFS)
export const MIN_RUN_FRAMES = 3;   // 연속 3프레임(150ms) 이상 커야 '목소리 후보'
export const MIN_VOICED_FRAMES = 8; // 후보가 누적 8프레임(400ms) 이상
export const MIN_PERIODIC = 2;     // 그 중 주기성이 확인된 표본 2개 이상

export const thresholdFrom = (noiseAvg) => Math.max(FLOOR_RMS, noiseAvg * 3);

export function createSpeechGate(threshold = FLOOR_RMS) {
  const th = Math.max(FLOOR_RMS, threshold);
  let run = 0; let voiced = 0; let sampled = 0; let periodic = 0; let spoke = false;
  return {
    // rms: 이 프레임 소리 크기. periodicFn: 주기성 검사(비싸서 필요할 때만 호출). 반환: { voice(이 프레임이 확정된 목소리인가), spoke(이 구간에 말이 시작됐나) }
    push(rms, periodicFn) {
      if (rms >= th) run += 1; else run = 0;
      const voice = run >= MIN_RUN_FRAMES;
      if (voice) {
        voiced += 1;
        if (voiced % 2 === 0) { sampled += 1; if (periodicFn()) periodic += 1; }
        if (!spoke && voiced >= MIN_VOICED_FRAMES && periodic >= MIN_PERIODIC) spoke = true;
      }
      return { voice: voice && (spoke || periodic > 0), spoke };
    },
    get spoke() { return spoke; },
    stats() { return { voiced, sampled, periodic, spoke }; },
    reset() { run = 0; voiced = 0; sampled = 0; periodic = 0; spoke = false; },
  };
}

// 한 답변의 음량 그래프와 구간(결과 화면용, 순수 함수). rms·voice는 프레임별 값(목소리 확정 여부 1/0).
// 반환: envelope(최대 120칸, 그 답변의 최대 음량 대비 0~100), segments(실제 답변 구간 speech / 600ms 이상 정적 pause, 초 단위).
// 첫 발화 전 대기와 마지막 발화 뒤 3초 정적은 답변 시간에 넣지 않는다.
export const PAUSE_MS = 600;
export function voiceTimeline(rms, voice, frameMs = 50) {
  const n = rms.length;
  const total = Math.round((n * frameMs) / 100) / 10;
  if (!n) return { total_seconds: 0, envelope: [], segments: [] };
  const B = Math.min(120, n); const step = n / B; const buckets = [];
  for (let b = 0; b < B; b++) {
    const a = Math.floor(b * step); const z = Math.max(a + 1, Math.floor((b + 1) * step));
    let s = 0; for (let i = a; i < z; i++) s += rms[i]; buckets.push(s / (z - a));
  }
  const peak = Math.max(...buckets) || 1;
  const envelope = buckets.map((x) => Math.round((x / peak) * 100));
  const sec = (f) => Math.round((f * frameMs) / 100) / 10;
  const gapFrames = Math.ceil(PAUSE_MS / frameMs);
  const segments = []; let start = -1; let last = -1;
  for (let i = 0; i < n; i++) {
    if (!voice[i]) continue;
    if (start < 0) start = i;
    else if (i - last - 1 >= gapFrames) { segments.push({ k: 'speech', s: sec(start), e: sec(last + 1) }, { k: 'pause', s: sec(last + 1), e: sec(i) }); start = i; }
    last = i;
  }
  if (start >= 0) segments.push({ k: 'speech', s: sec(start), e: sec(last + 1) });
  return { total_seconds: total, envelope, segments: segments.slice(0, 80) };
}
