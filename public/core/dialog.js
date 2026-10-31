import { $ } from './format.js';

// ---- 대화상자 (prompt/confirm 대체) ----
export function dialog({ title, message = '', label = '', value = '', multiline = false, okText = '확인', danger = false, choices = null }) {
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
    document.getElementById('confirmChoice')?.remove();
    let choice = null;
    if(choices){choice=document.createElement('select');choice.id='confirmChoice';choice.setAttribute('aria-label',label);for(const [v,t,disabled] of choices){const o=document.createElement('option');o.value=v;o.textContent=t;o.disabled=!!disabled;choice.append(o);}if(value)choice.value=value;wrap.append(choice);}
    input.hidden = multiline || !!choices;
    area.hidden = !multiline || !!choices;
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
      const v = (choice ? choice.value : multiline ? area.value : input.value).trim();
      return done(v || null);
    };
    cancel.onclick = (e) => { e.preventDefault(); done(null); };
    dlg.showModal();
    // 입력이 없는 확인창은 기본 포커스를 취소에 둔다(위험 행동 오작동 방지, 06 오버레이 규칙).
    setTimeout(() => { try { (!label ? cancel : choice || (multiline ? area : input)).focus(); } catch { /* noop */ } }, 30);
  });
}
export const askConfirm = async (title, message, opts = {}) => (await dialog({ title, message, ...opts })) === 'ok';
export const askInput = (title, message, label, value = '', multiline = false) => dialog({ title, message, label, value, multiline });
