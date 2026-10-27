import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function calculate(a, sessions = 1000, applyTtsFreeTier = false) {
  if (!Number.isInteger(sessions) || sessions < 0) throw new Error('sessions must be a nonnegative integer');
  const s = a.scenario, p = a.prices, o = a.operations;
  for (const v of [...s.user_audio_seconds_per_turn, s.wall_minutes, s.ai_audio_minutes, s.llm_input_tokens, s.llm_output_tokens, s.tts_characters, ...Object.values(p), ...Object.values(o)]) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('invalid numeric assumption');
  }
  if (o.fixed_monthly_high < o.fixed_monthly_low || o.session_hard_cap === 0) throw new Error('invalid operating range');
  const billedSeconds = s.user_audio_seconds_per_turn.reduce((n, v) => n + Math.max(v, p.stt_min_seconds_per_request), 0);
  const userMinutes = s.user_audio_seconds_per_turn.reduce((n, v) => n + v, 0) / 60;
  const stt = billedSeconds / 3600 * p.stt_per_hour;
  const llm = (s.llm_input_tokens * p.llm_input_per_million + s.llm_output_tokens * p.llm_output_per_million) / 1e6;
  const tts = s.tts_characters / 1e6 * p.tts_per_million_characters;
  const baseline = stt + llm + tts;
  const billedTtsChars = Math.max(0, sessions * s.tts_characters - (applyTtsFreeTier ? p.tts_monthly_free_characters : 0));
  const monthlyApi = sessions * (stt + llm) + billedTtsChars / 1e6 * p.tts_per_million_characters;
  const reservedMonthly = monthlyApi * (1 + o.overhead_fraction);
  return {
    assumption_date: a.as_of, measured: false, sessions, tts_free_tier_applied: applyTtsFreeTier,
    per_session: {stt, llm, tts, baseline, billed_stt_seconds: billedSeconds},
    streaming_per_session: {
      active_audio_promo: userMinutes * p.streaming_stt_promo_per_minute + llm + s.tts_characters / 1e6 * p.streaming_tts_per_million_characters,
      active_audio_regular: userMinutes * p.streaming_stt_regular_per_minute + llm + s.tts_characters / 1e6 * p.streaming_tts_per_million_characters,
      full_session_regular: s.wall_minutes * p.streaming_stt_regular_per_minute + llm + s.tts_characters / 1e6 * p.streaming_tts_per_million_characters
    },
    monthly: {api: monthlyApi, api_with_reserve: reservedMonthly, total_low: reservedMonthly + o.fixed_monthly_low, total_high: reservedMonthly + o.fixed_monthly_high},
    conservative_reservation_slots: Math.floor(o.monthly_api_budget / o.session_hard_cap),
    caveat: 'Arithmetic estimate, not measured capacity, a vendor quote, or all-in business cost.'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assumptions = JSON.parse(fs.readFileSync(path.join(root, 'docs/cost-assumptions.json'), 'utf8'));
  const raw = process.argv.find(x => x.startsWith('--sessions='));
  console.log(JSON.stringify(calculate(assumptions, raw ? Number(raw.split('=')[1]) : 1000, process.argv.includes('--tts-free-tier')), null, 2));
}
