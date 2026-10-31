# Pages 배포 (WP-A4)

> **2026-10-31:** 현재 배포 경로는 Vercel([deploy-vercel.md](deploy-vercel.md))이다. Pages는 정적 UI만 올리고, 로그인·입장 비밀번호가 있는 API는 별도 서버가 필요하다.

정적 UI(`public/`)를 GitHub Pages로, API는 별도 서버(Node 또는 이후 Workers)로 둔다. 이 저장소는 배포를 실행하지 않는다. 개발자가 아래를 직접 설정한다.

## 설정
1. 저장소 Settings > Pages > Source = **GitHub Actions** (개발자가 직접 활성화).
2. 저장소 Variables에 `PAGES_API_BASE` = API 오리진(예: `https://api.example.com`, 끝 슬래시 없음). 비밀값이 아니므로 Variable이다.
3. API 서버 환경변수: `CORS_ALLOW_ORIGINS=https://<user>.github.io`(쉼표로 여러 개). 미설정이면 같은 오리진만. `*`는 무시된다.
4. API 서버가 정적 UI도 서빙하면 `API_BASE`를 같은 값으로 두면 CSP `connect-src`에 그 오리진이 추가된다.

## 동작
- `public/config.js`가 `window.__INTERVU__.API_BASE`를 정한다(기본 `''` = 같은 오리진). 워크플로가 `dist/config.js`를 재생성한다.
- 사전 요청(OPTIONS)은 허용 오리진에만 `Authorization, Content-Type, Idempotency-Key, x-admin-token`과 `GET/POST/PUT/PATCH/DELETE`를 허용한다. 목록 밖 오리진에는 CORS 헤더가 없다. 항상 `Vary: Origin`.
- CSP: GitHub Pages는 사용자 지정 응답 헤더를 지원하지 않는다. Cloudflare Pages 등을 쓰면 `public/_headers`의 `API_ORIGIN.example`을 실제 오리진으로 바꿔 쓴다(워크플로는 이 파일을 dist에서 제외). GitHub Pages에서는 `<meta http-equiv="Content-Security-Policy">`가 필요하나 아직 추가하지 않았다.
- `pages.yml`: `npm test` → dist 빌드 → `tools/check-bundle-secrets.mjs dist`(키 패턴 발견 시 실패) → main에서만 배포(`configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4`).

## 미검증
실제 Pages 배포, 외부 오리진 브라우저 CORS 동작, 액션 버전 존재 여부는 실행하지 않았다.
