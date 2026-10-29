import { $, $$, downloadJson, esc, fmtDate, stateLabel } from '../core/format.js';
import { typeLabel } from '../core/copy.js';
import { toast } from '../core/toast.js';
import { askConfirm } from '../core/dialog.js';
import { api } from '../core/api.js';
import { resetFlow } from '../core/state.js';
import { go } from '../core/router.js';
import { openSession } from './dashboard.js';

// ---- 8. 기록·데이터 ----
export async function loadHistory() {
  const box = $('#historyBody');
  if (!box) return;
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const { sessions } = await api('/sessions');
    if (!sessions?.length) {
      box.innerHTML = '<div class="empty-state"><h2>아직 기록이 없습니다</h2><p>대시보드에서 첫 면접을 시작해 보세요.</p><button class="ghost" type="button" data-go="dashboard">대시보드로</button></div>';
      $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
      return;
    }
    box.innerHTML = sessions.map((s) => `
      <div class="list-item">
        <div>
          <strong>${esc(typeLabel(s.interview_type))} 면접</strong>
          <div class="meta">${esc(fmtDate(s.created_at))} · ${esc(String(s.question_count || 0))}문항 · ${esc(s.persona || '')} · ${esc(stateLabel(s.state))}${s.blind ? ' · 블라인드' : ''}</div>
        </div>
        <div class="list-actions">
          <span class="state-badge ${s.state === 'completed' ? 'ok' : ''}">${esc(stateLabel(s.state))}</span>
          <button class="ghost small" type="button" data-open-session="${esc(s.id)}" data-state="${esc(s.state)}">${s.state === 'completed' ? '코칭 보기' : '열기'}</button>
          <button class="ghost small danger-text" type="button" data-delete-session="${esc(s.id)}">삭제</button>
        </div>
      </div>`).join('');
    $$('[data-open-session]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.openSession, b.dataset.state)));
    $$('[data-delete-session]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await askConfirm('세션 삭제', '이 세션의 답변과 보고서를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '삭제' });
      if (!ok) return;
      try {
        await api(`/sessions/${b.dataset.deleteSession}`, { method: 'DELETE', idempotent: true });
        toast('삭제했습니다.');
        loadHistory();
      } catch (err) { toast(err.message, true); }
    }));
  } catch (err) {
    box.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}

$('#exportAllBtn')?.addEventListener('click', async () => {
  try {
    const ex = await api('/exports', { method: 'POST', idempotent: true, body: { format: 'json' } });
    const payload = await api(`/exports/${ex.job_id}`);
    downloadJson(payload, 'intervu-sessions.json');
    toast('기록 목록을 내보냈습니다.');
  } catch (err) { toast(err.message, true); }
});

$('#deleteAllBtn')?.addEventListener('click', async () => {
  const ok = await askConfirm('모든 세션 삭제', '이 계정의 모든 세션과 보고서를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '모두 삭제' });
  if (!ok) return;
  try {
    const { sessions } = await api('/sessions');
    for (const s of sessions || []) await api(`/sessions/${s.id}`, { method: 'DELETE', idempotent: true });
    $('#deleteAllResult').textContent = `${(sessions || []).length}개 세션을 삭제했습니다. (백업 최장 30일)`;
    toast('전체 삭제 완료');
    loadHistory();
  } catch (err) { toast(err.message, true); }
});

$('#deleteAccountBtn')?.addEventListener('click', async () => {
  const ok = await askConfirm('계정 전체 삭제', '계정의 모든 세션·프로필·보고서·이의를 삭제할까요? 되돌릴 수 없습니다.', { danger: true, okText: '계정 삭제' });
  if (!ok) return;
  try {
    const d = await api('/account', { method: 'DELETE', idempotent: true });
    $('#deleteAllResult').textContent = `계정 삭제 완료. 백업 만료: ${d.backup_expiry || '최장 30일'}`;
    resetFlow();
    toast('계정 전체 삭제 완료');
    go('dashboard');
  } catch (err) { toast(err.message, true); }
});

// 월간 역량(사용자): 공개본만
export async function loadTrendLookup() {
  const seg = $('#trendSegment')?.value || 'company';
  const monthInput = $('#trendMonth');
  if (monthInput && !monthInput.value) {
    const d = new Date();
    monthInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const month = monthInput?.value;
  const box = $('#trendResult');
  if (!box || !month) return;
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const t = await api(`/trends/${encodeURIComponent(seg)}/${encodeURIComponent(month)}`);
    if (t.status !== 'monthly_trend' || !t.items?.length) {
      box.innerHTML = `<p class="hint">${esc(t.note || '이 달에 공개된 월간 역량 자료가 없습니다. 일반 기준으로 연습하세요.')}</p>`;
      return;
    }
    box.innerHTML = `
      <p class="fine">검수·승인된 월간 보조 기준입니다. 기관 공식 요구가 아닙니다. (버전 ${esc(String(t.version))})</p>
      <ul class="claims">${t.items.map((i) => `<li><span class="val">${esc(i.competency)}</span><span class="tag trend">월간 트렌드</span><span class="meta">${esc(i.comment || '')}${i.sources?.length ? `<br />출처: ${i.sources.map(esc).join(', ')}` : ''}</span></li>`).join('')}</ul>`;
  } catch (err) {
    box.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}
$('#trendSegment')?.addEventListener('change', loadTrendLookup);
$('#trendMonth')?.addEventListener('change', loadTrendLookup);
