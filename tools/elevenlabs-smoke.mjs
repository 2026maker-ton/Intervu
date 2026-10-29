// ElevenLabs 실호출 스모크(WP-B6). 수동 실행 전용, 합성 문장만 사용한다. 에이전트·CI는 개발자 승인 없이 실행하지 않는다.
// 사용: ELEVENLABS_API_KEY=... ELEVENLABS_BASE_URL=... ELEVENLABS_MODEL=... ELEVENLABS_VOICE_ID=... ELEVENLABS_LIVE_ACK=true node tools/elevenlabs-smoke.mjs
// [UNVERIFIED] 요청 형태는 어댑터의 가정(text-to-speech/{voice}, xi-api-key)을 따른다. 결과(지연·크기)는 docs/validation-results.md에 "실측"으로 기록한다.
import { loadDotEnv } from '../src/env.js';
import { createElevenlabsAdapter } from '../src/providers/adapters/elevenlabs.js';

const env = { ...loadDotEnv(process.cwd()), ...process.env };
const need = ['ELEVENLABS_API_KEY', 'ELEVENLABS_BASE_URL', 'ELEVENLABS_MODEL', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_LIVE_ACK'];
const missing = need.filter((k) => !env[k] || (k === 'ELEVENLABS_LIVE_ACK' && String(env[k]).toLowerCase() !== 'true'));
if (missing.length) { console.error(`거부: 다음 설정이 없거나 유효하지 않습니다 -> ${missing.join(', ')}. 호출하지 않았습니다.`); process.exit(2); }

console.log('주의: 이 스크립트는 ElevenLabs에 실제 네트워크 호출을 합니다(합성 문장 2건, 비용 발생 가능).');
const adapter = createElevenlabsAdapter({ apiKey: env.ELEVENLABS_API_KEY, baseUrl: env.ELEVENLABS_BASE_URL, model: env.ELEVENLABS_MODEL, voiceId: env.ELEVENLABS_VOICE_ID, timeoutMs: Number(env.ELEVENLABS_TIMEOUT_MS) || 15000 });
const SYNTHETIC = ['팀 프로젝트에서 갈등을 해결한 경험을 말씀해 주세요.', '그때 본인이 직접 한 행동은 무엇이었나요?'];
let ok = 0;
for (const text of SYNTHETIC) {
  const t0 = Date.now();
  try {
    const r = await adapter.synthesize({ text });
    ok += 1;
    console.log(`지연 ${Date.now() - t0}ms · ${r.contentType} · ${r.audio.byteLength}바이트`);
  } catch (e) {
    console.log(`지연 ${Date.now() - t0}ms · 오류 code=${e.code ?? '?'} invalid=${!!e.invalid}`); // 본문·키는 출력하지 않는다.
  }
}
console.log(`성공 ${ok}/${SYNTHETIC.length}`);
