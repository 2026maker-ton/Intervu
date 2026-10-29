import { $, setError } from '../core/format.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { renderEvidence } from './evidence.js';
import { updateSetupSummary } from './setup.js';

// ---- 2. 지원 정보 ----
$('#applicationForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const btn = $('#analyzeBtn');
  setError('#applicationError', '');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '근거를 확인하는 중…';
  try {
    const uploaded = state.uploadedText ? `\n${state.uploadedText}` : '';
    const payload = {
      org_type: state.journey === 'university' ? 'university' : 'company',
      target_name: String(fd.get('target_name') || '').trim(),
      role: String(fd.get('role') || '').trim(),
      source_text: String(fd.get('source_text') || '').trim(),
      application_text: `${String(fd.get('application_text') || '').trim()}${uploaded}`.trim(),
      sources: String(fd.get('source_urls') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).map((url) => ({ url, kind: 'official' })),
      experiences: String(fd.get('experiences') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    };
    if (!payload.target_name && !payload.role && !payload.source_text && !payload.application_text) {
      throw new Error('기관명, 직무/학과, 공고 본문, 지원서 중 하나는 입력해야 합니다.');
    }
    const created = await api('/profiles', { method: 'POST', idempotent: true, body: payload });
    state.profile = created;
    state.versionId = created.version_id;
    state.approved = false;
    const detail = await api(`/profiles/${created.id}`);
    state.sources = detail.sources || [];
    renderEvidence(detail, created);
    go('evidence');
    if (created.pii_warnings?.length) toast(`개인정보 후보(${created.pii_warnings.join(', ')})를 마스킹했습니다.`);
  } catch (err) {
    setError('#applicationError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

$('#skipApplicationBtn')?.addEventListener('click', () => {
  state.profile = null;
  state.versionId = null;
  state.sources = [];
  state.approved = false;
  updateSetupSummary();
  go('setup');
  toast('자료 없이 일반 기준으로 진행합니다. 기관 맞춤 검증 배지는 표시되지 않습니다.');
});

$('#docFile')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  const status = $('#docStatus');
  state.uploadedText = '';
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) {
    status.textContent = '5MB를 초과합니다. 텍스트를 직접 붙여넣어 주세요.';
    status.className = 'fine warn';
    return;
  }
  status.className = 'fine';
  status.textContent = '텍스트를 추출하는 중…';
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const r = await api('/documents/extract', { method: 'POST', idempotent: true, body: { filename: f.name, mime_type: f.type, content_base64: btoa(bin) } });
    const ta = $('#applicationText');
    if (ta && !ta.value.trim()) {
      ta.value = r.text.slice(0, 20000);
      state.uploadedText = '';
    } else {
      state.uploadedText = r.text;
    }
    status.textContent = `추출 완료 (${r.char_count}자). 위 입력란에서 확인·수정하세요.${r.truncated ? ' 일부는 잘렸습니다.' : ''}`;
    status.className = 'fine ok';
  } catch (err) {
    status.textContent = `추출 실패: ${err.message} 텍스트를 직접 붙여넣어 주세요.`;
    status.className = 'fine warn';
  }
});
