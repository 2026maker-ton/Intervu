import { $, esc, setError } from '../core/format.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { renderEvidence } from './evidence.js';
import { updateSetupSummary } from './setup.js';
import { Stepper, StateBadge } from '../ui/index.js';

const MAX_BYTES = 5 * 1024 * 1024; // 서버 validateDocument와 동일
const NOTICE_VERSION = '2026-10-29';
const KIND_LABEL = { posting: '모집요강·인재상', cover_letter: '자기소개서·지원서', resume: '이력서', other: '기타' };
const FAIL_COPY = {
  unsupported_font_encoding: '이 PDF는 글꼴 인코딩 때문에 글자를 안전하게 읽지 못했습니다. 텍스트를 직접 붙여넣거나 DOCX/TXT로 올려 주세요.',
  non_extractable_scanned: '스캔·이미지 PDF라 글자를 읽지 못했습니다. 텍스트를 직접 붙여넣어 주세요.',
  non_extractable: '파일에서 텍스트를 찾지 못했습니다. 텍스트를 직접 붙여넣어 주세요.',
  empty_document: '빈 문서입니다. 내용을 확인한 뒤 다시 올려 주세요.',
  unsupported_file: 'PDF/DOCX/TXT만 올릴 수 있습니다. 텍스트를 직접 붙여넣어도 됩니다.',
  mime_mismatch: '확장자와 파일 형식이 맞지 않습니다. 파일을 확인하거나 텍스트를 직접 붙여넣어 주세요.',
  oversized_document: '5MB를 초과합니다. 텍스트를 직접 붙여넣어 주세요.',
};

$('#appStepper').innerHTML = Stepper(['지원 정보', '근거 확인', '면접 설정'], 0);

const docs = []; // { key, filename, mime, kind, b64, status, code, message, text, edited, chars }
let docSeq = 0;
let fixture = null; // 불러온 합성 샘플 상세. 입력이 바뀌면 해제
const val = (name) => String($(`#applicationForm [name=${name}]`)?.value || '');

// ---- 합성 샘플 ----
function setFixture(f) {
  fixture = f;
  $('#fixtureBadge').hidden = !f;
}
$('#loadFixtureBtn')?.addEventListener('click', async () => {
  setError('#applicationError', '');
  try {
    const list = (await api('/fixtures')).fixtures || [];
    const want = state.journey === 'highschool' ? 'highschool' : 'university';
    const pick = list.find((x) => x.kind === want) || list.find((x) => x.id === `fx-${want}-1`) || list[0];
    if (!pick) throw new Error('불러올 합성 샘플이 없습니다.');
    const f = await api(`/fixtures/${encodeURIComponent(pick.id)}`);
    const name = f.title.split('—')[1]?.trim() || f.title;
    const [school, ...rest] = name.split(/\s+/);
    $('#applicationForm [name=school_name]').value = f.school_name || school;
    $('#applicationForm [name=department]').value = f.department || rest.join(' ');
    $('#sourceText').value = f.posting_text;
    $('#applicationText').value = f.application_text;
    setFixture(f);
    toast('합성 샘플을 채웠습니다. 가상의 자료이며 실제 지원자 정보가 아닙니다.');
  } catch (e) {
    setError('#applicationError', e.status === 404 ? '합성 샘플이 꺼져 있습니다. 직접 입력해 주세요.' : e.message);
  }
});
['#sourceText', '#applicationText'].forEach((s) => $(s)?.addEventListener('input', () => { if (fixture) setFixture(null); }));

// ---- 문서 카드 ----
function renderDocs() {
  $('#docCards').innerHTML = docs.map((d) => {
    const ok = d.status === 'ok';
    const badge = ok ? StateBadge(`추출 완료 · ${d.chars}자`, 'ok', '✓') : d.status === 'loading' ? StateBadge('추출 중…', 'info') : StateBadge(d.status === 'scanned' ? '스캔 PDF' : '추출 실패', 'warn', '!');
    const body = ok
      ? `<label class="field"><span>추출 텍스트 (확인·수정 가능)</span><textarea data-doc-text="${d.key}" rows="5" maxlength="20000">${esc(d.text)}</textarea></label><small class="fine">revision: ${d.edited ? '수정본(user_edit)' : '추출 텍스트(extracted)'}</small>`
      : d.status === 'loading' ? '' : `<p class="fine warn" role="alert">${esc(FAIL_COPY[d.code] || d.message || '추출하지 못했습니다. 텍스트를 직접 붙여넣어 주세요.')}</p>`;
    return `<div class="doc-card" data-doc="${d.key}"><div class="doc-head"><strong>${esc(d.filename)}</strong> ${badge}
      <label class="doc-kind"><span class="sr-only">문서 종류</span><select data-doc-kind="${d.key}">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}"${k === d.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button type="button" class="ghost" data-doc-remove="${d.key}">삭제</button></div>${body}</div>`;
  }).join('');
}
const docOf = (el, attr) => docs.find((d) => String(d.key) === el.getAttribute(attr));
$('#docCards')?.addEventListener('input', (e) => {
  const d = e.target.matches('[data-doc-text]') && docOf(e.target, 'data-doc-text');
  if (d) { d.text = e.target.value; d.edited = true; setFixture(null); }
});
$('#docCards')?.addEventListener('change', (e) => {
  const d = e.target.matches('[data-doc-kind]') && docOf(e.target, 'data-doc-kind');
  if (d) d.kind = e.target.value;
});
$('#docCards')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-doc-remove]');
  if (!b) return;
  docs.splice(docs.indexOf(docOf(b, 'data-doc-remove')), 1);
  setFixture(null);
  renderDocs();
  $('#docFile').focus();
});

$('#docFile')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  const status = $('#docStatus');
  e.target.value = '';
  if (!f) return;
  status.className = 'fine';
  if (f.size > MAX_BYTES) {
    status.textContent = '5MB를 초과합니다. 텍스트를 직접 붙여넣어 주세요.';
    status.className = 'fine warn';
    return;
  }
  const d = { key: ++docSeq, filename: f.name, mime: f.type, kind: $('#docKind').value, status: 'loading', text: '', edited: false };
  docs.push(d);
  renderDocs();
  status.textContent = '텍스트를 추출하는 중…';
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    d.b64 = btoa(bin);
    const r = await api('/documents/extract', { method: 'POST', idempotent: true, body: { filename: f.name, mime_type: f.type, content_base64: d.b64 } });
    Object.assign(d, { status: 'ok', text: r.text, chars: r.char_count });
    status.textContent = `추출 완료 (${r.char_count}자).${r.truncated ? ' 일부는 잘렸습니다.' : ''} 카드에서 확인·수정하세요.`;
    status.className = 'fine ok';
  } catch (err) {
    const code = err.data?.error?.details?.code;
    Object.assign(d, { status: code === 'non_extractable_scanned' ? 'scanned' : 'failed', code, message: err.message });
    status.textContent = '추출하지 못했습니다. 카드의 안내를 확인하세요. 입력한 내용은 그대로 남아 있습니다.';
    status.className = 'fine warn';
  }
  renderDocs();
});

// ---- 연령·처리 안내 (428 시) ----
async function askConsent() {
  const dlg = $('#consentDialog');
  const age = $('#consentAge');
  const ok = $('#consentOk');
  const minor = $('#consentMinor');
  const minorNote = $('#consentMinorNote');
  age.checked = false;
  minor.checked = false;
  minorNote.hidden = true;
  ok.disabled = true;
  $('#consentAiLine').textContent = '외부 AI: 현재 모드를 확인하는 중…';
  api('/providers/status').then((p) => {
    $('#consentAiLine').textContent = p.summary === 'mock'
      ? '외부 AI: 현재 Mock 모드로, 지원 자료를 외부 AI로 보내지 않습니다.'
      : '외부 AI: 일부 기능이 외부 AI와 연결되어 있으나, 실제 지원 자료는 서버 정책상 승인되지 않으면 전송되지 않습니다.';
  }).catch(() => { $('#consentAiLine').textContent = '외부 AI: 현재 모드를 확인하지 못했습니다. 확인 전에는 외부로 보내지 않는 것으로 간주합니다.'; });
  const sync = () => { minorNote.hidden = !minor.checked; ok.disabled = !(age.checked || minor.checked); };
  age.onchange = sync;
  minor.onchange = sync;
  const result = await new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    age.focus();
  });
  if (result !== 'ok' || !(age.checked || minor.checked)) return false;
  // 미성년 선택 시: 실제 입력은 외부 AI 없이 처리됨을 이해했다는 확인(minor_notice_ack)을 함께 기록한다.
  await api('/consents', { method: 'POST', idempotent: true, body: age.checked ? { age_19_confirmed: true, notice_version: NOTICE_VERSION } : { age_19_confirmed: false, minor_notice_ack: true, notice_version: NOTICE_VERSION } });
  return true;
}

// ---- 2. 지원 정보 ----
$('#applicationForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#analyzeBtn');
  setError('#applicationError', '');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '근거를 확인하는 중…';
  try {
    const okDocs = docs.filter((d) => d.status === 'ok' && d.text.trim());
    const join = (base, kinds) => [base.trim(), ...okDocs.filter((d) => kinds.includes(d.kind)).map((d) => d.text.trim())].filter(Boolean).join('\n');
    const payload = {
      org_type: state.journey === 'highschool' ? 'highschool' : 'university',
      school_name: val('school_name').trim(),
      department: val('department').trim(),
      track: val('track').trim() || undefined,
      target_name: val('school_name').trim(), // 구버전 서버 호환
      role: val('department').trim(),
      source_text: join(val('source_text'), ['posting']),
      application_text: join(val('application_text'), ['cover_letter', 'resume', 'other']),
      sources: val('source_urls').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).map((url) => ({ url, kind: 'official' })),
      experiences: val('experiences').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    };
    if (!payload.target_name && !payload.role && !payload.source_text && !payload.application_text) {
      throw new Error('학교명, 학과, 모집요강 본문, 지원서 중 하나는 입력해야 합니다.');
    }
    // 합성 판정은 서버가 정하며, 본문이 샘플과 정확히 같을 때만 fixture_id를 보낸다.
    if (fixture && payload.source_text === fixture.posting_text && payload.application_text === fixture.application_text) payload.fixture_id = fixture.id;
    const create = () => api('/profiles', { method: 'POST', idempotent: true, body: payload });
    let created;
    try {
      created = await create();
    } catch (err) {
      if (err.status !== 428) throw err;
      if (!(await askConsent())) throw new Error('동의하지 않으면 실제 자료는 사용할 수 없습니다. 합성 샘플로 체험하거나, 동의 후 다시 진행해 주세요.');
      created = await create();
    }
    state.profile = created;
    state.versionId = created.version_id;
    state.approved = false;
    // 문서 저장(종류·revision). 실패해도 프로필은 이미 만들어졌으므로 안내만 한다.
    let docFail = 0;
    for (const d of okDocs) {
      try {
        const up = await api(`/profiles/${created.id}/documents`, { method: 'POST', idempotent: true, body: { kind: d.kind, filename: d.filename, mime_type: d.mime, content_base64: d.b64 } });
        if (d.edited && up.id) await api(`/documents/${up.id}`, { method: 'PATCH', body: { text: d.text } });
      } catch { docFail += 1; }
    }
    const detail = await api(`/profiles/${created.id}`);
    state.sources = detail.sources || [];
    renderEvidence(detail, created, { autoAnalyze: true });
    go('evidence');
    if (created.pii_warnings?.length) toast(`개인정보 후보(${created.pii_warnings.join(', ')})를 마스킹했습니다 — 완전 익명화는 아닙니다.`);
    else if (docFail) toast(`문서 ${docFail}개를 저장하지 못했습니다. 본문은 분석에 반영되었습니다.`, true);
  } catch (err) {
    setError('#applicationError', err.message);
    $('#applicationError')?.setAttribute('tabindex', '-1');
    $('#applicationError')?.focus();
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
