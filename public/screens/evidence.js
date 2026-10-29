import { $, basisTag, esc, setError } from '../core/format.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { go } from '../core/router.js';
import { updateSetupSummary } from './setup.js';

export function renderEvidence(detail, created) {
  const v = detail.current_version || {};
  const ex = v.extracted || {};
  const claims = ex.claims || [];
  const rows = claims.length
    ? claims.map((c) => `<li><span class="val">${esc(c.value)}</span><span class="tag user">공고 키워드</span><span class="meta">출처: “${esc(c.quote || c.value)}” · 원문 위치 ${esc(String(c.start_cp))}–${esc(String(c.end_cp))}</span></li>`).join('')
    : `<li><span class="val">확인된 기관 고유 역량 없음</span><span class="tag">일반 기준</span><span class="meta">공고가 없거나 추출하지 못했습니다. 일반 역량으로 연습하며 “기관 맞춤 검증 완료” 배지는 표시하지 않습니다.</span></li>`;
  const missing = (ex.missing_fields || []).map((f) => ({
    discussion_format: '토론면접 여부', interview_duration: '면접 시간', participant_count: '참여 인원', extraction_failed: '공고 분석(일반 기준 사용)',
  }[f] || f));
  const GAP = { role: '본인 역할', result: '관찰된 결과', reason: '판단 기준', number: '수치·기록' };
  const appClaims = ex.applicant_claims || [];
  const appRows = appClaims.map((c) => `<li><span class="val">“${esc(c.quote)}”</span><span class="tag user">지원서 주장</span><span class="meta">원문 위치 ${esc(String(c.start_cp))}–${esc(String(c.end_cp))} · ${c.gaps?.length ? `문장에 없는 정보: ${c.gaps.map((g) => esc(GAP[g] || g)).join(', ')}` : '역할·결과·기준·수치가 문장에 모두 있음'}</span></li>`).join('');
  const appBlock = ex.application_chars
    ? `<h3>지원서 주장·공백 (규칙 기반)</h3>${appRows ? `<ul class="claims">${appRows}</ul><p class="fine">거짓 여부를 판정하지 않습니다. 문장에 근거가 적혀 있는지 보고 빠진 정보를 면접에서 묻습니다.</p>` : '<p class="missing">경험·성과를 서술한 문장을 찾지 못했습니다. 일반 질문으로 진행합니다.</p>'}`
    : '<p class="fine">지원서를 입력하지 않아 지원서 주장 기반 질문은 만들지 않습니다.</p>';
  $('#evidenceBody').innerHTML = `
    <h3>공고 키워드</h3>
    <ul class="claims">${rows}</ul>
    ${appBlock}
    ${missing.length ? `<p class="missing">확인되지 않음: ${missing.map(esc).join(', ')} — 연습 가정으로 진행합니다.</p>` : ''}
    ${ex.rejected_spans ? `<p class="missing">출처 구간이 일치하지 않는 ${esc(String(ex.rejected_spans))}건은 제외했습니다.</p>` : ''}
    <p class="fine">분석 공급자: ${esc(created.provider || 'mock')} · 승인 전에는 면접을 시작할 수 없습니다.</p>`;
  renderInstitution(detail.institution || created.institution || null, detail.sources || []);
  $('#evidenceState').textContent = '확인 필요';
  $('#evidenceState').className = 'state-badge warn';
}

export function renderInstitution(inst, sources) {
  const box = $('#institutionBody');
  if (!box) return;
  if (!inst) { box.innerHTML = '<p class="hint">기관 분석 결과가 없습니다. 일반 기준으로 연습합니다.</p>'; return; }
  const values = (inst.core_values || []).map((c) => `<li><span class="val">${esc(c.label)}</span>${basisTag(c.basis)}<span class="meta">${c.source_quote ? `근거: “${esc(c.source_quote)}”${c.source_title ? ` · ${esc(c.source_title)}` : ''}` : esc(c.note || '일반 역량으로 연습합니다.')}</span></li>`).join('');
  const formats = (inst.formats || []).map((f) => `<li><span class="val">${esc(f.item)}</span>${basisTag(f.basis)}<span class="meta">${esc(f.note || '')}</span></li>`).join('');
  const recs = (inst.recommended_questions || []).map((q) => `<li><span class="val">${esc(q.text)}</span>${basisTag(q.basis)}<span class="meta">${esc(q.rationale || '')}</span></li>`).join('');
  const unev = (inst.unevaluable || []).map((u) => `<li><span class="val">${esc(u.area)}</span><span class="tag">평가 불가</span><span class="meta">${esc(u.reason)}</span></li>`).join('');
  const fresh = (inst.sources_summary?.freshness || []).map((f) => `<li><span class="val">${esc(f.title || '출처')}</span><span class="tag ${f.state === 'fresh' ? 'official' : ''}">${esc(f.state)}${f.age_days != null ? ` · ${esc(String(f.age_days))}일` : ''}</span><span class="meta">${esc(f.note || '')}</span></li>`).join('');
  const srcs = (sources || []).map((s) => `<li><span class="val">${esc(s.title || s.url || '출처')}</span><span class="tag ${s.kind === 'official' ? 'official' : 'user'}">${esc(s.kind === 'official' ? '공식' : s.kind === 'unofficial' ? '비공식 참고' : s.kind === 'user' ? '사용자 입력' : '가정')}</span><span class="meta">${esc(s.url || 'URL 미확인')}${s.published_at ? ` · 발행 ${esc(s.published_at)}` : ' · 발행일 미확인'}${s.retrieved_at ? ` · 확인 ${esc(String(s.retrieved_at).slice(0, 10))}` : ''}</span></li>`).join('');
  const conflicts = (inst.sources_summary?.conflicts || []).map((c) => `<li><span class="val">${esc(c.key)}</span><span class="tag">상충</span><span class="meta">서로 다른 값 ${esc(String(c.count))}건 — 단정하지 않고 해당 항목은 보류합니다.</span></li>`).join('');
  box.innerHTML = `
    <div class="inst-head"><strong>${esc(inst.org_label || '')} · ${esc(inst.target_name || '기관 미지정')} · ${esc(inst.role || '직무·학과 미지정')}</strong><span class="tag ${inst.fallback_to_general ? '' : 'official'}">${esc(inst.badge || '')}</span></div>
    <h3>핵심 가치·요구 역량</h3><ul class="claims">${values || '<li>확인된 역량 없음</li>'}</ul>
    ${formats ? `<h3>면접 형식·전형 조건</h3><ul class="claims">${formats}</ul>` : ''}
    ${recs ? `<h3>권장 연습 질문 (질문별 근거)</h3><ul class="claims">${recs}</ul>` : ''}
    <h3>평가 가능한 영역 / 불가 영역</h3><ul class="claims">${(inst.evaluable || []).map((x) => `<li><span class="val">${esc(x.label)}</span>${basisTag(x.basis)}</li>`).join('')}${unev}</ul>
    ${srcs ? `<h3>출처 (URL·발행일·확인일)</h3><ul class="claims">${srcs}</ul>` : ''}
    ${fresh ? `<h3>자료 신선도</h3><ul class="claims">${fresh}</ul>` : ''}
    ${conflicts ? `<h3>상충 자료</h3><ul class="claims">${conflicts}</ul>` : ''}
    <p class="fine">${esc(inst.disclaimer || '')}</p>`;
}

$('#approveBtn')?.addEventListener('click', async () => {
  if (!state.profile) {
    state.approved = true;
    updateSetupSummary();
    go('setup');
    return;
  }
  const btn = $('#approveBtn');
  btn.disabled = true;
  setError('#evidenceError', '');
  try {
    const note = ($('#evidenceNote')?.value || '').trim();
    await api(`/profiles/${state.profile.id}/approve`, {
      method: 'POST', idempotent: true,
      body: { version_id: state.versionId, institution_edits: note ? { note } : {} },
    });
    state.approved = true;
    $('#evidenceState').textContent = '승인 완료';
    $('#evidenceState').className = 'state-badge ok';
    updateSetupSummary();
    go('setup');
    toast('이 내용으로 승인했습니다. 면접을 설정하세요.');
  } catch (err) {
    setError('#evidenceError', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#evidenceBackBtn')?.addEventListener('click', () => go('application'));
