import { $, $$, esc, fmtDate, setError } from '../core/format.js';
import { toast } from '../core/toast.js';
import { askConfirm } from '../core/dialog.js';
import { api } from '../core/api.js';
import { ADMIN_KEY, state } from '../core/state.js';
import { loadProvider } from './dashboard.js';

// ---- 9. 관리자 ----
export function adminId(segment, month) {
  return encodeURIComponent(`${segment}|${month}`);
}

export async function initAdmin() {
  if (state.adminEnabled === null) await loadProvider();
  const note = $('#adminGateNote');
  const gate = $('#adminGate');
  const panel = $('#adminPanel');
  const input = $('#adminTokenInput');
  const unlock = $('#adminUnlockBtn');
  if (state.adminEnabled === false) {
    if (note) note.textContent = '서버에 ADMIN_TOKEN이 설정되지 않아 관리 기능이 꺼져 있습니다. 서버 설정 후 다시 열어 주세요.';
    if (input) input.disabled = true;
    if (unlock) unlock.disabled = true;
    gate.hidden = false;
    panel.hidden = true;
    return;
  }
  if (input) input.disabled = false;
  if (unlock) unlock.disabled = false;
  if (state.adminUnlocked) {
    gate.hidden = true;
    panel.hidden = false;
    ensureTrendItems();
    await loadAdminHistory();
    return;
  }
  gate.hidden = false;
  panel.hidden = true;
  if (note) note.textContent = '관리자 토큰(x-admin-token)을 입력하세요.';
  if (state.adminToken) {
    const ok = await verifyAdmin();
    if (ok) { gate.hidden = true; panel.hidden = false; ensureTrendItems(); await loadAdminHistory(); }
  }
}

export async function verifyAdmin() {
  try {
    const input = $('#adminTokenInput');
    const token = (input?.value || state.adminToken || '').trim();
    if (!token) { setError('#adminError', '관리자 토큰을 입력하세요.'); return false; }
    state.adminToken = token;
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await api(`/admin/trends/${adminId('company', month)}/history`, { admin: true });
    sessionStorage.setItem(ADMIN_KEY, token);
    state.adminUnlocked = true;
    setError('#adminError', '');
    return true;
  } catch (err) {
    state.adminUnlocked = false;
    sessionStorage.removeItem(ADMIN_KEY);
    setError('#adminError', err.status === 403 ? '관리자 토큰이 올바르지 않습니다.' : err.message);
    return false;
  }
}

$('#adminUnlockBtn')?.addEventListener('click', async () => {
  const ok = await verifyAdmin();
  if (!ok) return;
  $('#adminGate').hidden = true;
  $('#adminPanel').hidden = false;
  ensureTrendItems();
  await loadAdminHistory();
  toast('관리자 화면을 열었습니다.');
});

export function ensureTrendItems() {
  const box = $('#trendItems');
  if (!box) return;
  if (!box.children.length) addTrendItem();
}
export function addTrendItem(value = '', comment = '') {
  const box = $('#trendItems');
  if (!box || box.children.length >= 3) return;
  const row = document.createElement('div');
  row.className = 'trend-item';
  row.innerHTML = `
    <label class="field"><span>역량</span><input class="trend-competency" maxlength="60" value="${esc(value)}" placeholder="예: 문제 해결" /></label>
    <label class="field"><span>코멘트 (1~2문장)</span><input class="trend-comment" maxlength="200" value="${esc(comment)}" placeholder="예: 최근 공고에서 문제 해결 요구가 늘었습니다." /></label>
    <button class="ghost small" type="button" data-remove-item>삭제</button>`;
  row.querySelector('[data-remove-item]').addEventListener('click', () => row.remove());
  box.appendChild(row);
}
$('#addTrendItemBtn')?.addEventListener('click', () => {
  if ($('#trendItems')?.children.length >= 3) { toast('월·분야별 최대 3개까지 등록할 수 있습니다.', true); return; }
  addTrendItem();
});

$('#trendForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const items = $$('#trendItems .trend-item').map((row) => ({
    competency: row.querySelector('.trend-competency').value.trim(),
    comment: row.querySelector('.trend-comment').value.trim(),
  })).filter((i) => i.competency);
  setError('#trendError', '');
  if (!items.length) { setError('#trendError', '역량을 하나 이상 입력하세요.'); return; }
  try {
    await api('/admin/trends', {
      method: 'POST', idempotent: true, admin: true,
      body: {
        segment: fd.get('segment'),
        yyyy_mm: fd.get('yyyy_mm'),
        items,
        comment: fd.get('comment') || '',
        sources: String(fd.get('sources') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10),
      },
    });
    toast('초안으로 저장했습니다. 공개 전에는 사용자에게 노출되지 않습니다.');
    await loadAdminHistory();
  } catch (err) {
    setError('#trendError', err.message);
  }
});

$('#trendLoadBtn')?.addEventListener('click', () => loadAdminHistory());

export async function adminMonth() {
  const fd = new FormData($('#trendForm'));
  const seg = fd.get('segment') || 'company';
  let month = String(fd.get('yyyy_mm') || '');
  if (!month) {
    const d = new Date();
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const input = $('#trendForm [name="yyyy_mm"]');
    if (input) input.value = month;
  }
  return { seg, month };
}

export async function loadAdminHistory() {
  if (!state.adminUnlocked) return;
  const box = $('#trendList');
  if (!box) return;
  const { seg, month } = await adminMonth();
  box.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    const data = await api(`/admin/trends/${adminId(seg, month)}/history`, { admin: true });
    const versions = data.versions || [];
    if (!versions.length) {
      box.innerHTML = `<p class="hint">${esc(seg)} · ${esc(month)}에 등록된 버전이 없습니다.</p>`;
      return;
    }
    box.innerHTML = versions.slice().reverse().map((v) => `
      <div class="list-item">
        <div>
          <strong>v${esc(String(v.version))} · ${v.status === 'published' ? '공개' : '초안'}</strong>
          <div class="meta">${(v.items || []).map((i) => esc(i.competency)).join(' · ') || '역량 없음'}${v.rolled_back_from ? ` · v${esc(String(v.rolled_back_from))}에서 롤백` : ''}</div>
          <div class="meta">등록 ${esc(fmtDate(v.created_at))}${v.published_at ? ` · 공개 ${esc(fmtDate(v.published_at))}` : ''}${v.comment ? ` · ${esc(v.comment)}` : ''}</div>
        </div>
        <div class="list-actions">
          <span class="state-badge ${v.status === 'published' ? 'ok' : 'warn'}">${v.status === 'published' ? '공개' : '초안'}</span>
          ${v.status === 'published'
            ? `<button class="ghost small" type="button" data-rollback="${esc(String(v.version))}">이 버전으로 롤백</button>`
            : `<button class="primary small" type="button" data-publish="${esc(String(v.version))}">공개</button>`}
        </div>
      </div>`).join('');
    $$('[data-publish]').forEach((b) => b.addEventListener('click', () => publishTrend(seg, month, b.dataset.publish)));
    $$('[data-rollback]').forEach((b) => b.addEventListener('click', () => rollbackTrend(seg, month, b.dataset.rollback)));
  } catch (err) {
    box.innerHTML = `<p class="missing">${esc(err.message)}</p>`;
  }
}

export async function publishTrend(seg, month, version) {
  try {
    await api(`/admin/trends/${adminId(seg, month)}/publish`, { method: 'POST', idempotent: true, admin: true, body: { version: Number(version) } });
    toast(`v${version}을 공개했습니다.`);
    await loadAdminHistory();
  } catch (err) { toast(err.message, true); }
}
export async function rollbackTrend(seg, month, version) {
  const ok = await askConfirm('롤백', `v${version} 내용으로 롤백할까요? 새 버전으로 기록되며 이전 버전은 보존됩니다.`);
  if (!ok) return;
  try {
    const v = await api(`/admin/trends/${adminId(seg, month)}/rollback`, { method: 'POST', idempotent: true, admin: true, body: { version: Number(version) } });
    toast(`v${v.version}(으)로 롤백했습니다.`);
    await loadAdminHistory();
  } catch (err) { toast(err.message, true); }
}
