# 주장 추출 규칙 정확도 (WP-C7)

- 코퍼스: `tests/eval/claims-corpus.json` (합성 49문장: 주장 23, 비주장 26; 다짐·소개·부정·수동·전언·수치만 있는 문장·짧은 이력서 줄 포함). 측정: `node tests/eval/measure-claims.mjs`.
- 개선 전(현재 규칙 + 이력서 줄 규칙): precision 0.88 (TP22 FP3), recall 0.957 (FN1).
- 개선 후(부정·전언·수동·선호 제외 `NOT_CLAIM`): precision 1.00, recall 0.957 (TP22 FP0 FN1; '만들었' 문장은 표지가 없어 미탐 — 표지로 추가하면 B3 모델 인용 테스트의 '규칙 미탐 인용' 전제가 깨져 추가하지 않음).
- 한계: 소규모 합성 코퍼스라 일반화 성능이 아니다(규칙을 코퍼스에 맞춰 조정함). 테스트 하한은 precision 0.95·recall 0.90(회귀 방지용). 검증된 AI 점수가 아니다.
