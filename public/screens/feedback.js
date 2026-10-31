// 면접 결과: 차트(실시간 참고 점수·대학 역량 적합성·평가 차원·음성 지표) + 질문·답변 본문(꼬리질문 구분, i 버튼 근거) + 다음 행동.
// 차트는 라이브러리 없이 인라인 SVG로 그리고, 같은 숫자를 화면 낭독기용 표로도 둔다.
import { $, $$, esc } from '../core/format.js';
import { dimLabel, FIXED, STAGE_LABEL } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { EvidenceQuote } from '../ui/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function loadReport() {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await api(`/sessions/${state.session.id}/report`);
      if (r.status === 'ready') { state.lastReport = r; go('feedback'); renderReport(r); return; }
      if (r.status === 'failed') { toast(r.detail || '결과를 만들지 못했습니다.', true); return go('dashboard'); }
    } catch (err) { toast(err.message, true); return go('dashboard'); }
    await sleep(1200);
  }
  toast('결과 생성이 늦어지고 있습니다. 잠시 후 대시보드에서 다시 열어 주세요.', true);
  go('dashboard');
}

const SCORE_KEYS = [['relevance', '질문 적합성'], ['specificity', '구체성'], ['reasoning', '논리']];
const srTable = (caption, head, rows) => `<table class="sr-only"><caption>${esc(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(String(c))}</td>` : `<th scope="row">${esc(String(c))}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
const turnLabel = (t, i, list) => { const n = list.slice(0, i + 1).filter((x) => !x.is_followup).length; return t.is_followup ? `Q${n} 꼬리` : `Q${n}`; };

// A. 실시간 참고 점수: 답변별 3개 막대(1~4). 꼬리질문 답변은 빗금.
function scoreChart(tr) {
  const rows = tr.filter((t) => t.turn_score);
  if (!rows.length) return '';
  const W = Math.max(320, rows.length * 72 + 40); const H = 180; const base = 150; const unit = 30;
  const bars = rows.map((t, i) => {
    const x0 = 40 + i * 72;
    const b = SCORE_KEYS.map(([k], j) => { const v = t.turn_score[k] || 0; return `<rect class="bar s${j}${t.is_followup ? ' followup' : ''}" x="${x0 + j * 18}" y="${base - v * unit}" width="16" height="${v * unit}"><title>${esc(SCORE_KEYS[j][1])} ${v}</title></rect>`; }).join('');
    return `${b}<text class="axis" x="${x0 + 26}" y="${base + 18}" text-anchor="middle">${esc(turnLabel(t, tr.indexOf(t), tr))}</text>`;
  }).join('');
  const grid = [1, 2, 3, 4].map((v) => `<line class="grid" x1="32" x2="${W - 8}" y1="${base - v * unit}" y2="${base - v * unit}"/><text class="axis" x="26" y="${base - v * unit + 4}" text-anchor="end">${v}</text>`).join('');
  return `<figure class="chart"><figcaption>답변별 참고 점수 <span class="chip-note">${esc(FIXED.scoreLabel)}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="답변별 참고 점수 막대 차트">${grid}${bars}</svg>
    <p class="legend">${SCORE_KEYS.map(([, l], j) => `<span><i class="sw s${j}"></i>${esc(l)}</span>`).join('')}<span><i class="sw followup"></i>꼬리질문 답변</span></p>
    ${srTable('답변별 참고 점수', ['답변', ...SCORE_KEYS.map((k) => k[1])], rows.map((t) => [turnLabel(t, tr.indexOf(t), tr), ...SCORE_KEYS.map(([k]) => t.turn_score[k])]))}</figure>`;
}

// B1. 대학 역량 적합성: 역량별 평균 참고 점수(0~4). 0은 답변에서 다루지 않은 역량.
function fitChart(fit) {
  if (!fit?.length) return '';
  const rows = fit.map((c) => `<div class="hbar"><span class="hbar-label">${esc(c.label)}</span><span class="hbar-track"><span class="hbar-fill${c.answers ? '' : ' empty'}" style="width:${(c.avg_score / 4) * 100}%"></span></span><span class="hbar-val">${c.answers ? `${c.avg_score} · 답변 ${c.answers}개` : '다루지 않음'}</span></div>`).join('');
  return `<figure class="chart"><figcaption>대학 역량 적합성 <span class="chip-note">${esc(FIXED.fitLabel)}</span></figcaption>${rows}
    ${srTable('대학 역량 적합성', ['역량', '평균 참고 점수', '관련 답변 수'], fit.map((c) => [c.label, c.avg_score, c.answers]))}</figure>`;
}

// B2. 평가 차원 레이더(1~4, 판단 보류는 0).
function radar(dims) {
  const ds = (dims || []).slice(0, 6);
  if (ds.length < 3) return '';
  const C = 110; const R = 80; const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / ds.length;
  const pt = (i, r) => `${(C + Math.cos(ang(i)) * r).toFixed(1)},${(C + Math.sin(ang(i)) * r).toFixed(1)}`;
  const rings = [1, 2, 3, 4].map((v) => `<polygon class="grid" points="${ds.map((_, i) => pt(i, (R * v) / 4)).join(' ')}"/>`).join('');
  const val = (d) => (d.status === 'scored' ? Number(d.level) || 0 : 0);
  const shape = `<polygon class="area" points="${ds.map((d, i) => pt(i, (R * val(d)) / 4)).join(' ')}"/>`;
  // 좌우 라벨은 바깥쪽으로 정렬하고 viewBox 양옆에 여백을 둬 글자가 잘리지 않게 한다.
  const labels = ds.map((d, i) => {
    const [x, y] = pt(i, R + 12).split(','); const c = Math.cos(ang(i));
    const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
    return `<text class="axis" x="${x}" y="${Number(y) + 4}" text-anchor="${anchor}">${esc(dimLabel(d.id))}</text>`;
  }).join('');
  return `<figure class="chart"><figcaption>답변 차원별 관찰</figcaption><svg viewBox="-80 4 380 216" role="img" aria-label="평가 차원 레이더 차트">${rings}${shape}${labels}</svg>
    ${srTable('답변 차원별 관찰', ['차원', '수준'], ds.map((d) => [dimLabel(d.id), d.status === 'scored' ? `${d.level} / 4` : FIXED.abstain]))}</figure>`;
}

// B3. 음성 참고 지표(답변 평균).
function voiceChart(tr) {
  const v = tr.map((t) => t.voice_metrics).filter(Boolean);
  if (!v.length) return '';
  const avg = (k) => v.reduce((s, x) => s + (x[k] || 0), 0) / v.length;
  const rows = [['발화 비율', avg('speech_ratio'), 1, (x) => `${Math.round(x * 100)}%`], ['최장 정적', avg('longest_silence_seconds'), 10, (x) => `${x.toFixed(1)}초`], ['음량 변동', avg('volume_cv'), 1.5, (x) => x.toFixed(2)], ['목소리 떨림', avg('pitch_jitter'), 0.2, (x) => x.toFixed(3)]];
  return `<figure class="chart"><figcaption>음성 <span class="chip-note">${esc(FIXED.voiceLabel)}</span></figcaption>${rows.map(([l, x, max, f]) => `<div class="hbar"><span class="hbar-label">${esc(l)}</span><span class="hbar-track"><span class="hbar-fill alt" style="width:${Math.min(100, (x / max) * 100)}%"></span></span><span class="hbar-val">${esc(f(x))}</span></div>`).join('')}</figure>`;
}

// 답변별 음성: 음량 그래프(그 답변의 최대 음량 대비) + 아래 띠에 실제 답변 구간(초록)·중간 정적 구간(주황).
const fmtS = (x) => `${Number(x).toFixed(1)}초`;
function voiceTimelineChart(tl, idx) {
  if (!tl?.envelope?.length || !tl.total_seconds) return '';
  const W = 600; const H = 60; const T = tl.total_seconds; const n = tl.envelope.length;
  const X = (sec) => (sec / T) * W;
  const pts = tl.envelope.map((v, i) => `${(((i + 0.5) / n) * W).toFixed(1)},${(H - (v / 100) * (H - 4)).toFixed(1)}`).join(' ');
  const segs = tl.segments.map((g) => `<rect class="seg ${g.k}" x="${X(g.s).toFixed(1)}" y="${H + 6}" width="${Math.max(1, X(g.e) - X(g.s)).toFixed(1)}" height="12"><title>${g.k === 'speech' ? '답변' : '정적'} ${fmtS(g.s)}~${fmtS(g.e)}</title></rect>`).join('');
  const speech = tl.segments.filter((g) => g.k === 'speech'); const pauses = tl.segments.filter((g) => g.k === 'pause');
  const spoken = speech.reduce((a, g) => a + g.e - g.s, 0);
  const paused = pauses.reduce((a, g) => a + g.e - g.s, 0);
  return `<figure class="voice-tl"><figcaption>음량과 구간 <span class="chip-note">${esc(FIXED.voiceLabel)}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H + 20}" preserveAspectRatio="none" role="img" aria-label="답변 음량 그래프와 답변·정적 구간"><polygon class="vol-area" points="0,${H} ${pts} ${W},${H}"/><rect class="seg-track" x="0" y="${H + 6}" width="${W}" height="12"/>${segs}</svg>
    <p class="legend"><span><i class="sw seg-speech"></i>실제 답변 ${fmtS(spoken)}</span><span><i class="sw seg-pause"></i>중간 정적 ${pauses.length}회 · ${fmtS(paused)}</span><span class="meta">녹음 ${fmtS(T)}</span></p>
    ${srTable(`답변 ${idx + 1} 구간`, ['구간', '시작', '끝'], tl.segments.map((g) => [g.k === 'speech' ? '답변' : '정적', fmtS(g.s), fmtS(g.e)]))}</figure>`;
}

function evidenceList(ev) {
  if (!ev?.length) return '<p class="meta">이 질문은 학과 정보로 만든 기본 질문입니다.</p>';
  return `<ul class="plain">${ev.map((e) => (e.kind === 'application'
    ? `<li><span class="tag user">지원서</span> <q>${esc(e.quote)}</q></li>`
    : `<li><span class="tag">${esc(e.status === 'user_supplied' ? '직접 입력 역량' : e.status === 'ai_search' ? FIXED.aiSearch : '대학 인재상')}</span> ${esc(e.label)}${e.quote ? ` <q>${esc(e.quote)}</q>` : ''}${e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">출처</a>` : ''}</li>`)).join('')}</ul>`;
}

function transcriptHtml(tr) {
  return tr.map((t, i) => `<article class="qa${t.is_followup ? ' followup' : ''}">
    <header class="qa-head">${t.is_followup ? '<span class="stage-chip alt">꼬리질문</span>' : `<span class="stage-chip">${esc(STAGE_LABEL[t.stage] || t.stage_label || '')}</span>`}
      <p class="qa-q">${esc(t.question_text)}</p>
      ${t.is_followup ? '' : `<button class="icon-btn info" type="button" aria-label="근거 보기" aria-expanded="false" aria-controls="ev-${i}">i</button>`}</header>
    ${t.is_followup ? '' : `<div class="qa-evidence" id="ev-${i}" hidden>${evidenceList(t.evidence)}</div>`}
    <p class="qa-a">${esc(t.answer_text)}</p>
    ${voiceTimelineChart(t.voice_metrics?.timeline, i)}
    ${t.cut_off ? '<p class="meta">제한시간 초과</p>' : ''}
  </article>`).join('');
}

// 세부 정보(결과 맨 뒤, 읽기 전용): 면접 질문의 바탕이 된 지원서 근거와 확정된 질문 목록.
const GAP = { role: '본인 역할', result: '관찰된 결과', reason: '판단 기준', number: '수치·기록' };
function claimsHtml(list) {
  const rows = (list || []).filter((c) => !c.kind || c.kind === 'applicant_claim');
  if (!rows.length) return '<p class="meta">경험·성과 문장을 찾지 못했습니다.</p>';
  return `<ul class="claims">${rows.map((c) => `<li class="claim-item${c.excluded ? ' excluded' : ''}">${EvidenceQuote({ quote: c.quote, start: c.start_cp, end: c.end_cp })}${c.gaps?.length ? `<span class="meta">빠진 정보: ${c.gaps.map((g) => `<span class="tag">${esc(GAP[g] || g)}</span>`).join(' ')}</span>` : ''}</li>`).join('')}</ul>`;
}
function planHtml(plan) {
  const st = plan?.stages || [];
  if (!st.length) return '<p class="meta">질문 계획을 불러오지 못했습니다.</p>';
  return `<ol class="plan-list">${st.map((s) => `<li><span class="stage-chip">${esc(STAGE_LABEL[s.stage] || s.stage)}</span><span class="val">${esc(s.text)}</span>${s.evidence?.length ? `<span class="meta">근거: ${s.evidence.map((e) => esc(e.kind === 'application' ? `지원서 “${String(e.quote).slice(0, 30)}…”` : e.label)).join(', ')}</span>` : ''}</li>`).join('')}</ol>`;
}
async function loadDetail() {
  const id = state.profile?.id;
  const host = $('#reportDetail');
  if (!id || !host) return;
  const [cl, plan] = await Promise.all([api(`/profiles/${id}/claims`).catch(() => null), api(`/profiles/${id}/plan`).catch(() => null)]);
  if (!cl && !plan) { host.hidden = true; return; }
  host.hidden = false;
  host.querySelector('.detail-body').innerHTML = `<h3>지원서에서 확인한 내용</h3>${claimsHtml(cl?.claims)}<h3>면접 질문 목록</h3>${planHtml(plan)}`;
}

export function renderReport(r) {
  const body = $('#feedbackBody');
  if (!body) return;
  const llm = r.evaluator?.kind === 'llm';
  const inst = r.institution || {};
  const tr = r.transcript || [];
  const actions = (r.next_actions || []).slice(0, 3);
  body.innerHTML = `
    <div class="report-head card"><div><strong>${esc(inst.target_name || '')}</strong> <span class="meta">${esc(inst.role || '')}</span></div><span class="tag ${llm ? 'official' : ''}">${esc(llm ? `${r.evaluator?.provider === 'claude' ? 'Claude' : 'Gemini'} 분석 · 검증 전(참고용)` : FIXED.evaluator)}</span></div>
    <section class="report-charts">${scoreChart(tr)}${fitChart(r.competency_fit)}${radar(r.dimensions)}${voiceChart(tr)}</section>
    <section class="report-main" aria-labelledby="qaTitle"><h2 id="qaTitle">질문과 답변</h2>${tr.length ? transcriptHtml(tr) : '<p class="missing">기록된 답변이 없습니다.</p>'}</section>
    ${actions.length ? `<section class="card report-actions"><h2>다음 연습</h2><ol>${actions.map((a) => `<li><strong>${esc(dimLabel(a.dimension_id))}</strong> ${esc(a.action)}</li>`).join('')}</ol></section>` : ''}
    <div class="actions"><button class="primary" type="button" id="reportHomeBtn">처음으로</button></div>
    <details class="card report-detail" id="reportDetail" hidden><summary>세부 정보 · 지원서 근거와 질문 목록</summary><div class="detail-body"></div></details>`;
  loadDetail();
  $('#reportHomeBtn').addEventListener('click', () => go('dashboard'));
  $$('#feedbackBody .icon-btn.info').forEach((b) => b.addEventListener('click', () => {
    const panel = document.getElementById(b.getAttribute('aria-controls'));
    const open = panel.hidden;
    panel.hidden = !open; b.setAttribute('aria-expanded', String(open));
  }));
}
