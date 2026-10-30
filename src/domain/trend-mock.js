// 월간 입시·교육 이슈 Mock(09 §4). 실제 이슈가 아니다: 모든 항목 mock:true, 라벨로 항상 밝힌다.
// 현재 월 데이터가 없으면 가장 가까운 월을 쓰지 않고 unavailable.
export const TREND_MOCK_LABEL = '월간 트렌드(Mock · 보조) — 실제 입시·교육 이슈 아님';
const it = (id, title, summary, topic_tags) => ({ id, title, summary, topic_tags, mock: true });
const DATA = {
  '2026-09': {
    highschool: [it('mock-2026-09-hs-1', '[Mock] 탐구 활동 과정 기록', '[Mock] 결과보다 탐구 과정과 질문 설정을 설명하는 능력을 강조하는 가상 이슈.', ['탐구', '과정'])],
    university: [it('mock-2026-09-un-1', '[Mock] 전공 연계 학습 경험', '[Mock] 전공과 연결된 학습 경험의 구체성을 강조하는 가상 이슈.', ['전공', '학습'])],
  },
  '2026-10': {
    highschool: [it('mock-2026-10-hs-1', '[Mock] 협력 활동의 역할 구분', '[Mock] 모둠 활동에서 본인 역할을 구분해 설명하는 능력을 강조하는 가상 이슈.', ['협력', '역할']), it('mock-2026-10-hs-2', '[Mock] 진로 탐색의 일관성', '[Mock] 진로 선택 이유의 일관성을 강조하는 가상 이슈.', ['진로'])],
    university: [it('mock-2026-10-un-1', '[Mock] 학업 중 문제 해결 사례', '[Mock] 학업 과정에서 문제를 정의하고 해결한 사례를 강조하는 가상 이슈.', ['문제해결', '학업']), it('mock-2026-10-un-2', '[Mock] 융합적 사고', '[Mock] 서로 다른 분야를 연결하는 사고를 강조하는 가상 이슈.', ['융합'])],
  },
  '2026-11': {
    highschool: [it('mock-2026-11-hs-1', '[Mock] 면접 답변의 근거 제시', '[Mock] 답변에서 근거를 함께 제시하는 태도를 강조하는 가상 이슈.', ['근거'])],
    university: [it('mock-2026-11-un-1', '[Mock] 공동체 기여 경험', '[Mock] 공동체에서 맡은 역할과 기여를 강조하는 가상 이슈.', ['공동체', '기여'])],
  },
  '2026-12': {
    highschool: [it('mock-2026-12-hs-1', '[Mock] 한 해 활동의 되돌아보기', '[Mock] 활동을 돌아보고 배운 점을 정리하는 능력을 강조하는 가상 이슈.', ['성찰'])],
    university: [it('mock-2026-12-un-1', '[Mock] 학업 계획의 구체성', '[Mock] 입학 후 학업 계획의 구체성을 강조하는 가상 이슈.', ['학업계획'])],
  },
};
export const segmentOfOrg = (orgType) => ({ highschool: 'highschool', university: 'university' }[orgType] || null);

// 결정 호출용 색인: id와 태그만(제목·요약 제외). 본문 조회(lookupTrends)는 모델이 true로 답한 뒤에만 한다.
export function trendCatalog(segment, yyyyMm) {
  const items = DATA[yyyyMm]?.[segment];
  return items?.length ? items.map(({ id, topic_tags }) => ({ id, topic_tags })) : null;
}
// 승인된 id만 본문을 돌려준다. 없으면 unavailable(가까운 월로 대체하지 않는다).
export function lookupTrends(segment, yyyyMm, ids) {
  const items = (DATA[yyyyMm]?.[segment] || []).filter((x) => ids.includes(x.id));
  return items.length ? { status: 'monthly_trend_mock', label: TREND_MOCK_LABEL, segment, yyyyMm, items } : { status: 'unavailable', label: TREND_MOCK_LABEL, segment, yyyyMm, items: [] };
}
