import { $ } from './format.js';

// ---- 대화상자 (prompt/confirm 대체) ----
export function dialog({ title, message = '', label = '', value = '', multiline = false, okText = '확인', danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    if (!dlg) return resolve(null);
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    $('#confirmMessage').hidden = !message;
    const wrap = $('#confirmInputWrap');
    const input = $('#confirmInput');
    const area = $('#confirmText');
    wrap.hidden = !label;
    if (label) $('#confirmInputLabel').textContent = label;
    input.hidden = multiline;
    area.hidden = !multiline;
    if (multiline) area.value = value; else input.value = value;
    const ok = $('#confirmOk');
    const cancel = $('#confirmCancel');
    ok.textContent = okText;
    ok.className = danger ? 'danger' : 'primary';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      dlg.close();
      resolve(val);
    };
    dlg.addEventListener('close', () => { if (!settled) { settled = true; resolve(null); } }, { once: true });
    ok.onclick = (e) => {
      e.preventDefault();
      if (!label) return done('ok');
      const v = (multiline ? area.value : input.value).trim();
      return done(v || null);
    };
    cancel.onclick = (e) => { e.preventDefault(); done(null); };
    dlg.showModal();
    setTimeout(() => { try { (multiline ? area : input).focus(); } catch { /* noop */ } }, 30);
  });
}
export const askConfirm = async (title, message, opts = {}) => (await dialog({ title, message, ...opts })) === 'ok';
export const askInput = (title, message, label, value = '', multiline = false) => dialog({ title, message, label, value, multiline });
