import { $, $$, downloadJson, esc, fmtDate, stateLabel } from '../core/format.js';
import { dialog } from '../core/dialog.js';
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
          <button class="ghost small" type="button" data-export-session="${esc(s.id)}">내보내기</button>
          <button class="ghost small danger-text" type="button" data-delete-session="${esc(s.id)}">삭제</button>
        </div>
      </div>`).join('');
    $$('[data-open-session]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.openSession, b.dataset.state)));
    $$('[data-export-session]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const ex = await api('/exports', { method: 'POST', idempotent: true, body: { format: 'json', session_id: b.dataset.exportSession } });
        downloadJson(await api(`/exports/${ex.job_id}`), 'intervu-session.json');
        toast('세션을 내보냈습니다.');
      } catch (err) { toast(err.message, true); }
    }));
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
    box.innerHTML = `<p class="missing" role="alert">기록을 불러오지 못했습니다: ${esc(err.message)}</p><button class="ghost small" type="button" id="historyRetry">다시 시도</button>`;
    $('#historyRetry')?.addEventListener('click', loadHistory);
  }
  loadProviderStatus();
}

// 인증된 사용자에게만: 기능별 실제 공급자·모드(키·모델 ID 없음)
async function loadProviderStatus() {
  const el = $('#providerOps');
  if (!el) return;
  try {
    const { operations = {}, summary } = await api('/providers/status');
    const rows = Object.entries(operations).map(([op, o]) => `<li><code>${esc(op)}</code> — ${o.mode === 'live' ? '외부 AI(실호출)' : 'Mock(외부 전송 없음)'}${o.blocked_reason ? ` · 차단 사유: ${esc(o.blocked_reason)}` : ''}</li>`).join('');
    el.innerHTML = `<p class="fine">전체: ${esc(summary === 'mock' ? 'Mock' : summary === 'live' ? '실호출' : '일부 실호출')}</p><ul class="plain">${rows}</ul>`;
  } catch { el.textContent = '공급자 상태를 불러오지 못했습니다.'; }
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
  const typed = await dialog({ title: '계정 전체 삭제', message: '세션·프로필·보고서·이의가 모두 삭제되며 되돌릴 수 없습니다. 활성 저장소에서는 즉시, 백업은 최장 30일 뒤 파기됩니다. 계속하려면 아래에 "계정삭제"를 입력하세요.', label: '확인 문구', okText: '계정 삭제', danger: true });
  if (typed !== '계정삭제') { if (typed) toast('확인 문구가 일치하지 않아 취소했습니다.', true); return; }
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
      box.innerHTML = `<p class="hint">이 달에 검수·공개된 월간 역량 자료가 없습니다. 일반 기준으로 연습하세요.</p>`;
      return;
    }
    box.innerHTML = `
      <p class="fine"><span class="tag trend">월간 트렌드 · 보조 기준</span> 검수·승인된 자료이며 기관 공식 요구가 아닙니다. (버전 ${esc(String(t.version))})</p>
      <ul class="claims">${t.items.map((i) => `<li><span class="val">${esc(i.competency)}</span><span class="tag trend">월간 트렌드</span><span class="meta">${esc(i.comment || '')}${i.sources?.length ? `<br />출처: ${i.sources.map(esc).join(', ')}` : ''}</span></li>`).join('')}</ul>`;
  } catch (err) {
    box.innerHTML = `<p class="missing" role="alert">조회하지 못했습니다: ${esc(err.message)}</p>`;
  }
}
$('#trendSegment')?.addEventListener('change', loadTrendLookup);
$('#trendMonth')?.addEventListener('change', loadTrendLookup);
