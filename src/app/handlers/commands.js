// 동작 불변 추출(WP-A1): src/server.js에서 옮긴 핸들러. 반환은 { status, body } 또는 { error, status }.
import { randomUUID, sha256Hex } from '../crypto.js';
import { detectPii, buildBlindContext } from '../../domain/pii.js';
import { linkAnswersToInstitution } from '../../domain/institution.js';
import { followupForRole, ROLES } from '../../domain/roles.js';
import { canSessionTransition } from '../../domain/state.js';
import { FOLLOWUPS, followupReasonFor } from '../../domain/questions.js';
import { buildMockEvaluation } from '../../domain/mock-eval.js';
import { validateEvaluation } from '../../domain/evaluation.js';
import { rubricForInterviewType, getRubric } from '../../domain/rubrics.js';
import { buildTypedEvaluation } from '../../domain/mock-eval-typed.js';
import { validateEvaluationGeneric } from '../../domain/evaluation-generic.js';
import { nextAiUtterance, moderatorLine, recordDiscussionTurn } from '../../domain/discussion.js';

export function createCommandHandlers(d) {
  const { config, store, ledger, err, now, priceOf, providerFor, provider, publicSession } = d;
  // 유형·단계별 평가 차원 매핑: 보고서의 근거 차원은 발화 시점의 단계로 고정한다.
  const discussionTurnDims = (phase, userTurnNo) => {
    if (userTurnNo <= 1) return ['claim_understanding', 'evidence_use'];
    if (userTurnNo === 2) return ['rebuttal', 'claim_understanding', 'evidence_use'];
    if (userTurnNo === 3) return ['rebuttal', 'collaboration', 'evidence_use'];
    return ['collaboration', 'claim_understanding', 'evidence_use'];
  };
  const situationalTurnDims = (idx, followupCount) => {
    if (idx === 0) return ['role_understanding', 'responsiveness', 'reasoning'];
    if (idx === 1) return ['responsiveness', 'reasoning', 'role_understanding'];
    if (idx <= followupCount) return ['role_understanding', 'reasoning', 'reflection'];
    return ['reflection', 'responsiveness', 'reasoning'];
  };

  async function runCommand(owner, sessionId, body, requestId) {
    const s = store.getSession(owner, sessionId);
    if (!s) return err('not_found', '세션을 찾을 수 없습니다.', 404);
    if (s.state === 'deleting' || s.state === 'deleted') return err('not_found', '세션을 찾을 수 없습니다.', 404);
    const commandId = body.command_id;
    if (!commandId) return err('validation_error', 'command_id가 필요합니다.', 422);
    const key = `${sessionId}:${commandId}`;
    const hash = await sha256Hex(JSON.stringify(body.payload || {}));
    const prior = store.commands.get(key);
    if (prior) {
      if (prior.request_hash !== hash) return err('conflict', '동일 command_id에 다른 본문이 사용되었습니다.', 409);
      return { status: 202, body: prior.response };
    }
    const expected = body.expected_version;
    if (expected !== undefined && expected !== s.version) return err('conflict', '예상 버전이 일치하지 않습니다.', 409, { details: { current_version: s.version } });
    const type = body.type;
    const payload = body.payload || {};
    const accept = (response) => {
      store.commands.set(key, { request_hash: hash, response });
      return { status: 202, body: response };
    };

    if (type === 'session.start') {
      if (s.state === 'paused') return err('conflict', '일시정지 상태에서는 재개를 사용하세요.', 409);
      if (s.state !== 'ready') return err('conflict', '시작할 수 없는 상태입니다.', 409);
      if (!canSessionTransition(s.state, 'active')) return err('conflict', '전이 불가', 409);
      store.updateSession(s, { state: 'active', started_at: now() });
      store.pushEvent(s.id, 'session.snapshot', { state: 'active' });
      // 유형별 시작 멘트: 토론은 사회자 오프닝 + A 입론, PT는 과제 브리핑
      const it = s.interview_type || s.mode || 'general';
      let openings = [];
      if (it === 'discussion' && s.discussion) {
        const open = moderatorLine(s.discussion, 'open');
        recordDiscussionTurn(s.discussion, { speaker_id: 'moderator', claim_id: 'c-open', text: open });
        const aiA = nextAiUtterance(s.discussion, 'ai-a', '');
        recordDiscussionTurn(s.discussion, { speaker_id: aiA.speaker_id, claim_id: aiA.claim_id, text: aiA.text });
        store.pushEvent(s.id, 'assistant.message', { utterance: open, speaker_id: 'moderator', discussion_phase: s.discussion.phase });
        store.pushEvent(s.id, 'assistant.message', { utterance: aiA.text, speaker_id: aiA.speaker_id, speaker_name: aiA.speaker_name, claim_id: aiA.claim_id, discussion_phase: s.discussion.phase });
        openings = [{ speaker_id: 'moderator', utterance: open }, { speaker_id: aiA.speaker_id, speaker_name: aiA.speaker_name, utterance: aiA.text, claim_id: aiA.claim_id }];
        store.updateSession(s, {});
      } else if (it === 'pt') {
        store.updateSession(s, { pt_phase: 'brief' });
        store.pushEvent(s.id, 'assistant.message', { utterance: s.pt_brief, speaker_id: 'moderator', pt_phase: 'brief' });
      } else if (it === 'situational') {
        store.updateSession(s, { scenario_index: 0 });
        store.pushEvent(s.id, 'assistant.message', { utterance: s.questions[0]?.text || '', speaker_id: 'interviewer', scenario_id: s.scenario_id });
      } else if (it === 'panel' && Array.isArray(s.panel_roles) && s.panel_roles.length) {
        store.pushEvent(s.id, 'assistant.message', { utterance: `패널 면접을 시작합니다. ${s.panel_roles.map((r) => ROLES[r]?.label || r).join(' · ')} 면접관이 돌아가며 질문합니다.`, speaker_id: 'moderator' });
      }
      const base0 = { command_id: commandId, state: 'active', version: s.version, question: s.questions[s.q_index], question_total: s.questions.length, last_seq: (store.events.get(s.id) || []).length };
      if (openings.length) base0.openings = openings;
      if (it === 'discussion') base0.discussion = publicSession(s).discussion;
      if (it === 'pt') { base0.pt_phase = s.pt_phase; base0.pt_task = publicSession(s).pt_task; }
      if (it === 'situational') base0.scenario = publicSession(s).scenario;
      if (it === 'panel') base0.panel_roles = publicSession(s).panel_roles;
      return accept(base0);
    }
    if (type === 'pt.prepare') {
      if (s.interview_type !== 'pt') return err('validation_error', 'PT 세션에서만 사용할 수 있습니다.', 422);
      if (s.state !== 'active') return err('conflict', '진행 중인 세션에서만 단계를 바꿀 수 있습니다.', 409);
      const to = String(payload.phase || '');
      if (!['brief', 'prepare', 'present', 'qa'].includes(to)) return err('validation_error', '단계 값이 올바르지 않습니다.', 422);
      // 건너뛰기 금지: brief → prepare → present → qa 순서만 허용
      const order = ['brief', 'prepare', 'present', 'qa'];
      const from = order.indexOf(s.pt_phase || 'brief');
      const target = order.indexOf(to);
      if (target < from || target > from + 1) return err('conflict', 'PT 단계는 순서대로만 진행할 수 있습니다.', 409, { details: { current: s.pt_phase, requested: to } });
      store.updateSession(s, { pt_phase: to });
      let utterance = null;
      if (to === 'prepare') utterance = `준비 시간 ${Math.round((s.pt_prepare_seconds || 180) / 60)}분입니다. 과제를 읽고 발표 구조를 정리하세요. 준비가 끝나면 “발표 시작”을 누르세요.`;
      if (to === 'present') utterance = `발표 시간 ${Math.round((s.pt_present_seconds || 180) / 60)}분입니다. 결론 → 근거 → 실행계획 순서로 발표해 보세요.`;
      if (to === 'qa') utterance = s.pt_qa?.[0] || '질의응답을 시작합니다.';
      if (utterance) store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', pt_phase: to });
      return accept({ command_id: commandId, state: s.state, version: s.version, pt_phase: to, pt_qa_index: s.pt_qa_index || 0, utterance });
    }
    if (type === 'session.pause') {
      if (s.state !== 'active') return err('conflict', '진행 중인 세션만 일시정지할 수 있습니다.', 409);
      store.updateSession(s, { state: 'paused', active_elapsed_ms: s.active_elapsed_ms + (s.started_at ? Math.max(0, Date.now() - Date.parse(s.started_at)) : 0) });
      store.pushEvent(s.id, 'session.paused', {});
      return accept({ command_id: commandId, state: 'paused', version: s.version });
    }
    if (type === 'session.resume') {
      if (s.state !== 'paused') return err('conflict', '일시정지 상태가 아닙니다.', 409);
      store.updateSession(s, { state: 'active', started_at: now() });
      store.pushEvent(s.id, 'session.snapshot', { state: 'active' });
      return accept({ command_id: commandId, state: 'active', version: s.version });
    }
    if (type === 'turn.text' || type === 'turn.commit') {
      if (s.state !== 'active') return err('conflict', '진행 중인 세션에서만 답변할 수 있습니다.', 409);
      // 서버 시계 기준 시간 상한(클라이언트 타이머 조작과 무관)
      const elapsedMs = s.active_elapsed_ms + (s.started_at ? Math.max(0, Date.now() - Date.parse(s.started_at)) : 0);
      if (elapsedMs >= s.duration_seconds * 1000) return finishSession(owner, s, accept, commandId);
      let text = String(payload.text || '').trim();
      if (!text) return err('validation_error', '답변이 비어 있습니다.', 422);
      if ([...text].length > config.limits.maxAnswerChars) return err('validation_error', '답변은 4,000자 이하여야 합니다.', 422);
      // 블라인드 모드: 저장·평가에 쓰이는 텍스트에서 학교·성별·출신 단서를 마스킹한다.
      // (완전 익명화 보장은 아니며, 원문은 저장하지 않는다.)
      if (s.blind) text = buildBlindContext(text);
      const answered = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user').length;
      if (answered >= config.limits.maxUserTurns) return finishSession(owner, s, accept, commandId);
      const it = s.interview_type || s.mode || 'general';
      // 토론 턴: 사용자 발언 → 상태 기록 → 다음 화자 1명 발언을 함께 반환.
      // 4번째 사용자 발언이 끝나면 사회자가 정리하고 자동 종료한다(발언 기회 4회 보장).
      if (it === 'discussion') {
        const q = s.questions[Math.min(s.q_index, s.questions.length - 1)];
        const phaseBefore = s.discussion?.phase || 'opening';
        const dims = discussionTurnDims(phaseBefore, (s.discussion?.user_turns || 0) + 1);
        const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: q.primary, followup: false, elicited_dims: dims });
        const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
        recordDiscussionTurn(s.discussion, { speaker_id: 'user', claim_id: `c-u-${s.discussion.total_turns + 1}`, text });
        store.pushEvent(s.id, 'assistant.message', { utterance: text, speaker_id: 'user', discussion_phase: s.discussion.phase });
        const utterances = [];
        // 다음 발언: 사용자 → (AI 1명) → 사용자. 사회자는 단계 안내만 한다.
        if (s.discussion.next_speaker === 'user') {
          const line = moderatorLine(s.discussion, s.discussion.phase === 'agreement' ? 'agreement' : 'to_user');
          utterances.push({ speaker_id: 'moderator', utterance: line });
          store.pushEvent(s.id, 'assistant.message', { utterance: line, speaker_id: 'moderator', discussion_phase: s.discussion.phase });
          store.updateSession(s, {});
          return accept({ command_id: commandId, state: s.state, version: s.version, action: 'await_user', utterance: line, utterances, turn_id: turn.id, revision: rev.revision, discussion: publicSession(s).discussion, followups_used: s.followups_used, llm_calls: s.llm_calls });
        }
        if (s.discussion.next_speaker === 'moderator') {
          const closing = moderatorLine(s.discussion, 'closing');
          utterances.push({ speaker_id: 'moderator', utterance: closing });
          store.pushEvent(s.id, 'assistant.message', { utterance: closing, speaker_id: 'moderator', discussion_phase: 'closing' });
          s.q_index = s.questions.length - 1;
          store.updateSession(s, {});
          // 종료 응답은 사회자 마무리 멘트와 토론 상태를 함께 돌려준다(기록도 같은 본문).
          let captured = null;
          const fin = await finishSession(owner, s, (resp) => {
            captured = {
              ...resp, action: 'discussion_complete', utterance: closing, utterances,
              turn_id: turn.id, revision: rev.revision, discussion: publicSession(s).discussion,
            };
            accept(captured);
          }, commandId);
          if (fin.error) return fin;
          return { status: fin.status, body: captured || fin.body };
        }
        const ai = nextAiUtterance(s.discussion, s.discussion.next_speaker, text);
        recordDiscussionTurn(s.discussion, { speaker_id: ai.speaker_id, claim_id: ai.claim_id, text: ai.text });
        store.pushEvent(s.id, 'assistant.message', { utterance: ai.text, speaker_id: ai.speaker_id, speaker_name: ai.speaker_name, claim_id: ai.claim_id, responds_to: ai.responds_to, discussion_phase: s.discussion.phase });
        utterances.push({ speaker_id: ai.speaker_id, speaker_name: ai.speaker_name, utterance: ai.text, claim_id: ai.claim_id });
        // AI 발언 뒤에는 항상 사용자 차례 → 사회자 안내를 덧붙인다
        if (s.discussion.next_speaker === 'user') {
          const line = moderatorLine(s.discussion, s.discussion.phase === 'agreement' ? 'agreement' : 'to_user');
          utterances.push({ speaker_id: 'moderator', utterance: line });
          store.pushEvent(s.id, 'assistant.message', { utterance: line, speaker_id: 'moderator', discussion_phase: s.discussion.phase });
        }
        // 질문 슬롯을 사용자 발언 수에 맞춰 전진 (보고서 elicited 보조 매핑)
        s.q_index = Math.min(s.discussion.user_turns, s.questions.length - 1);
        store.updateSession(s, {});
        return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ai_speaks', utterance: ai.text, utterances, turn_id: turn.id, revision: rev.revision, discussion: publicSession(s).discussion, followups_used: s.followups_used, llm_calls: s.llm_calls });
      }
      // PT 턴: 발표 단계와 Q&A 단계의 답변만 평가 대상으로 기록한다.
      if (it === 'pt') {
        let phase = s.pt_phase || 'brief';
        // 준비 단계에서 바로 발표를 시작해도 막히지 않게 첫 발표 발언으로 기록한다.
        if (phase === 'brief' || phase === 'prepare') {
          store.updateSession(s, { pt_phase: 'present' });
          phase = 'present';
        }
        const inQa = phase === 'qa';
        const qid = inQa ? 'pt-qa' : 'pt-present';
        const q = s.questions.find((x) => x.id === qid) || s.questions[0];
        const dims = inQa ? ['qa_response', 'evidence_use'] : ['structure', 'evidence_use', 'execution_plan'];
        const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: q.primary, followup: inQa, elicited_dims: dims });
        const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
        store.pushEvent(s.id, 'assistant.message', { utterance: text, speaker_id: 'user', pt_phase: phase });
        let utterance = '';
        if (!inQa) {
          const presentCount = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user' && t.question_id === 'pt-present').length;
          if (presentCount >= 2) {
            store.updateSession(s, { pt_phase: 'qa', pt_qa_index: 0 });
            utterance = s.pt_qa[0] || '질의응답을 시작합니다. 질문에 답해 주세요.';
          } else {
            utterance = '발표를 이어가거나, 준비가 끝났으면 “발표 완료”라고 입력해 주세요. 발표가 끝나면 Q&A가 이어집니다.';
          }
        } else {
          const idx = (s.pt_qa_index || 0) + 1;
          if (idx >= s.pt_qa.length) {
            store.updateSession(s, { pt_qa_index: idx });
            return finishSession(owner, s, accept, commandId);
          }
          store.updateSession(s, { pt_qa_index: idx });
          utterance = s.pt_qa[idx];
        }
        store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', pt_phase: s.pt_phase });
        store.updateSession(s, {});
        return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ask_followup', utterance, turn_id: turn.id, revision: rev.revision, pt_phase: s.pt_phase, pt_qa_index: s.pt_qa_index, followups_used: s.followups_used, llm_calls: s.llm_calls });
      }
      // 상황·역할극: 시나리오 오프닝 → 후속 2개 → 성찰 질문 → 종료 (모두 검수된 고정 문장)
      if (it === 'situational') {
        const idx = s.scenario_index || 0; // 0=오프닝 답변, 1..n=후속, n+1=성찰
        const followups = s.scenario_followups || [];
        const inFollowup = idx >= 1;
        const q = s.questions[0];
        const dims = situationalTurnDims(idx, followups.length);
        const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: dims[0], followup: inFollowup, elicited_dims: dims });
        const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
        store.pushEvent(s.id, 'assistant.message', { utterance: text, speaker_id: 'user', scenario_id: s.scenario_id });
        const nextIdx = idx + 1;
        store.updateSession(s, { scenario_index: nextIdx });
        if (nextIdx <= followups.length) {
          const utterance = followups[nextIdx - 1];
          store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', scenario_id: s.scenario_id });
          return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ask_followup', utterance, turn_id: turn.id, revision: rev.revision, scenario_index: nextIdx, followups_used: s.followups_used, llm_calls: s.llm_calls });
        }
        if (nextIdx === followups.length + 1) {
          const utterance = '마지막으로, 이 상황에서 본인이 택한 대응을 다음에 다시 한다면 무엇을 바꾸겠습니까? 그렇게 판단한 기준도 함께 말해 주세요.';
          store.pushEvent(s.id, 'assistant.message', { utterance, speaker_id: 'interviewer', scenario_id: s.scenario_id });
          return accept({ command_id: commandId, state: s.state, version: s.version, action: 'ask_followup', utterance, turn_id: turn.id, revision: rev.revision, scenario_index: nextIdx, followups_used: s.followups_used, llm_calls: s.llm_calls });
        }
        return finishSession(owner, s, accept, commandId);
      }
      const q = s.questions[s.q_index];
      if (!q) return err('conflict', '남은 질문이 없습니다.', 409);
      const followupTurn = !!q._followedUp && s.followups_used > 0;
      const turn = store.createTurn(s.id, { speaker_id: 'user', question_id: q.id, competency: q.primary, followup: followupTurn });
      const rev = store.addRevision(turn.id, text, 'user', detectPii(text).map((x) => x.type));
      // 예산: 대화 호출 1회 예약(보수적 상한)
      if (s.llm_calls >= config.budgets.maxLlmCallsPerSession - 3) {
        // 평가/repair 슬롯 3회 보존
        return finishSession(owner, s, accept, commandId);
      }
      let utterance = q.text;
      let action = 'next_question';
      let followupReason = null;
      let geminiUsed = false;
      let geminiModel = null;
      // 패널: 현재 질문 담당 역할의 꼬리질문 전략을 사용 (평가는 동일 루브릭)
      const panelRole = (s.interview_type === 'panel') ? (q._panel_role || (s.panel_roles || [])[s.q_index % (s.panel_roles || ['practitioner']).length] || s.interviewer_role) : s.interviewer_role;
      const needFollowup = s.followups_used < config.limits.maxFollowupsTotal && !q._followedUp;
      if (needFollowup) {
        followupReason = followupReasonFor(text);
        action = 'ask_followup';
      }
      try {
        ledger.reserve(`session:${s.id}`, 0.005);
        // highschool 세션은 Mock 강제(미성년자 보호). 공급자는 서버 상태로만 정한다(요청 본문 무시).
        const { provider: useProvider } = providerFor({ forceMock: !!s.highschool_mock });
        // 최근 대화(최대 4턴)를 문맥으로 전달: Gemini가 답변 근거를 활용하도록
        const pastTurns = store.sessionTurns(s.id).slice(-5, -1);
        const history = pastTurns.map((t) => {
          const revs = store.getRevisions(t.id);
          const last = revs[revs.length - 1];
          const qq = s.questions.find((x) => x.id === t.question_id);
          return { question: qq?.text || '', answer: last?.normalized_text || '' };
        }).filter((h) => h.question || h.answer);
        history.push({ question: q.followup || q.text, answer: text });
        const result = await useProvider.next({
          persona: s.persona, role: panelRole, followupReason,
          questionText: q.followup || q.text, recentAnswer: text,
          interviewType: s.interview_type, history,
        });
        ledger.settle(`session:${s.id}`, 0.005, priceOf(result.model, result.usage));
        utterance = result.utterance;
        if (useProvider.name === 'gemini') {
          // Gemini 실생성 사용 표시(보고서·로그에서 Mock과 구분)
          s.degraded_reason = null;
          geminiUsed = true;
          try { geminiModel = result.model || useProvider.model; } catch { geminiModel = config.gemini.textModel; }
          store.pushEvent(s.id, 'provider.used', { provider: 'gemini', model: geminiModel || result.model });
        }
      } catch (e) {
        // 대체: 검증된 정적 후속/다음 질문 (예약이 있었으면 unknown 처리)
        if (e.code === 429) {
          // 무료 한도 소진: 추가 과금 없이 종료. 유료 모델로 자동 전환 금지.
          s.degraded_reason = 'free_quota_exhausted';
          store.pushEvent(s.id, 'budget.warning', { reason: 'free_quota_exhausted', fallback: 'static', retryable: false });
          utterance = q.text;
          return finishSession(owner, s, accept, commandId);
        }
        const res = ledger.usage(`session:${s.id}`);
        if (res.reserved > 0) ledger.settle(`session:${s.id}`, 0.005, 0.005, { unknown: !e.code || e.code >= 500 });
        // Fallback 전용: 검증된 정적 후속/역할 문장 (Mock 경로와 동일 전략)
        if (followupReason) {
          utterance = followupForRole(panelRole, followupReason, null) || FOLLOWUPS[followupReason] || q.text;
        } else {
          utterance = q.text;
        }
        s.degraded_reason = 'provider_fallback';
        store.pushEvent(s.id, 'budget.warning', { reason: 'provider_fallback', fallback: 'static' });
      }
      s.llm_calls += 1;
      const panel_prefix = (s.interview_type === 'panel' && panelRole) ? `[${(ROLES[panelRole] || {}).label || panelRole}] ` : '';
      if (action === 'ask_followup') {
        s.followups_used += 1;
        q._followedUp = true;
        utterance = panel_prefix + utterance;
        store.pushEvent(s.id, 'assistant.message', { utterance, action: 'ask_followup', target_competency: q.primary, followup_reason: followupReason, speaker_role: panelRole });
      } else {
        s.followups_used = 0;
        s.q_index += 1;
        if (s.q_index >= s.questions.length) {
          return finishSession(owner, s, accept, commandId);
        }
        // 다음 질문은 검수된 팩 문장을 사용(모델이 평가·사실을 만들지 않음)
        utterance = s.questions[s.q_index].text;
        if (s.interview_type === 'panel') {
          const nr = s.questions[s.q_index]._panel_role || (s.panel_roles || [])[s.q_index % (s.panel_roles || ['practitioner']).length];
          utterance = `[${(ROLES[nr] || {}).label || nr}] ${utterance}`;
          store.pushEvent(s.id, 'assistant.message', { utterance, action: 'next_question', target_competency: s.questions[s.q_index].primary, speaker_role: nr });
        } else {
          store.pushEvent(s.id, 'assistant.message', { utterance, action: 'next_question', target_competency: s.questions[s.q_index].primary });
        }
      }
      store.updateSession(s, {});
      const resp = {
        command_id: commandId, state: s.state, version: s.version, action, utterance,
        turn_id: turn.id, revision: rev.revision, current_question: s.questions[s.q_index] || null,
        followups_used: s.followups_used, llm_calls: s.llm_calls,
        provider: geminiUsed ? 'gemini' : 'mock',
        ...(geminiUsed && geminiModel ? { model: geminiModel } : {}),
        ...(s.degraded_reason ? { degraded_reason: s.degraded_reason } : {}),
      };
      if (s.interview_type === 'panel') resp.speaker_role = panelRole;
      return accept(resp);
    }
    if (type === 'session.finish') return finishSession(owner, s, accept, commandId);
    return err('validation_error', '알 수 없는 명령입니다.', 422);
  }

  function finishSession(owner, s, accept, commandId) {
    return finishSessionAsync(owner, s, accept, commandId);
  }

  async function finishSessionAsync(owner, s, accept, commandId) {
    if (s.state === 'completed') return err('conflict', '이미 완료된 세션입니다.', 409);
    if (!canSessionTransition(s.state, 'completing')) return err('conflict', '종료할 수 없는 상태입니다.', 409);
    // 토론 세션은 사용자 발언 기회 미달 시 협업 차원을 보류하고 안내를 보고서에 포함한다
    const it0 = s.interview_type || s.mode || 'general';
    if (it0 === 'discussion' && s.discussion && s.discussion.user_turns < 4) {
      store.pushEvent(s.id, 'session.snapshot', { note: 'discussion_user_turns_below_4' });
    }
    void it0;
    store.updateSession(s, { state: 'completing' });
    const turns = store.sessionTurns(s.id).filter((t) => t.speaker_id === 'user');
    const turnsWithText = [];
    for (const t of turns) {
      const revs = store.getRevisions(t.id);
      const rev = revs[revs.length - 1];
      if (!rev) continue;
      const q = s.questions.find((x) => x.id === t.question_id);
      // 발화 시점의 단계별 차원(토론·PT·역할극)을 우선 사용한다.
      let elicited;
      if (Array.isArray(t.elicited_dims) && t.elicited_dims.length) elicited = [...t.elicited_dims];
      else if (t.followup) elicited = [...(q?.followup_dimensions || [q?.primary || 'reflection'])];
      else elicited = q ? [q.primary, ...(q.secondary || [])] : [];
      turnsWithText.push({ turn_id: t.id, question_id: t.question_id, revision: rev.revision, text: rev.normalized_text, elicited });
    }
    // 평가 예산 예약(평가 슬롯 보존)
    let report = null;
    try {
      ledger.reserve(`session:${s.id}`, config.budgets.evalReserve);
      const it = s.interview_type || s.mode || 'general';
      const rubric_version = s.policy_snapshot?.rubric || rubricForInterviewType(it);
      const isLegacy = rubric_version === 'behavioral-ko-v1' && (it === 'general' || it === 'panel' || it === 'structured');
      let generated;
      if (isLegacy) {
        generated = buildMockEvaluation({ sessionId: s.id, turnsWithText });
        const v = validateEvaluation(generated, turnsWithText.map((t) => ({ turn_id: t.turn_id, revision: t.revision, speaker: 'user', text: t.text, elicited_dimensions: t.elicited })));
        if (!v.ok) throw new Error(v.errors.join('; '));
      } else {
        generated = buildTypedEvaluation({ rubricVersion: rubric_version, turnsWithText });
        const v = validateEvaluationGeneric(generated, turnsWithText.map((t) => ({ turn_id: t.turn_id, revision: t.revision, speaker: 'user', text: t.text, elicited_dimensions: t.elicited })), getRubric(rubric_version));
        if (!v.ok) throw new Error(v.errors.join('; '));
      }
      // 기관 연결: 공개 요구사항과 답변의 근거 연결 (평가 점수와 별도 레이어)
      let institution_link = { mode: 'general', note: '공고 연결 없이 일반 역량 기준으로만 분석합니다.', links: [], uncovered: [] };
      let institution_profile = null;
      if (s.profile_version_id) {
        const ver = store.getVersion(s.profile_version_id);
        const prof = ver ? store.getProfile(owner, ver.profile_id) : null;
        const inst = ver && prof ? store.getInstitution(prof.id)?.profile : null;
        if (inst) {
          institution_profile = { org_type: inst.org_type, org_label: inst.org_label, target_name: inst.target_name, role: inst.role, badge: inst.badge, fallback_to_general: inst.fallback_to_general, core_values: inst.core_values, unevaluable: inst.unevaluable, disclaimer: inst.disclaimer };
          institution_link = linkAnswersToInstitution({ institution: inst, turnsWithText });
        }
      }
      // 재연습 질문: 기관 미관찰 요구 우선
      const next_actions = [...(generated.next_actions || [])];
      for (const u of (institution_link.uncovered || []).slice(0, 2)) {
        if (next_actions.length >= 3) break;
        if (next_actions.some((a) => a.practice_question?.includes(u.requirement))) continue;
        next_actions.push({
          dimension_id: 'relevance',
          action: `다음 답변에서는 ‘${u.requirement}’ 요구와 연결되는 본인 행동 근거를 한 가지 덧붙이세요.`,
          practice_question: `‘${u.requirement}’ 요구와 연결되는 본인의 경험을 설명해 주세요.`,
          institution_requirement: u.requirement,
        });
      }
      report = {
        ...generated,
        next_actions: next_actions.slice(0, 3),
        evaluation_id: randomUUID(),
        status: 'ready',
        generated_at: now(),
        provider: provider.name,
        interviewer_role: s.interviewer_role || null,
        role_label: s.interviewer_role ? (ROLES[s.interviewer_role]?.label || null) : null,
        institution: institution_profile,
        institution_link,
        claim_links: buildClaimLinks(s, turnsWithText),
        badge: 'AI 생성 코칭 · 실제 합격 예측 아님',
        model_version: provider.name === 'gemini' ? config.gemini.textModel : 'mock-model-v1',
        interview_type: it,
        rubric_version,
        transcript_turn_count: turnsWithText.length,
      };
      store.evaluations.set(s.id, report);
      ledger.settle(`session:${s.id}`, config.budgets.evalReserve, Math.min(config.budgets.evalReserve, 0.002));
    } catch (e) {
      ledger.settle(`session:${s.id}`, config.budgets.evalReserve, config.budgets.evalReserve, { unknown: true });
      report = { status: 'failed', error_code: 'evaluation_failed', generated_at: now(), detail: '평가를 생성하지 못했습니다. 확정된 답변은 보존됩니다.', debug: String(e?.message || e).slice(0, 300) };
      store.evaluations.set(s.id, report);
    }
    store.updateSession(s, { state: 'completed', completed_at: now() });
    store.pushEvent(s.id, 'session.completed', { report_ready: report.status === 'ready' });
    if (report.status === 'ready') store.pushEvent(s.id, 'report.ready', { evaluation_id: report.evaluation_id });
    const response = { command_id: commandId, state: 'completed', version: s.version, report_status: report.status };
    if (accept) accept(response);
    return { status: 202, body: response };
  }

  // 지원서 주장 ↔ 실제 답변을 나란히 보여준다. 사실 여부를 판정하지 않는다.
  function buildClaimLinks(s, turnsWithText) {
    return s.questions.filter((q) => q.application_evidence?.length).map((q) => {
      const answers = turnsWithText.filter((t) => t.question_id === q.id).map((t) => ({ turn_id: t.turn_id, revision: t.revision, excerpt: Array.from(t.text).slice(0, 160).join('') }));
      return { question_id: q.id, claim_id: q.application_evidence[0].id, quote: q.application_evidence[0].quote, start_cp: q.application_evidence[0].start_cp, end_cp: q.application_evidence[0].end_cp, gaps: q.application_evidence[0].gaps, answered: answers.length > 0, answers };
    });
  }

  return { runCommand };
}
