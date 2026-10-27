// Gemini 실키 스모크 테스트 (합성 텍스트만 사용, 개인정보 없음)
// 사용: node tools/gemini-smoke.mjs
import { loadDotEnv } from '../src/env.js';

const env = loadDotEnv(process.cwd());
const key = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY not found in .env'); process.exit(2); }

const base = 'https://generativelanguage.googleapis.com/v1beta';
const h = { 'x-goog-api-key': key };

async function listModels() {
  const res = await fetch(`${base}/models?pageSize=200`, { headers: h });
  const data = await res.json();
  if (!res.ok) { console.error('listModels failed', res.status, data?.error?.message); return []; }
  return (data.models || []).map((m) => ({
    id: m.name.replace(/^models\//, ''),
    methods: m.supportedGenerationMethods || [],
  }));
}

const models = await listModels();
console.log(`models visible: ${models.length}`);
const interesting = models.filter((m) => /gemini-(2\.5|3|4)|transcribe|embedding/i.test(m.id));
console.log('relevant:');
for (const m of interesting.slice(0, 40)) console.log(` - ${m.id} [${m.methods.join(',')}]`);

const candidates = ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];
for (const model of candidates) {
  const known = models.find((m) => m.id === model);
  if (!known || !known.methods.includes('generateContent')) { console.log(`skip ${model}: not available`); continue; }
  const t0 = Date.now();
  const res = await fetch(`${base}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: '합성 테스트입니다. JSON {"ok":true,"ko":"면접"}' }] }],
      generationConfig: { maxOutputTokens: 200, temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  const data = await res.json();
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`FAIL ${model} ${res.status} ${data?.error?.status || ''} ${String(data?.error?.message || '').slice(0, 120)} (${ms}ms)`);
    continue;
  }
  const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  const u = data?.usageMetadata || {};
  console.log(`OK ${model} ${ms}ms tokens(in=${u.promptTokenCount ?? '?'},out=${u.candidatesTokenCount ?? '?'}) text=${JSON.stringify(txt.slice(0, 80))}`);
}

const sttCandidates = ['gemini-3.5-transcribe', 'gemini-2.5-flash'];
for (const m of sttCandidates) {
  const known = models.find((x) => x.id === m);
  console.log(`stt candidate ${m}: ${known ? `present [${known.methods.join(',')}]` : 'not listed'}`);
}
