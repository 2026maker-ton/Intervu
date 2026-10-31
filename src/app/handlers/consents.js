// 동의 기록·합성 샘플 조회(WP-C6). 반환은 { status, body } 또는 err().
import { uiFixtures, getFixture, fixtureSummary, fixtureDetail } from '../../domain/fixtures.js';

export function createConsentHandlers(d) {
  const { config, store, err } = d;
  const off = () => err('not_found', '합성 샘플이 꺼져 있습니다.', 404);

  // 서비스 대상은 만 18세 이상(2026-10-31). 가입이 주 경로이고, 이 API는 개발 토큰·구 클라이언트 호환용이다.
  // age_19_confirmed는 구 필드로만 받는다. 미성년(false)은 403.
  function createConsent(owner, body) {
    const adult = body?.age_18_confirmed ?? body?.age_19_confirmed;
    if (typeof adult !== 'boolean') return err('validation_error', 'age_18_confirmed(true/false)가 필요합니다.', 422);
    if (!adult) return err('age_restricted', '만 18세 이상만 이용할 수 있습니다.', 403);
    const nv = String(body.notice_version || '').trim();
    if (!nv || nv.length > 40) return err('validation_error', '안내문 버전(notice_version)이 필요합니다.', 422);
    return { status: 201, body: store.addConsent(owner, { age_18_confirmed: true, age_19_confirmed: body.age_19_confirmed === true, notice_version: nv }) };
  }
  const listFixtures = () => (config.demoFixtures ? { status: 200, body: { fixtures: uiFixtures().map(fixtureSummary) } } : off());
  function getFixtureById(id) {
    if (!config.demoFixtures) return off();
    const f = getFixture(id);
    return f ? { status: 200, body: fixtureDetail(f) } : err('not_found', '샘플을 찾을 수 없습니다.', 404);
  }
  return { createConsent, listFixtures, getFixtureById };
}
