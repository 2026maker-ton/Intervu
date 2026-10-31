// 자동 녹음·정적 감지(VAD)·음성 참고 지표. 모두 브라우저 안에서 계산하고, 서버에는 전사용 음성 구간과 숫자 지표만 보낸다.
// ponytail: RMS 임계값 VAD와 자기상관 피치 추정은 단순 휴리스틱이다. 잡음 많은 환경·실기기 검증 전(오탐 시 임계값·정적 길이를 조정).
const FRAME_MS = 50;

export async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const read = () => { analyser.getFloatTimeDomainData(buf); return buf; };
  const level = () => { const b = read(); let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };
  return {
    stream, ctx, level, read, sampleRate: ctx.sampleRate,
    close() { stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); },
  };
}

// 자기상관으로 기본 주파수 주기(샘플)를 찾는다. 70~400Hz 범위, 신뢰도가 낮으면 null.
function pitchPeriod(b, sampleRate) {
  const minLag = Math.floor(sampleRate / 400); const maxLag = Math.floor(sampleRate / 70);
  let best = 0; let bestLag = 0; let energy = 0;
  for (let i = 0; i < b.length; i++) energy += b[i] * b[i];
  if (!energy) return null;
  for (let lag = minLag; lag <= maxLag && lag < b.length / 2; lag++) {
    let s = 0;
    for (let i = 0; i + lag < b.length; i++) s += b[i] * b[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return best / energy > 0.5 ? bestLag : null;
}

import { createSpeechGate, thresholdFrom, FLOOR_RMS } from './speech-gate.js';

// 주변 소음 크기로 발화 임계값을 정한다(질문 음성이 나가기 전, 마이크가 열린 직후 0.4초). 면접 동안 한 번만 한다.
export async function calibrate(mic, ms = 400) {
  const xs = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { xs.push(mic.level()); await new Promise((r) => setTimeout(r, FRAME_MS)); }
  const avg = xs.reduce((a, x) => a + x, 0) / (xs.length || 1);
  mic.threshold = thresholdFrom(avg);
  return mic.threshold;
}

// 한 답변 동안의 녹음 구간 관리. onSegment(blob): 발화 뒤 silenceMs 정적이 오면 구간을 끊어 넘긴다.
export function createCapture(mic, { silenceMs = 3000, onSegment, onState = () => {} }) {
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  let rec = null; let chunks = []; let timer = null;
  let calibrating = mic.threshold ? null : []; let lastVoice = 0; // 임계값이 이미 있으면 바로 감지를 시작한다
  // 잡음(작은 소리·짧은 소리·주기성 없는 소리)은 말로 치지 않는다: 구간에 말이 확인되기 전에는 정적 컷도 전사 전송도 하지 않는다.
  let gate = createSpeechGate(mic.threshold || FLOOR_RMS);
  // 지표 누적
  const m = { frames: 0, voiced: 0, silenceCount: 0, longestSilence: 0, curSilence: 0, rms: [], periods: [] };

  function startRecorder() {
    chunks = [];
    rec = new MediaRecorder(mic.stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.start(250);
  }
  function stopRecorder() {
    return new Promise((resolve) => {
      if (!rec || rec.state === 'inactive') return resolve(null);
      rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null);
      rec.stop();
    });
  }
  async function cut() {
    clearInterval(timer); timer = null;
    const blob = await stopRecorder();
    onState('processing');
    if (blob) onSegment(blob);
  }
  function tick() {
    const b = mic.read();
    let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    const rms = Math.sqrt(s / b.length);
    const now = performance.now();
    if (calibrating) { // 처음 1초: 주변 소음으로 임계값을 정한다
      calibrating.push(rms);
      if (calibrating.length >= 1000 / FRAME_MS) { const avg = calibrating.reduce((a, x) => a + x, 0) / calibrating.length; mic.threshold = thresholdFrom(avg); gate = createSpeechGate(mic.threshold); calibrating = null; }
      return;
    }
    m.frames += 1;
    const wasSpoke = gate.spoke;
    let pitch = null;
    const r = gate.push(rms, () => { pitch = pitchPeriod(b, mic.sampleRate); return !!pitch; });
    if (r.spoke && !wasSpoke) onState('speaking');
    if (r.voice) {
      lastVoice = now; m.voiced += 1; m.rms.push(rms);
      if (m.curSilence >= 600) m.silenceCount += 1;
      m.curSilence = 0;
      if (pitch) m.periods.push(pitch);
    } else if (gate.spoke) {
      m.curSilence += FRAME_MS;
      m.longestSilence = Math.max(m.longestSilence, m.curSilence);
      if (now - lastVoice >= silenceMs) cut(); // 말이 확인된 구간만 3초 정적으로 끊어 보낸다
    }
  }
  return {
    start() { gate.reset(); lastVoice = 0; m.curSilence = 0; startRecorder(); onState('listening'); timer = setInterval(tick, FRAME_MS); },
    // 시간 초과·종료: 남은 구간을 바로 넘긴다.
    // 말이 확인되지 않은 구간(잡음·무음뿐)은 null을 돌려 전사로 보내지 않는다.
    async stop() { clearInterval(timer); timer = null; const blob = await stopRecorder(); return gate.spoke ? blob : null; },
    get spoke() { return gate.spoke; },
    metrics() {
      const mean = m.rms.length ? m.rms.reduce((a, x) => a + x, 0) / m.rms.length : 0;
      const sd = m.rms.length ? Math.sqrt(m.rms.reduce((a, x) => a + (x - mean) ** 2, 0) / m.rms.length) : 0;
      const pm = m.periods.length ? m.periods.reduce((a, x) => a + x, 0) / m.periods.length : 0;
      let d = 0; for (let i = 1; i < m.periods.length; i++) d += Math.abs(m.periods[i] - m.periods[i - 1]);
      return {
        speech_seconds: (m.voiced * FRAME_MS) / 1000,
        silence_count: m.silenceCount,
        longest_silence_seconds: m.longestSilence / 1000,
        speech_ratio: m.frames ? m.voiced / m.frames : 0,
        volume_cv: mean ? sd / mean : 0,
        pitch_jitter: m.periods.length > 1 && pm ? d / (m.periods.length - 1) / pm : 0,
      };
    },
  };
}
