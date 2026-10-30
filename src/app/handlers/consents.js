// 동의 기록·합성 샘플 조회(WP-C6). 반환은 { status, body } 또는 err().
import { FIXTURES, getFixture, fixtureSummary, fixtureDetail } from '../../domain/fixtures.js';

export function createConsentHandlers(d) {
  const { config, store, err } = d;
  const off = () => err('not_found', '합성 샘플이 꺼져 있습니다.', 404);

  function createConsent(owner, body) {
    if (typeof body?.age_19_confirmed !== 'boolean') return err('validation_error', 'age_19_confirmed(true/false)가 필요합니다.', 422);
    // 만 19세 미만이면 "외부 AI 없이 연습함"을 이해했다는 확인(minor_notice_ack)이 필수다. 게이트의 age19는 age_19_confirmed만 본다.
    if (!body.age_19_confirmed && body.minor_notice_ack !== true) return err('validation_error', '만 19세 미만은 외부 AI 없이 연습함을 이해했다는 확인(minor_notice_ack)이 필요합니다.', 422);
    const nv = String(body.notice_version || '').trim();
    if (!nv || nv.length > 40) return err('validation_error', '안내문 버전(notice_version)이 필요합니다.', 422);
    return { status: 201, body: store.addConsent(owner, { age_19_confirmed: body.age_19_confirmed, minor_notice_ack: body.minor_notice_ack === true, notice_version: nv }) };
  }
  const listFixtures = () => (config.demoFixtures ? { status: 200, body: { fixtures: FIXTURES.filter((f) => f.kind !== 'company').map(fixtureSummary) } } : off());
  function getFixtureById(id) {
    if (!config.demoFixtures) return off();
    const f = getFixture(id);
    return f ? { status: 200, body: fixtureDetail(f) } : err('not_found', '샘플을 찾을 수 없습니다.', 404);
  }
  return { createConsent, listFixtures, getFixtureById };
}
