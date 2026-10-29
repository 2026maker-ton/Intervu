// 디자인 시스템 컴포넌트: HTML 문자열 헬퍼. 모든 동적 값은 esc()를 거친다.
import { esc } from '../core/format.js';
import { SOURCE_STATUS, FIXED, reasonCopy } from '../core/copy.js';

const TONES = ['ok', 'warn', 'error', 'info', 'neutral'];
const tone = (t) => (TONES.includes(t) ? t : 'neutral');

export const StateBadge = (text, t = 'neutral', icon = '') =>
  `<span class="state-badge ${tone(t)}">${icon ? `<span aria-hidden="true">${esc(icon)}</span> ` : ''}${esc(text)}</span>`;

export function SourceChip(status) {
  const s = SOURCE_STATUS[status] || SOURCE_STATUS.unverified;
  return `<span class="source-chip ${tone(s.tone)}" title="${esc(s.hint)}"><span aria-hidden="true">${esc(s.icon)}</span> ${esc(s.label)}</span>`;
}

export function EvidenceQuote({ quote, start, end, title } = {}) {
  const loc = Number.isFinite(start) && Number.isFinite(end) ? ` · 원문 위치 ${start}–${end}` : '';
  return `<span class="evidence-quote"><q>${esc(quote)}</q><span class="meta">${esc(title || '')}${loc}</span></span>`;
}

export function ProviderBanner({ kind = 'fallback', reason, text } = {}) {
  const alert = kind === 'error';
  const msg = text || (reason ? reasonCopy(reason) : FIXED.fallback);
  return `<div class="provider-banner ${alert ? 'error' : 'warn'}" role="${alert ? 'alert' : 'status'}">${esc(msg)}</div>`;
}

export const EmptyState = (text, action = '') => `<div class="empty-state"><p>${esc(text)}</p>${action ? `<p>${esc(action)}</p>` : ''}</div>`;
export const ErrorState = (text, action = '') => `<div class="error-state" role="alert"><p>${esc(text)}</p>${action ? `<p>${esc(action)}</p>` : ''}</div>`;
export const Skeleton = (lines = 3) => `<div class="skeleton" aria-busy="true" aria-label="불러오는 중…">${'<span></span>'.repeat(Math.max(1, lines | 0))}</div>`;

// steps: string[], current: 0-based. 현재 이전은 완료, 이후는 잠김.
export const Stepper = (steps, current) =>
  `<ol class="stepper">${steps.map((s, i) => `<li class="${i < current ? 'done' : i === current ? 'current' : 'locked'}"${i === current ? ' aria-current="step"' : ''}>${i + 1}. ${esc(s)}</li>`).join('')}</ol>`;

// mode: mock | partial-live | live | error. 텍스트는 호출자가 현재 문자열을 그대로 넘긴다.
export const ModeChip = (text, mode = 'mock') => `<span class="mode-chip" data-mode="${esc(mode)}">${esc(text)}</span>`;
