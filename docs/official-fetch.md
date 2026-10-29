# 공식 자료 수집기 (WP-C2)

기본값은 **꺼짐**이다. `OFFICIAL_FETCH_ALLOW`(허용 도메인 접미사, 쉼표)가 비어 있으면 서버는 어떤 사이트에도 접속하지 않고 API는 403 `official_fetch_disabled`를 돌려준다.

## API
`POST /api/v1/profiles/:id/sources/:sid/fetch` — 인증·소유자 확인·속도 제한(`OFFICIAL_FETCH_RATE_PER_MINUTE/DAY`). `:sid`는 `POST /profiles/:id/sources`로 먼저 등록한 출처여야 한다. 결과는 Store(`setSourceFetch`/`getSourceFetches`)에 저장되고 계정 삭제·만료 시 함께 파기된다. 응답에는 본문 전체 대신 발췌와 `text_length`만 담는다.

## 방어
- http/https, 포트 80/443, 사용자정보·IP 리터럴·사설 호스트 문자열 차단(`validateSourceUrl`) + 허용 도메인 접미사 일치.
- DNS 해석 훅(`resolveDns`) 결과의 **모든** 주소가 공인 IP여야 한다: 사설/루프백/링크로컬/메타데이터(169.254.169.254)/ULA/멀티캐스트/CGNAT, IPv4-mapped·NAT64·6to4 IPv6. 해석기가 없으면 차단(fail closed).
- 리디렉션은 `redirect: 'manual'`로 최대 3회 직접 따라가며 매 홉마다 위 검사를 반복. 쿠키·자격증명 없음.
- 시간 제한(`OFFICIAL_FETCH_TIMEOUT_MS`), 스트리밍 크기 제한(`OFFICIAL_FETCH_MAX_BYTES`, 기본 1MB), 콘텐츠 타입 `text/html`·`text/plain`·`application/xhtml+xml`만.
- `/robots.txt`도 같은 검사로 가져와 `IntervuBot` 그룹(없으면 `*`)을 따른다. 불허 → `unavailable/robots_disallowed`. robots 5xx → 수집 안 함.
- 가져온 텍스트는 **비신뢰 데이터**: LLM에 넣지 않고 지시로 해석하지 않는다. 스크립트·스타일 제거, 엔티티 해독, NFC 정규화 후 `COMPETENCY_KEYWORDS` 키워드별 발췌만 만든다.

## 상태
| 상태 | 조건 |
|---|---|
| `official_verified` | 허용 도메인 + 수집 성공 + 발췌 ≥1 (stale·conflict 아님) |
| `unavailable` | 비활성·차단·DNS·robots·타임아웃·크기·타입·HTTP 오류(`reason`) |
| `stale` | 출처 `published_at`이 365일 초과 |
| `conflict` | 같은 "항목: 값" 키에 다른 값(같은 프로필의 다른 수집본 포함) |
| `unverified` | 수집됐지만 발췌 없음 |

발췌의 `start_cp`/`end_cp`는 저장된 추출 텍스트의 코드포인트 오프셋이다. `official_verified`만 기관 프로필 핵심 가치에 `basis: 'official'`로 반영된다.

## 한계
fetch는 연결 시 DNS를 다시 해석하므로 해석↔연결 사이 rebinding 틈이 남는다(허용 도메인 목록과 매 홉 재검사로 완화). Node 어댑터가 `node:dns/promises`를 해석기로 주입하며 코어는 Web 표준만 쓴다. 실제 네트워크 수집은 시험하지 않았다(전부 주입 fetch/dns).
