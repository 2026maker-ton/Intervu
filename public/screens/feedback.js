import { $, $$, basisTag, downloadJson, esc, fmtDate } from '../core/format.js';
import { dimLabel, rubricNote, typeLabel, FIXED } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { askConfirm, askInput, dialog } from '../core/dialog.js';
import { api } from '../core/api.js';
import { resetFlow, state } from '../core/state.js';
import { go } from '../core/router.js';
import { runComparison, startPractice } from './repractice.js';

// ---- 6. 피드백 ----
export async function loadReport({ attempt = 0 } = {}) {
  if (!state.session) { go('dashboard'); return; }
  go('feedback');
  const body = $('#feedbackBody');
  if (body) body.innerHTML = '<div class="skeleton" role="status">코칭 보고서를 준비하고 있습니다…</div>';
  try {
    const r = await api(`/sessions/${state.session.id}/report`);
    if (r.status === 'pending' && attempt < 8) {
      if (body) body.innerHTML = `<div class="skeleton" role="status">보고서를 만드는 중입니다… (${attempt + 1}/8)</div>`;
      setTimeout(() => loadReport({ attempt: attempt + 1 }), 1200);
      return;
    }
    if (r.status !== 'ready') { failedState(body, r.status === 'pending' ? '보고서 생성이 오래 걸리고 있습니다. 답변은 보존되어 있습니다.' : (r.detail || '답변은 보존되어 있습니다. 다시 시도할 수 있습니다.')); return; }
    state.lastReport = r;
    renderReport(r);
    if (state.flow === 'repractice' && state.transfer?.transfer_id) {
      await runComparison(state.transfer.transfer_id, state.session.id);
    }
  } catch (err) { failedState(body, err.message); }
}

function failedState(body, msg) {
  if (!body) return;
  body.innerHTML = `<div class="empty-state"><h2>보고서를 만들지 못했습니다</h2><p>${esc(msg)}</p><div class="actions"><button class="primary" type="button" id="retryReportBtn">다시 시도</button><button class="ghost" type="button" data-go="dashboard">대시보드로</button></div></div>`;
  $('#retryReportBtn')?.addEventListener('click', () => loadReport());
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

export function renderReport(r) {
  const body = $('#feedbackBody');
  if (!body) return;
  const badge = $('#feedbackBadge');
  if (badge) badge.textContent = `Feedback · ${typeLabel(r.interview_type)} · ${r.rubric_version || ''}`;
  const inst = r.institution ? `
    <div class="inst-head"><strong>${esc(r.institution.org_label || '')} ${esc(r.institution.target_name || '')} · ${esc(r.institution.role || '')}</strong><span class="tag ${r.institution.fallback_to_general ? '' : 'official'}">${esc(r.institution.badge || '')}</span></div>
    <p class="fine">${esc(r.institution.disclaimer || '기관의 비공개 채점기준을 아는 것처럼 표현하지 않습니다.')}</p>` : '';
  const dims = (r.dimensions || []).map((d) => {
    const scored = d.status === 'scored';
    const ev = (d.evidence || []).map((e) => `
      <li>
        <q>${esc(e.quote)}</q>
        <span class="meta">답변 수준 ${esc(String(e.answer_level))}${e.turn_id ? ` · turn ${esc(String(e.turn_id).slice(0, 8))} · rev ${esc(String(e.revision ?? 1))}` : ''}</span>
        ${e.turn_id ? `<button class="ghost tiny" type="button" data-revise-turn="${esc(e.turn_id)}">전사 교정</button>` : ''}
      </li>`).join('');
    return `<details class="dim ${scored ? '' : 'abstain'}">
      <summary class="dim-head"><span class="dim-name">${esc(dimLabel(d.id))}</span><span class="level ${scored ? '' : 'abstain'}">${scored ? `${esc(String(d.level))} / 4` : '판단 보류'}</span></summary>
      <p>${esc(d.observation)}</p>
      ${scored ? `<ul class="evidence">${ev}</ul>` : `<p class="fine">${esc(d.abstention_reason || '관찰 근거가 부족해 수준을 공개하지 않습니다.')}</p>`}
      <button class="ghost tiny" type="button" data-appeal-dim="${esc(d.id)}">이의 제기</button>
    </details>`;
  }).join('');
  const actions = (r.next_actions || []).map((a) => `
    <div class="action-card">
      <h3>다음 답변에서 할 행동 · ${esc(dimLabel(a.dimension_id))}</h3>
      <p>${esc(a.action)}</p>
      <p class="fine">재연습 질문 예시: ${esc(a.practice_question)}</p>
      <button class="primary small" type="button" data-practice="${esc(a.dimension_id)}">같은 역량의 새 질문으로 재연습</button>
    </div>`).join('');
  const scoredCount = (r.dimensions || []).filter((d) => d.status === 'scored').length;
  const transferReady = (r.dimensions || []).some((d) => d.status === 'scored');
  body.innerHTML = `
    <div class="card report">
      ${inst}
      <div class="report-head"><span class="tag evaluator-chip">${esc(evaluatorLabel(r.evaluator))}</span><span class="tag">${esc(typeLabel(r.interview_type))}</span><span class="tag">${esc(r.rubric_version || '')}</span></div>
      <p class="fine">각 수준은 해당 답변에서 관찰된 정도이며 합격 가능성이 아닙니다. 검증된 AI 채점이나 사람 평가자를 대체하지 않습니다. ${esc(rubricNote(r.interview_type))}</p>
      ${renderHero(r)}
      ${renderClaimLinks(r.claim_links)}
      ${renderInstitutionLink(r.institution_link)}
      <section><h2>차원별 상세</h2>${scoredCount < (r.dimensions || []).length ? '<p class="hint">판단 보류가 있는 차원은 답변이 더 필요합니다.</p>' : ''}${dims || '<p class="hint">평가할 수 있는 답변이 없습니다.</p>'}</section>
      ${actions ? `<section class="actions-wrap"><details><summary>다른 다음 행동 보기</summary>${actions}</details></section>` : ''}
      ${transferReady ? `
        <div class="action-card transfer-card">
          <h3>새 질문에서 개선 확인</h3>
          <p class="fine">같은 역량을 묻는 처음 보는 질문으로 다시 답한 뒤, 같은 루브릭에서 두 답변의 발언 근거를 나란히 비교합니다. 증거가 부족하면 판단을 보류합니다.</p>
          <div id="transferBox"></div>
        </div>` : ''}
      <div class="actions">
        <button class="ghost" id="copyBtn" type="button">텍스트로 복사</button>
        <button class="ghost" id="exportBtn" type="button">JSON 내보내기</button>
        <button class="ghost" id="appealStatusBtn" type="button">이의 처리 상태</button>
        <button class="danger" id="deleteBtn" type="button">이 세션 삭제</button>
      </div>
      <p class="fine">참고용 코칭이며 실제 합격 가능성이나 사람의 성격을 평가하지 않습니다.</p>
    </div>`;

  $('#copyBtn')?.addEventListener('click', async () => {
    const text = (r.dimensions || []).map((d) => `${dimLabel(d.id)}: ${d.status === 'scored' ? `${d.level}/4` : '판단 보류'} — ${d.observation}`).join('\n');
    try {
      await navigator.clipboard.writeText(`Intervu 코칭 (${typeLabel(r.interview_type)})\n${text}\n\n※ 규칙 기반 참고 관찰, 합격 예측 아님`);
      toast('복사했습니다.');
    } catch { toast('복사에 실패했습니다.', true); }
  });

  $('#exportBtn')?.addEventListener('click', async () => {
    try {
      const ex = await api('/exports', { method: 'POST', idempotent: true, body: { session_id: state.session.id, format: 'json' } });
      const payload = await api(`/exports/${ex.job_id}`);
      downloadJson(payload, `intervu-report-${state.session.id}.json`);
      toast('JSON으로 내보냈습니다.');
    } catch (err) { toast(err.message, true); }
  });

  $$('[data-revise-turn]').forEach((b) => b.addEventListener('click', async () => {
    const turnId = b.dataset.reviseTurn;
    const text = await askInput('전사 교정', '원문은 유지되고 새 revision으로 기록됩니다. 기존 보고서는 그대로 보존됩니다.', '교정된 전사', '', true);
    if (!text) return;
    try {
      const out = await api(`/turns/${turnId}/revisions`, { method: 'POST', idempotent: true, body: { base_revision: 1, text, reason: 'stt_correction' } });
      toast(`전사 교정을 저장했습니다 (revision ${out.revision}).`);
    } catch (err) { toast(err.message, true); }
  }));

  $$('[data-appeal-dim]').forEach((ab) => ab.addEventListener('click', async () => {
    const category = await dialog({
      title: '이의 제기 1/2',
      message: '어떤 종류의 문제인가요? stt(오인식) / fact(사실) / evidence(근거) / inappropriate(부적절)',
      label: '유형', value: 'stt', okText: '다음',
    });
    if (!category) return;
    const cat = category.trim();
    if (!['stt', 'fact', 'evidence', 'inappropriate'].includes(cat)) { toast('유형이 올바르지 않습니다.', true); return; }
    const comment = await askInput('이의 제기 2/2', '어떤 점이 잘못되었는지 적어 주세요. (최대 500자)', '설명', '', true);
    if (comment === null) return;
    try {
      const out = await api(`/evaluations/${r.evaluation_id}/appeals`, { method: 'POST', idempotent: true, body: { category: cat, comment: comment.slice(0, 500) } });
      await dialog({ title: '이의 접수 완료', message: `접수 ID: ${out.appeal_id}\n처리 목표 3영업일(운영 목표). 아래 ID로 상태를 확인할 수 있습니다.`, okText: '확인' });
      toast('이의를 접수했습니다.');
    } catch (err) { toast(err.message, true); }
  }));

  $('#appealStatusBtn')?.addEventListener('click', async () => {
    const id = await askInput('이의 처리 상태', '접수 ID를 입력하세요.', '접수 ID');
    if (!id) return;
    checkAppeal(id);
  });

  $('#deleteBtn')?.addEventListener('click', async () => {
    const ok = await askConfirm('세션 삭제', '이 세션의 답변과 코칭 보고서를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '삭제' });
    if (!ok) return;
    try {
      const d = await api(`/sessions/${state.session.id}`, { method: 'DELETE', idempotent: true });
      toast(`삭제했습니다. 백업 만료: ${d.backup_expiry || '최장 30일'}`);
      resetFlow();
      go('dashboard');
    } catch (err) { toast(err.message, true); }
  });

  $$('[data-practice]').forEach((b) => b.addEventListener('click', () => startPractice(b.dataset.practice)));
  renderTransferBox(r);
}

function evaluatorLabel(ev) {
  if (!ev || ev.kind === 'rule_based') return '규칙 기반 참고 관찰';
  return ev.kind === 'llm' ? FIXED.evaluatorLlm : `AI 분석(검증 중) · ${ev.provider || ''}${ev.model_alias ? ` · ${ev.model_alias}` : ''}`;
}

// 가장 먼저 바꿀 것 1개: 실제로 한 말 -> 부족한 부분 -> 행동 1개 -> 재연습 CTA
function renderHero(r) {
  const a = (r.next_actions || [])[0];
  if (!a) return '<p class="hint">개선 행동을 제안할 만큼 관찰된 차원이 없습니다. 답변을 더 남기면 근거가 늘어납니다.</p>';
  const d = (r.dimensions || []).find((x) => x.id === a.dimension_id);
  const quote = d?.evidence?.[0]?.quote;
  return `<section class="hero-card">
    <p class="eyebrow">가장 먼저 바꿀 것 1개 · ${esc(dimLabel(a.dimension_id))}</p>
    <p class="hero-row"><strong>실제로 한 말</strong> ${quote ? `<q>${esc(quote)}</q>` : '<span class="fine">인용할 발언이 없습니다.</span>'}</p>
    <p class="hero-row"><strong>부족한 부분</strong> ${esc(d?.observation || '')}</p>
    <p class="hero-row"><strong>다음 행동 1개</strong> ${esc(a.action)}</p>
    <button class="primary" type="button" data-practice="${esc(a.dimension_id)}">이 역량으로 새 질문 재연습</button>
  </section>`;
}

export function renderClaimLinks(links) {
  if (!links?.length) return '';
  const rows = links.map((l) => `<li><span class="val">“${esc(l.quote)}”</span><span class="tag user">지원서 주장</span><span class="meta">${l.answered ? `실제 답변: “${esc((l.answers?.[0]?.excerpt) || '')}”` : '이번 면접에서 질문되지 않았습니다.'}</span></li>`).join('');
  return `<section><h2>지원서 주장과 실제 답변</h2><p class="hint">지원서 문장과 면접 답변을 나란히 보여줄 뿐 사실 여부를 판정하지 않습니다.</p><ul class="claims">${rows}</ul></section>`;
}

export function renderInstitutionLink(link) {
  if (!link || link.mode === 'general') return '';
  const rows = (link.links || []).map((l) => `<li><span class="val">${esc(l.requirement)}</span>${basisTag(l.basis)}<span class="meta">${esc(l.note || '')}${l.observed_with_evidence ? '' : ' · 근거 보완 필요'}</span></li>`).join('');
  const uncovered = (link.uncovered || []).map((u) => `<li><span class="val">${esc(u.requirement)}</span><span class="tag">미관찰</span><span class="meta">${esc(u.note || '')}</span></li>`).join('');
  return `<section><h2>기관 요구와 답변의 연결</h2><p class="hint">${esc(link.note || '')}</p><ul class="claims">${rows || '<li>연결된 요구 없음</li>'}${uncovered}</ul></section>`;
}

export function renderTransferBox(r) {
  const box = $('#transferBox');
  if (!box) return;
  if (state.comparison) {
    box.innerHTML = '<p class="hint">이미 비교한 재연습이 있습니다.</p><button class="ghost small" type="button" data-go="repractice">비교 결과 보기</button>';
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    return;
  }
  box.innerHTML = `<p class="hint">위의 “새 질문으로 재연습”을 누르면 같은 역량의 다른 질문으로 이동합니다. 재연습을 마치면 비교가 자동으로 준비됩니다.</p>`;
  void r;
}

export async function checkAppeal(id) {
  try {
    const a = await api(`/appeals/${encodeURIComponent(id)}`);
    toast(`이의 ${a.status} · 유형 ${a.category} · 접수 ${fmtDate(a.created_at)}`);
  } catch (err) { toast(err.message, true); }
}

