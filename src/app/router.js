// 플랫폼 중립 라우터(WP-A1): (Request, env, ctx) => Response. Web 표준 API만 쓴다.
// env·ctx는 Workers 호환 시그니처용이다. 설정은 createCore 시점에 이미 해석되어 있다.
import { randomUUID, sha256Hex } from './crypto.js';
import { readJsonBody } from './body.js';
import { createKeyedMutex } from './mutex.js';
import { err, now } from './util.js';

// 문서 업로드: 5MB 파일의 base64(~6.99MB)+JSON 여유. 그 외 경로는 기본 1MB 유지(BUG-9).
const DOCUMENT_BODY_LIMIT = 7_500_000;
const DOCUMENT_UPLOAD_PATH = /^\/api\/v1\/(?:profiles\/[^/]+\/documents|documents\/extract)$/;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

export function createFetchHandler({ store, auth, handlers: h, requestLog = [] }) {
  const mutex = createKeyedMutex();

  async function fetch(request, _env, _ctx) {
    const requestId = randomUUID();
    const url = new URL(request.url);
    const method = request.method;
    const p = url.pathname;
    requestLog.push({ request_id: requestId, method, path: p, time: now() });
    if (requestLog.length > 1000) requestLog.shift();
    // 핸들러 결과 → Response. 에러는 request_id를 덧붙인 평평한 JSON(기존 API 형식).
    const send = (r) => (r.error ? json(r.status, { ...r.error, request_id: requestId }) : json(r.status, r.body));
    const notFound = () => json(404, { error: { code: 'not_found', message: '경로를 찾을 수 없습니다.', retryable: false, request_id: requestId, details: null } });

    try {
      if (p === '/api/v1/health') return send(h.ops.health(!!auth(request)));
      if (p === '/api/v1/interview-types' && method === 'GET') return send(h.ops.interviewTypes());
      // 정적 UI는 어댑터 책임(Pages/Node). 라우터는 API만 다룬다.
      if (!p.startsWith('/api/')) return notFound();

      const owner = auth(request);
      if (!owner) return json(401, err('unauthorized', '인증이 필요합니다.', 401, { requestId }).error);

      if (p === '/api/v1/metrics' && method === 'GET') return send(await h.ops.metrics(request));
      // Groq STT 연결 상태(키 노출 없음, 상태만 반환)
      if (p === '/api/v1/stt/status' && method === 'GET') return json(200, h.stt.sttStatus(owner));
      if (p === '/api/v1/providers/status' && method === 'GET') return send(h.ops.providersStatus(owner));
      if (p === '/api/v1/diagnostics/gemini-models' && method === 'GET') return send(await h.ops.geminiModels(request, requestId));

      let m;
      // 사양 §10: WSS 일회성 티켓 (/ws?ticket=...) — MVP는 ticket 교환 후 REST 사용 안내
      if (method === 'GET' && (m = /^\/api\/v1\/sessions\/([^/]+)\/ws$/.exec(p))) {
        const ticket = url.searchParams.get('ticket') || request.headers.get('x-one-time-ticket');
        const t = h.sessions.useTicket(ticket);
        if (!t || t.session_id !== m[1] || t.owner !== owner) {
          return json(401, err('unauthorized', '유효한 일회성 티켓이 필요합니다. /connect로 다시 발급받으세요.', 401, { requestId }).error);
        }
        return json(200, { ok: true, session_id: m[1], transport: 'rest-mvp', note: 'MVP는 실시간 소켓 대신 REST 명령과 폴링(/events)으로 진행합니다.' });
      }

      const idemKey = request.headers.get('idempotency-key');
      const write = ['POST', 'DELETE', 'PUT', 'PATCH'].includes(method);
      if (write && !idemKey) return json(422, err('idempotency_required', 'Idempotency-Key 헤더가 필요합니다.', 422, { requestId }).error);

      const isTranscription = /^\/api\/v1\/sessions\/[^/]+\/transcriptions$/.test(p);
      let body = {};
      let bodyText = '';
      if (write && !isTranscription) ({ json: body, text: bodyText } = await readJsonBody(request, DOCUMENT_UPLOAD_PATH.test(p) ? DOCUMENT_BODY_LIMIT : undefined));

      const run = () => {
        // 같은 세션에 대한 쓰기는 도착 순서대로 직렬 실행한다(명령 인터리빙 방지).
        const sid = write && !isTranscription ? sessionLockKey(method, p) : null;
        return sid ? mutex.run(sid, () => dispatch(owner, request, url, body)) : dispatch(owner, request, url, body);
      };
      if (!write || isTranscription) return await run();
      // 쓰기: Idempotency-Key 재생(24시간, 성공 응답만).
      // 저장 키 = 소유자 + Idempotency-Key + 메서드 + 경로(+쿼리). 같은 키·같은 경로에 다른 본문(해시)이면 409.
      const fp = await sha256Hex(bodyText);
      return await withIdempotency(owner, `${idemKey} ${method} ${p}${url.search}`, fp, run, requestId);
    } catch (e) {
      if (e && e.error && e.status) return send(e); // 본문 파싱 등에서 던진 에러 객체
      const status = e.code === 413 ? 413 : e.code === 429 ? 429 : 500;
      return json(status, { error: { code: e.code || 'internal_error', message: status === 500 ? '서버 오류가 발생했습니다.' : e.message, retryable: !!e.retryable, request_id: requestId, details: null } });
    }

    // ---- 세션 직렬화 키: 세션을 바꾸는 쓰기 경로에서 세션 id를 뽑는다 ----
    function sessionLockKey(method2, path) {
      let mm = /^\/api\/v1\/sessions\/([^/]+)(?:\/(commands|connect))?$/.exec(path);
      if (mm && (method2 === 'POST' ? !!mm[2] : method2 === 'DELETE' && !mm[2])) return mm[1];
      mm = /^\/api\/v1\/turns\/([^/]+)\/revisions$/.exec(path);
      if (mm && method2 === 'POST') return store.getTurn(mm[1])?.session_id || null;
      return null;
    }

    async function withIdempotency(owner, key, fp, exec, rid) {
      const replay = (rec) => new Response(rec.text, { status: rec.status, headers: { ...JSON_HEADERS, 'Idempotent-Replayed': 'true' } });
      for (let attempt = 0; attempt < 2; attempt++) {
        const prior = store.getIdem(owner, key);
        if (!prior) break;
        if (prior.fp !== fp) return json(409, err('idempotency_key_reused', '같은 Idempotency-Key가 다른 요청에 사용되었습니다.', 409, { requestId: rid }).error);
        if (prior.promise) { await prior.promise.catch(() => {}); continue; } // 같은 요청이 진행 중: 끝나길 기다린다
        if (prior.status >= 200 && prior.status < 300) return replay(prior);
        break; // 이전 시도가 실패했으면 다시 실행한다(성공만 재생)
      }
      let done;
      const promise = new Promise((r) => { done = r; });
      store.putIdem(owner, key, { fp, promise, expires_at: Date.now() + IDEMPOTENCY_TTL_MS });
      try {
        const res = await exec();
        const text = await res.clone().text();
        // 5xx는 저장하지 않는다(재시도가 새로 실행되어야 한다).
        if (res.status < 500) store.putIdem(owner, key, { fp, status: res.status, text, expires_at: Date.now() + IDEMPOTENCY_TTL_MS });
        else store.putIdem(owner, key, { fp, status: res.status, text: '', expires_at: Date.now() + IDEMPOTENCY_TTL_MS });
        return res;
      } finally {
        done();
      }
    }

    async function dispatch(owner, req, u, body) {
      let mm;
      const pth = u.pathname;
      const mth = req.method;
      const id1 = () => mm[1];
      if (mth === 'POST' && pth === '/api/v1/consents') return send(h.consents.createConsent(owner, body));
      if (mth === 'GET' && pth === '/api/v1/fixtures') return send(h.consents.listFixtures());
      if ((mm = /^\/api\/v1\/fixtures\/([^/]+)$/.exec(pth)) && mth === 'GET') return send(h.consents.getFixtureById(id1()));
      if (mth === 'POST' && pth === '/api/v1/profiles') return send(await h.profiles.createProfile(owner, body, requestId));
      if ((mm = /^\/api\/v1\/profiles\/([^/]+)$/.exec(pth)) && mth === 'GET') return send(h.profiles.getProfile(owner, id1()));
      if ((mm = /^\/api\/v1\/profiles\/([^/]+)\/approve$/.exec(pth)) && mth === 'POST') return send(h.profiles.approveProfile(owner, id1(), body));
      if ((mm = /^\/api\/v1\/profiles\/([^/]+)\/sources$/.exec(pth)) && mth === 'POST') return send(h.profiles.addInstitutionSource(owner, id1(), body));
      if ((mm = /^\/api\/v1\/profiles\/([^/]+)\/institution$/.exec(pth)) && mth === 'GET') return send(h.profiles.getInstitution(owner, id1()));
      if (mth === 'POST' && pth === '/api/v1/sessions') return send(h.sessions.createSession(owner, body));
      if (mth === 'GET' && pth === '/api/v1/sessions') return send(h.ops.listSessions(owner));
      if ((mm = /^\/api\/v1\/sessions\/([^/]+)$/.exec(pth))) {
        if (mth === 'GET') return send(h.sessions.getSession(owner, id1()));
        if (mth === 'DELETE') return send(h.sessions.deleteSession(owner, id1()));
      }
      if ((mm = /^\/api\/v1\/sessions\/([^/]+)\/commands$/.exec(pth)) && mth === 'POST') return send(await h.commands.runCommand(owner, id1(), body, requestId));
      // Groq Whisper 전사: multipart 음성 → 텍스트(JSON). 원음은 저장하지 않고 전사 후 폐기.
      if ((mm = /^\/api\/v1\/sessions\/([^/]+)\/transcriptions$/.exec(pth)) && mth === 'POST') return send(await h.stt.transcribe(owner, id1(), req, requestId));
      if ((mm = /^\/api\/v1\/sessions\/([^/]+)\/connect$/.exec(pth)) && mth === 'POST') return send(h.sessions.connectSession(owner, id1()));
      if ((mm = /^\/api\/v1\/sessions\/([^/]+)\/events$/.exec(pth)) && mth === 'GET') return send(h.sessions.getEvents(owner, id1(), u.searchParams.get('after_seq')));
      if ((mm = /^\/api\/v1\/sessions\/([^/]+)\/report$/.exec(pth)) && mth === 'GET') return send(h.sessions.getReport(owner, id1()));
      if ((mm = /^\/api\/v1\/turns\/([^/]+)\/revisions$/.exec(pth)) && mth === 'POST') return send(h.feedback.addRevision(owner, id1(), body));
      if ((mm = /^\/api\/v1\/evaluations\/([^/]+)\/appeals$/.exec(pth)) && mth === 'POST') return send(h.feedback.createAppeal(owner, id1(), body));
      if ((mm = /^\/api\/v1\/appeals\/([^/]+)$/.exec(pth)) && mth === 'GET') return send(h.feedback.getAppeal(owner, id1()));
      if (pth === '/api/v1/practice-attempts' && mth === 'POST') return send(h.transfer.createPractice(owner, body));
      // P4 전이 비교: baseline + retry 두 시도를 같은 루브릭으로 비교한다.
      if (pth === '/api/v1/transfer-comparisons' && mth === 'POST') return send(h.transfer.createTransferComparison(owner, body));
      if ((mm = /^\/api\/v1\/transfer-comparisons\/([^/]+)$/.exec(pth)) && mth === 'GET') return send(h.transfer.getTransferJob(owner, id1()));
      // P1 문서 추출: TXT 직접 + PDF/DOCX 최소 안전 추출 (외부 전송 없음)
      if (pth === '/api/v1/documents/extract' && mth === 'POST') return send(h.documents.extractDocument(owner, body));
      if ((mm = /^\/api\/v1\/profiles\/([^/]+)\/documents$/.exec(pth)) && mth === 'POST') return send(await h.documents.uploadDocument(owner, id1(), body));
      if ((mm = /^\/api\/v1\/documents\/([^/]+)$/.exec(pth)) && mth === 'PATCH') return send(h.documents.editDocument(owner, id1(), body));
      if ((mm = /^\/api\/v1\/documents\/([^/]+)\/revisions$/.exec(pth)) && mth === 'GET') return send(h.documents.listRevisions(owner, id1()));
      // P2 월간 트렌드: 관리자 검수·공개, 사용자는 공개본만 조회
      if (pth === '/api/v1/admin/trends' && mth === 'POST') return send(await h.admin.draftTrend(owner, body, req));
      if (pth === '/api/v1/admin/trends' && mth === 'GET') return send(await h.admin.listTrends(owner, req));
      if (pth === '/api/v1/admin/status' && mth === 'GET') return send(h.ops.adminStatus());
      if ((mm = /^\/api\/v1\/admin\/trends\/(.+)\/history$/.exec(pth)) && mth === 'GET') return send(await h.ops.trendHistory(req, mm[1], requestId));
      // id는 encodeURIComponent(`${segment}|${yyyyMm}`) 형식. 디코딩 후 parseTrendId에서 분리한다.
      if ((mm = /^\/api\/v1\/admin\/trends\/(.+)\/(publish|rollback|unpublish)$/.exec(pth)) && mth === 'POST') {
        let trendId = mm[1];
        try { trendId = decodeURIComponent(trendId); } catch { /* raw 사용 */ }
        return send(await ({ publish: h.admin.publishTrend, rollback: h.admin.rollbackTrend, unpublish: h.admin.unpublishTrend })[mm[2]](owner, trendId, body, req));
      }
      if ((mm = /^\/api\/v1\/trends\/([^/]+)\/([^/]+)$/.exec(pth)) && mth === 'GET') return send(h.ops.publicTrend(mm[1], mm[2]));
      if (pth === '/api/v1/exports' && mth === 'POST') return send(h.account.createExport(owner, body));
      if ((mm = /^\/api\/v1\/exports\/([^/]+)$/.exec(pth)) && mth === 'GET') return send(h.account.getExport(owner, id1()));
      if (pth === '/api/v1/account' && mth === 'DELETE') return send(h.account.deleteAccount(owner));
      if ((mm = /^\/api\/v1\/deletions\/([^/]+)$/.exec(pth)) && mth === 'GET') return send(h.sessions.getDeletion(owner, id1()));
      return notFound();
    }
  }
  return fetch;
}
