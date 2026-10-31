// 서버 보유 합성 샘플(WP-C6, DG-4, docs/plan/03 §5). 전부 가상의 기관·인물이며 개인정보 없음. 클라이언트 입력이 아니다.
// 합성 판정은 오직 여기의 정규화 해시/문장 일치로만 한다. seed는 고정이다.
import { sha256Hex } from '../app/crypto.js';
import { SAMPLE_SCHOOLS, SAMPLE_LABEL } from './sample-schools.js';

export const FIXTURE_SEED = 20261029;

export const FIXTURES = Object.freeze([
  {
    id: 'fx-company-1', kind: 'company', seed: FIXTURE_SEED, title: '가상 기업 샘플 — 새벽물류(주) 서비스 기획',
    posting_text: '새벽물류(가상 회사) 서비스 기획 신입 모집. 담당업무: 배송 앱 개선안 기획, 데이터 분석, 협업. 인재상: 문제 해결, 협업, 책임감.',
    application_text: '저는 대학 창업 동아리에서 배송 앱의 주문 취소 화면을 개선하는 프로젝트를 맡았습니다. 학과 행사 기간에 팀원 네 명과 함께 설문 조사를 진행했습니다. 동아리 운영진으로서 회의 일정을 관리하며 협업했습니다. 이 경험으로 사용자 의견을 듣는 일이 중요하다는 점을 배웠습니다.',
    answers: [
      '배송 앱 취소 화면 개선에서 저는 설문 설계와 분석을 맡았습니다. 응답 60건에서 취소 사유가 배송 지연에 몰려 있다는 점을 확인해 안내 문구를 먼저 바꾸자고 팀에 제안했습니다.',
      '의견이 갈렸을 때는 사용자 설문 결과를 기준으로 삼았고, 두 안을 한 주씩 시험해 취소 문의 수를 비교한 뒤 결정했습니다.',
    ],
  },
  // 앱 샘플(대입, 2026-10-31): UI 목록에는 이것만 노출한다(ui:true). 위 company 1건은 레거시 테스트용(가상 학교 fixture는 삭제).
  ...SAMPLE_SCHOOLS.map((s) => ({
    id: s.id, kind: 'university', seed: FIXTURE_SEED, ui: true, title: `${s.school_name} ${s.department} — ${s.admission_track}`, label: SAMPLE_LABEL,
    school_name: s.school_name, department: s.department, track: s.admission_track,
    posting_text: s.institution_text, application_text: s.application_text, experiences: [...s.experience_notes], answers: [...s.answers],
  })),
]);

export const getFixture = (id) => FIXTURES.find((f) => f.id === id) || null;
export const uiFixtures = () => FIXTURES.filter((f) => f.ui);
// 목록용 요약: 본문 제외
export const fixtureSummary = (f) => ({ id: f.id, kind: f.kind, title: f.title, synthetic: true, school_name: f.school_name || null, label: f.label || null });
export const fixtureDetail = (f) => ({ ...fixtureSummary(f), department: f.department || null, track: f.track || null, posting_text: f.posting_text, application_text: f.application_text, experiences: [...(f.experiences || [])], answers: [...f.answers], seed: f.seed });

// NFC + 공백 정규화(비교 전용)
export const normalizeText = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

// 프로필 판정: fixture_id가 유효하고, 공고·지원서 정규화 해시가 모두 서버 fixture와 같을 때만 true. 어떤 클라이언트 플래그도 읽지 않는다.
export async function isSyntheticProfileBody(body, { demoFixtures = true } = {}) {
  const f = demoFixtures ? getFixture(body?.fixture_id) : null;
  if (!f) return false;
  const [a, b, c, d] = await Promise.all([
    sha256Hex(normalizeText(body.source_text)), sha256Hex(normalizeText(f.posting_text)),
    sha256Hex(normalizeText(body.application_text)), sha256Hex(normalizeText(f.application_text)),
  ]);
  return a === b && c === d;
}

const ANSWERS = new Set(FIXTURES.flatMap((f) => f.answers.map(normalizeText)));
// 턴 판정: 답변 텍스트가 fixture 샘플 답변과 일치할 때만 true
export const isSyntheticText = (text) => ANSWERS.has(normalizeText(text));
// 공급자 게이트(WP-B1)용: 턴의 최신 사용자 답변이 합성인가
export function isSyntheticTurn(store, turnId) {
  const revs = store.getRevisions(turnId);
  return revs.length > 0 && revs[revs.length - 1].synthetic === true;
}
