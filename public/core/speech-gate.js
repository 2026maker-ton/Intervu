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
