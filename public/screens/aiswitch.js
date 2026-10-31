// 화면 상단 AI 기능 스위치. 켜고 끄려면 스위치 비밀번호가 필요하다(서버가 검사). 끄면 서버가 모든 외부 AI 호출을 막고 규칙 기반 기본 동작만 남긴다.
import { $ } from '../core/format.js';
import { api } from '../core/api.js';
import { dialog } from '../core/dialog.js';
import { toast } from '../core/toast.js';
import { state } from '../core/state.js';
import { refreshModeChip } from '../core/providers.js';

const paint = (on) => {
  const b = $('#aiSwitch');
  if (!b) return;
  b.hidden = false;
  b.setAttribute('aria-checked', String(on));
  b.dataset.on = String(on);
  b.title = on ? 'AI 기능 켜짐 · 끄려면 비밀번호가 필요합니다' : 'AI 기능 꺼짐 · 켜려면 비밀번호가 필요합니다';
};

export async function initAiSwitch() {
  const b = $('#aiSwitch');
  if (!b || b.dataset.ready) return;
  b.dataset.ready = '1';
  try { paint((await api('/ai-switch', { auth: false })).on); } catch { return; } // 서버에 스위치가 없으면 숨긴 채 둔다
  b.addEventListener('click', async () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    const pw = await dialog({ title: next ? 'AI 기능 켜기' : 'AI 기능 끄기', message: next ? '외부 AI 호출을 다시 허용합니다.' : '모든 외부 AI 호출을 막고 기본 동작만 남깁니다.', label: '스위치 비밀번호', secret: true, okText: next ? '켜기' : '끄기' });
    if (!pw) return;
    try {
      const r = await api('/ai-switch', { method: 'POST', auth: false, body: { on: next, password: pw } });
      paint(r.on);
      toast(r.on ? 'AI 기능을 켰습니다.' : 'AI 기능을 껐습니다. 기본 동작만 가능합니다.');
      if (state.user) refreshModeChip();
    } catch (err) { toast(err.message, true); }
  });
}
