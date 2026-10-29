// 규칙 엔진 주장 추출 정확도 측정(WP-C7). 문장 단위: 코퍼스 한 문장이 주장으로 추출되면 양성.
import fs from 'node:fs';
import { extractApplicantClaims } from '../../src/domain/claims.js';

export function measure() {
  const items = JSON.parse(fs.readFileSync(new URL('./claims-corpus.json', import.meta.url), 'utf8')).items;
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const fps = [], fns = [];
  for (const it of items) {
    const got = extractApplicantClaims(it.t, { bullets: true }).length > 0;
    if (got && it.label) tp += 1;
    else if (got) { fp += 1; fps.push(it.t); }
    else if (it.label) { fn += 1; fns.push(it.t); }
    else tn += 1;
  }
  return { n: items.length, tp, fp, fn, tn, precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1), fps, fns };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) console.log(JSON.stringify(measure(), null, 1));
