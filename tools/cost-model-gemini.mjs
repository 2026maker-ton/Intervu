// Gemini 기준 원가 계산기 (docs/cost-assumptions.gemini.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function calculateGemini(a, sessions = 1000) {
  if (!Number.isInteger(sessions) || sessions < 0) throw new Error('sessions must be a nonnegative integer');
  const s = a.scenario, p = a.prices, o = a.operations;
  const userAudioSec = s.user_audio_seconds_per_turn.reduce((n, v) => n + v, 0);
  const stt = (userAudioSec / 60) * p.stt_per_minute;
  const llm = (s.llm_input_tokens * p.llm_input_per_million + s.llm_output_tokens * p.llm_output_per_million) / 1e6;
  const tts = (s.tts_characters / 1e6) * p.tts_per_million_characters;
  const baseline = stt + llm + tts;
  const monthlyApi = sessions * (stt + llm + tts);
  const reservedMonthly = monthlyApi * (1 + o.overhead_fraction);
  return {
    assumption_date: a.as_of, provider: a.provider, measured: false, sessions,
    models: a.models,
    per_session: { stt, llm, tts, baseline },
    monthly: { api: monthlyApi, api_with_reserve: reservedMonthly },
    budget_slots: Math.floor(o.monthly_api_budget / o.session_hard_cap),
    caveat: 'Arithmetic estimate with official list prices, not a quote or measured cost.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = JSON.parse(fs.readFileSync(path.join(root, process.argv.find((x) => x.startsWith('--assumptions='))?.split('=')[1] || 'docs/cost-assumptions.gemini.json'), 'utf8'));
  const raw = process.argv.find((x) => x.startsWith('--sessions='));
  console.log(JSON.stringify(calculateGemini(a, raw ? Number(raw.split('=')[1]) : 1000), null, 2));
}
