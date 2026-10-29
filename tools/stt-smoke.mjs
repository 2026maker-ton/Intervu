// 수동 Groq STT 스모크(WP-B5). 자동 실행 금지: npm test/CI에 연결하지 않는다. 절차는 docs/stt-smoke.md.
// 합성 오디오(로컬 생성 사인파 WAV)만 보낸다. 개인정보·실제 음성 없음. 키는 환경변수에서만 읽고 출력하지 않는다.
// 사용: GROQ_WHISPER_KEY=... GROQ_LIVE_ACK=true node tools/stt-smoke.mjs --i-approve-live-call [--runs=3]
import { createGroqWhisperAdapter } from '../src/providers/adapters.js';

const key = process.env.GROQ_WHISPER_KEY || process.env.GROQ_API_KEY || '';
const refuse = (m) => { console.error(`거부: ${m}`); process.exit(2); };
if (!key) refuse('GROQ_WHISPER_KEY(또는 GROQ_API_KEY) 환경변수가 없습니다. 실호출하지 않습니다.');
if (process.env.GROQ_LIVE_ACK !== 'true') refuse('GROQ_LIVE_ACK=true가 필요합니다(외부 호출 의사 확인).');
if (!process.argv.includes('--i-approve-live-call')) refuse('--i-approve-live-call 플래그가 필요합니다(개발자 명시 승인).');
const runs = Math.min(10, Math.max(1, Number((process.argv.find((a) => a.startsWith('--runs=')) || '--runs=1').split('=')[1]) || 1));

// 16kHz 모노 16bit PCM WAV, 440Hz 사인파 1.5초(약 48KB). 음성이 아니므로 전사 결과는 비어 있거나 무의미할 수 있다 — 연결·한도·지연 확인용이다.
function tinyWav(seconds = 1.5, rate = 16000) {
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

const adapter = createGroqWhisperAdapter({ apiKey: key, baseUrl: process.env.GROQ_BASE_URL || undefined, model: process.env.GROQ_WHISPER_MODEL || undefined });
const audioBuffer = tinyWav();
const rows = [];
for (let i = 0; i < runs; i += 1) {
  const t0 = Date.now();
  try {
    const r = await adapter.transcribe({ audioBuffer, filename: 'synthetic.wav', mimeType: 'audio/wav' });
    rows.push({ run: i + 1, outcome: r.empty ? 'empty' : 'text', latency_ms: Date.now() - t0, chars: r.text.length });
  } catch (e) {
    rows.push({ run: i + 1, outcome: e.code === 429 ? '429' : e.code === 504 ? 'timeout' : `error_${e.code ?? 'unknown'}`, latency_ms: Date.now() - t0, chars: 0 });
    if (e.code === 429) break; // 무료 한도: 더 호출하지 않는다
  }
}
console.table(rows);
console.log(`표본 ${rows.length}건(합성 사인파). 오류율(CER/WER)은 이 도구로 측정되지 않는다 — docs/eval/templates/E-6-stt-error.csv 절차 참조.`);
