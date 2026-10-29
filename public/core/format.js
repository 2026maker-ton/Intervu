export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function setError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

export function stateLabel(s) {
  return ({ ready: '시작 전', active: '진행 중', paused: '일시정지', completed: '완료', failed: '실패', deleting: '삭제 중', deleted: '삭제됨' }[s] || s);
}

export function fmtDate(v) {
  if (!v) return '기록 없음';
  try { return new Date(v).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(v); }
}

export function basisTag(basis) {
  if (basis === 'official') return '<span class="tag official">공식 자료 확인</span>';
  if (basis === 'user') return '<span class="tag user">사용자 입력</span>';
  if (basis === 'monthly_trend') return '<span class="tag trend">월간 트렌드(보조)</span>';
  return '<span class="tag">연습 가정</span>';
}

export function downloadJson(payload, name) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
