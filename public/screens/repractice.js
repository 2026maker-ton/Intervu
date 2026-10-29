import { $, $$, esc, setError, uuid } from '../core/format.js';
import { dimLabel } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { enterRoom } from './room.js';

// ---- 7. 재연습 비교 ----
export async function startPractice(competency) {
  const r = state.lastReport;
  if (!r?.evaluation_id) { toast('먼저 코칭 보고서가 필요합니다.', true); return; }
  try {
    const p = await api('/practice-attempts', { method: 'POST', idempotent: true, body: { evaluation_id: r.evaluation_id, competency_id: competency } });
    state.transfer = p;
    state.comparison = null;
    state.flow = 'repractice';
    state.practiceSession = { id: p.id, version: p.version };
    state.repracticeStarted = false;
    go('repractice');
    const body = $('#repracticeBody');
    if (body) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, true);
  }
}

export function renderRepractice() {
  const box = $('#repracticeBody');
  if (!box) return;
  const p = state.transfer;
  if (!p) {
    box.innerHTML = `<div class="empty-state"><h2>재연습할 역량이 없습니다</h2><p>피드백 화면에서 “같은 역량의 새 질문으로 재연습”을 눌러 시작하세요.</p><button class="ghost" type="button" data-go="feedback">피드백으로</button></div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    return;
  }
  const cmp = state.comparison;
  const started = !!state.repracticeStarted;
  box.innerHTML = `
    <div class="compare-grid">
      <article class="card compare-card baseline">
        <p class="eyebrow">1차 · 기준 답변</p>
        <h2>이전 질문</h2>
        <p>${esc(p.baseline_question || '기준 질문 없음')}</p>
        ${p.baseline_excerpt ? `<blockquote>“${esc(p.baseline_excerpt)}”</blockquote>` : '<p class="fine">기준 답변 발췌가 없습니다.</p>'}
      </article>
      <article class="card compare-card target">
        <p class="eyebrow">2차 · 같은 역량, 새 질문</p>
        <h2>지금 질문</h2>
        <p><strong>${esc(p.transfer_question?.text || '')}</strong></p>
        <p class="fine">${esc(p.transfer_question?.novelty_guard || '')}</p>
        <p class="fine">역량: ${esc(dimLabel(p.competency_id))} · 루브릭: ${esc(p.rubric_version || '')}</p>
      </article>
    </div>
    <div class="card">
      <div class="card-head">
        <h2>진행</h2>
        <span class="state-badge ${started ? 'ok' : 'warn'}">${started ? '재연습 진행/완료' : '시작 전'}</span>
      </div>
      ${started
        ? `<p class="hint">재연습 답변을 제출하면 같은 루브릭으로 비교가 자동 생성됩니다.</p>
           <div class="actions"><button class="ghost" type="button" data-go="feedback">재연습 코칭 보기</button><button class="ghost" type="button" id="restartCompareBtn">다른 역량으로 다시 고르기</button></div>`
        : `<p class="hint">같은 역량을 묻지만 문면이 다른 질문입니다. 이전 답변과 같은 사례를 반복하지 말고 다른 상황·선택을 설명하세요.</p>
           <div class="actions"><button class="primary" type="button" id="startRepracticeBtn">재연습 시작 (90초)</button><button class="ghost" type="button" data-go="feedback">피드백으로</button></div>`}
      <p class="fine" id="repracticeError" role="alert"></p>
    </div>
    <div id="comparisonBox">${cmp ? renderComparisonHtml(cmp) : ''}</div>`;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#startRepracticeBtn')?.addEventListener('click', startRepractice);
  $('#restartCompareBtn')?.addEventListener('click', () => go('feedback'));
}

export async function startRepractice() {
  const p = state.transfer;
  if (!p) return;
  const btn = $('#startRepracticeBtn');
  if (btn) { btn.disabled = true; btn.textContent = '준비 중…'; }
  try {
    const started = await api(`/sessions/${p.id}/commands`, {
      method: 'POST', idempotent: true,
      body: { command_id: uuid(), expected_version: state.practiceSession.version, type: 'session.start', payload: {} },
    });
    state.practiceSession.version = started.version;
    state.session = { id: p.id, version: started.version };
    state.type = 'general';
    state.flow = 'repractice';
    state.repracticeStarted = true;
    enterRoom({
      started,
      session: { limits: { duration_seconds: p.limits?.duration_seconds || 90, duration_minutes: 2 }, interview_type: 'general' },
      inputMode: 'text',
      durationSeconds: p.limits?.duration_seconds || 90,
      meta: '재연습 · 같은 역량의 새 질문',
    });
  } catch (err) {
    setError('#repracticeError', err.message);
    if (btn) { btn.disabled = false; btn.textContent = '재연습 시작 (90초)'; }
  }
}

export async function runComparison(transferId, retrySessionId) {
  try {
    const out = await api('/transfer-comparisons', { method: 'POST', idempotent: true, body: { transfer_id: transferId, retry_session_id: retrySessionId } });
    state.comparison = out;
    const box = $('#comparisonBox');
    if (box) box.innerHTML = renderComparisonHtml(out);
    else { renderRepractice(); }
    go('repractice');
  } catch (err) {
    const box = $('#comparisonBox');
    if (box) box.innerHTML = `<div class="card"><h2>비교를 만들지 못했습니다</h2><p class="missing">${esc(err.message)}</p></div>`;
  }
}

export function renderComparisonHtml(out) {
  const c = out.comparison || {};
  const ev = (c.evidence || []).map((e) => `
    <li>
      <span class="val">${e.attempt === 'baseline' ? '1차 답변' : '재연습 답변'}</span>
      <span class="meta">질문: ${esc(e.question || '')}<br />발언: “${esc(e.quote || '')}”</span>
    </li>`).join('');
  const statusLabel = {
    observed_change: '관찰된 변화',
    no_clear_change: '뚜렷한 변화 없음',
    insufficient_evidence: '판단 보류',
  }[c.status] || c.status;
  return `
    <div class="card comparison">
      <div class="card-head">
        <h2>비교 결과</h2>
        <span class="state-badge ${c.status === 'observed_change' ? 'ok' : c.status === 'no_clear_change' ? 'warn' : ''}">${esc(statusLabel || '')}</span>
      </div>
      <p><strong>${esc(c.headline || c.reason || '')}</strong></p>
      <p class="fine">역량: ${esc(dimLabel(out.competency || c.competency || ''))} · 루브릭: ${esc(c.rubric_version || out.rubric_version || '')}${Number.isFinite(c.delta) ? ` · 관찰 수준 차이: ${esc(String(c.delta))}` : ''}</p>
      ${ev ? `<ul class="claims">${ev}</ul>` : '<p class="hint">비교할 발언 근거가 부족합니다.</p>'}
      ${c.caution ? `<p class="fine">${esc(c.caution)}</p>` : ''}
      <p class="fine">이 비교는 단일 재연습 결과이며 학습 효과를 입증하지 않습니다.</p>
    </div>`;
}
