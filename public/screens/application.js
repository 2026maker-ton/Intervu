import { $, esc, setError } from '../core/format.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { renderEvidence } from './evidence.js';
import { Stepper } from '../ui/index.js';

$('#appStepper').innerHTML = Stepper(['지원 정보', '근거 확인', '면접 준비'], 0);

let fixture = null; // 불러온 샘플 상세. 본문을 고치면 해제(서버가 다시 판정)
const val = (name) => String($(`#applicationForm [name=${name}]`)?.value || '');
const setFixture = (f) => { fixture = f; $('#fixtureBadge').hidden = !f; };

// 샘플 목록: 서버가 DEMO_FIXTURES=on 일 때만 채운다.
let listed = false;
async function fillFixtureList() {
  if (listed) return;
  try {
    const { fixtures } = await api('/fixtures');
    $('#fixtureSelect').innerHTML = `<option value="">샘플 선택</option>${(fixtures || []).map((f) => `<option value="${esc(f.id)}">${esc(f.title)}</option>`).join('')}`;
    listed = true;
  } catch { $('#fixtureSelect').closest('.sample-row').hidden = true; }
}
window.addEventListener('hashchange', () => { if (location.hash === '#/application') fillFixtureList(); });
if (location.hash === '#/application') fillFixtureList();

$('#loadFixtureBtn')?.addEventListener('click', async () => {
  setError('#applicationError', '');
  await fillFixtureList();
  const id = $('#fixtureSelect').value || $('#fixtureSelect').options[1]?.value;
  if (!id) return setError('#applicationError', '불러올 샘플이 없습니다.');
  try {
    const f = await api(`/fixtures/${encodeURIComponent(id)}`);
    $('#fixtureSelect').value = id;
    const form = $('#applicationForm');
    form.school_name.value = f.school_name || '';
    form.department.value = f.department || '';
    form.track.value = f.track || '';
    form.source_text.value = f.posting_text;
    form.application_text.value = f.application_text;
    form.experiences.value = (f.experiences || []).join('\n');
    setFixture(f);
  } catch (e) {
    setError('#applicationError', e.message);
  }
});
['#sourceText', '#applicationText'].forEach((s) => $(s)?.addEventListener('input', () => { if (fixture) setFixture(null); }));

$('#applicationForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#analyzeBtn');
  setError('#applicationError', '');
  const payload = {
    org_type: 'university',
    school_name: val('school_name').trim(), department: val('department').trim(), track: val('track').trim() || undefined,
    source_text: val('source_text').trim(), application_text: val('application_text').trim(),
    experiences: val('experiences').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8),
  };
  if (!payload.school_name || !payload.department) return setError('#applicationError', '대학교와 학과를 입력해 주세요.');
  // 합성 판정은 서버가 정하며, 본문이 샘플과 정확히 같을 때만 fixture_id를 보낸다.
  if (fixture && payload.source_text === fixture.posting_text && payload.application_text === fixture.application_text) payload.fixture_id = fixture.id;
  btn.disabled = true;
  try {
    const created = await api('/profiles', { method: 'POST', idempotent: true, body: payload });
    state.profile = created;
    state.versionId = created.version_id;
    state.approved = false;
    const detail = await api(`/profiles/${created.id}`);
    state.profile = { ...created, ...detail };
    state.sources = detail.sources || [];
    renderEvidence(detail, created, { autoAnalyze: true });
    go('evidence');
    if (created.pii_warnings?.length) toast(`개인정보 후보(${created.pii_warnings.join(', ')})를 가렸습니다.`);
  } catch (err) {
    setError('#applicationError', err.message);
    $('#applicationError')?.setAttribute('tabindex', '-1');
    $('#applicationError')?.focus();
  } finally {
    btn.disabled = false;
  }
});
