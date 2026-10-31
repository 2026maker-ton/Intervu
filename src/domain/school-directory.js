// 학교 이름 자동 탐색용 레지스트리(2026-10-31): 가상 학교를 없애고 실제 대학명 샘플 10건(src/domain/sample-schools.js)만 둔다.
// 자료는 공식 모집요강이 아니라 예시 설명이며(SAMPLE_LABEL), 학교명이 일치할 때만 소스로 자동 등록한다. 일치하지 않으면 추측하지 않고 discovery_failed.
// 실제 웹 검색은 school.search(Google Search grounding)가 맡는다. 그것이 이 레지스트리를 대체하면 이 파일을 지운다.
import { SAMPLE_SCHOOLS, SAMPLE_LABEL } from './sample-schools.js';

export const DEMO_LABEL = SAMPLE_LABEL;
export const SCHOOLS = Object.freeze(SAMPLE_SCHOOLS.map((s) => ({
  id: s.id, kind: 'university', name: s.school_name, department: s.department,
  official_url_demo: null, title: `${s.school_name} ${s.admission_track} 예시 설명`, label: SAMPLE_LABEL, text: s.institution_text,
})));

const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
export function findSchool(name, kind) {
  const n = norm(name);
  if (!n) return null;
  return SCHOOLS.find((s) => norm(s.name) === n && (!kind || s.kind === kind)) || null;
}
export const schoolText = (id) => SCHOOLS.find((s) => s.id === id)?.text || '';
