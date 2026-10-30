// 데모용 합성 학교 레지스트리(docs/plan/09 §3.2). 전부 가상의 학교이며 실제 학교명·URL은 넣지 않는다.
// 학교명이 일치할 때만 자동 등록하고, 일치하지 않으면 추측하지 않고 discovery_failed로 처리한다.
// 실제 웹 검색 기반 탐색은 향후 계획(구현 금지).
export const DEMO_LABEL = '데모 fixture(실제 학교 아님)';

export const SCHOOLS = Object.freeze([
  {
    id: 'sch-hs-1', kind: 'highschool', name: '가온고등학교(가상)', department: '자연계열',
    official_url_demo: 'https://demo.intervu.example/gaon-hs', title: '가온고등학교(가상) 입학 전형 안내', label: DEMO_LABEL,
    text: '가온고등학교(가상 고등학교) 자연계열 입학 전형 안내. 인재상: 탐구 역량, 공동체 역량, 자기주도 학습 태도. 전형 요소: 학교생활기록부 서류 평가와 면접으로 선발한다. 면접: 서류 기반 개별 면접으로 진행한다.',
  },
  {
    id: 'sch-uni-1', kind: 'university', name: '새봄대학교(가상)', department: '환경공학과',
    official_url_demo: 'https://demo.intervu.example/saebom-univ', title: '새봄대학교(가상) 학생부종합전형 모집요강', label: DEMO_LABEL,
    text: '새봄대학교(가상 대학) 환경공학과 학생부종합전형. 인재상: 탐구 역량, 공동체 역량, 전공 적합성. 면접: 서류 기반 개별 면접.',
  },
  {
    id: 'sch-uni-2', kind: 'university', name: '푸른강대학교(가상)', department: '컴퓨터공학과',
    official_url_demo: 'https://demo.intervu.example/pureun-univ', title: '푸른강대학교(가상) 학생부교과전형 모집요강', label: DEMO_LABEL,
    // 면접 형식은 일부러 적지 않았다(unconfirmed 경로 시험용).
    text: '푸른강대학교(가상 대학) 컴퓨터공학과 학생부교과전형. 인재상: 문제 해결 역량, 협업 태도, 전공 적합성. 전형 요소: 학생부 교과 성적과 서류 평가를 반영한다.',
  },
]);

const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
export function findSchool(name, kind) {
  const n = norm(name);
  if (!n) return null;
  return SCHOOLS.find((s) => norm(s.name) === n && (!kind || s.kind === kind)) || null;
}
export const schoolText = (id) => SCHOOLS.find((s) => s.id === id)?.text || '';
