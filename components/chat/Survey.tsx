"use client";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Send } from "lucide-react";
import { supportLink } from "@/lib/service-info";
import { z } from "zod";
import {
  SURVEY_VERSION,
  surveyQuestions,
  entryRoutes,
  updateSurvey,
  visibleQuestion,
  type SurveyDraft,
  type SurveyConfig,
} from "@/lib/survey";
type Session = { conversationId: string; token: string };
type Attempt = {
  requestId: string;
  conversationId: string;
  token: string;
  version: typeof SURVEY_VERSION;
  consent: true;
  answers: SurveyDraft;
};
class SurveyError extends Error {}
export default function Survey({
  visible,
  config,
  contact,
  session,
  onSession,
  onClose,
}: {
  visible: boolean;
  config: SurveyConfig;
  contact: string;
  session: Session | null;
  onSession: (value: Session) => void;
  onClose: () => void;
}) {
  const consentNote = useRef<HTMLParagraphElement>(null);
  const [answers, setAnswers] = useState<SurveyDraft>({});
  const update = (change: SurveyDraft) => setAnswers((previous) => updateSurvey(previous, change));
  const [status, setStatus] = useState<"idle" | "sending" | "error" | "done">("idle"),
    [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const attempt = useRef<Attempt | null>(null),
    controller = useRef<AbortController | null>(null),
    busy = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      controller.current?.abort();
    };
  }, []);
  async function submit() {
    if (busy.current || status === "done" || !config.ready || !answers.entryRoute) return;
    busy.current = true;
    setStatus("sending");
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (!attempt.current) {
        let active = session;
        if (!active) {
          const response = await fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
          });
          const raw = await response.json();
          if (!response.ok) throw new SurveyError(z.object({ error: z.string() }).parse(raw).error);
          active = z.object({ conversationId: z.string().uuid(), token: z.string() }).parse(raw);
          if (!live.current) return;
          onSession(active);
        }
        attempt.current = {
          ...active,
          requestId: crypto.randomUUID(),
          version: SURVEY_VERSION,
          consent: true,
          answers: { ...answers },
        };
        setLocked(true);
      }
      const response = await fetch("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attempt.current),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
      });
      const raw = await response.json();
      if (!live.current) return;
      if (!response.ok) throw new SurveyError(z.object({ error: z.string() }).parse(raw).error);
      z.object({ accepted: z.literal(true) }).parse(raw);
      setStatus("done");
    } catch (e) {
      if (live.current) {
        setStatus("error");
        setError(
          e instanceof SurveyError
            ? e.message
            : "설문 접수를 확인하지 못했어요. 입력은 그대로 두고 다시 확인해 주세요.",
        );
      }
    } finally {
      busy.current = false;
      controller.current = null;
    }
  }
  return (
    <section hidden={!visible} className="survey-panel">
      {status === "done" ? (
        <>
          <span className="survey-success" aria-hidden="true">
            <Check size={25} />
          </span>
          <h2 id="survey-title">의견을 남겨 주셔서 고마워요</h2>
          <p role="status">설문이 접수되었어요. 더 편안한 사용 경험을 만드는 데 참고하겠습니다.</p>
          <p className="fine-print">접수번호 {attempt.current?.requestId}</p>
          <button className="primary" onClick={onClose}>
            대화 화면으로 돌아가기
          </button>
        </>
      ) : (
        <>
          <span className="survey-badge">선택 참여 · 사용 경험 설문</span>
          <h2 id="survey-title">
            마지막으로,
            <br />
            사용 경험을 들려주세요
          </h2>
          <p>접속 경로만 골라도 제출할 수 있어요. 나머지는 답하고 싶은 문항만 골라주세요.</p>
          {!config.ready && (
            <p className="setup-note" role="status">
              설문 전송을 준비 중이에요. 현재는 응답을 제출할 수 없어요.
            </p>
          )}
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset className="survey-question" disabled={locked || status === "sending"}>
              <legend>이번 AI 대화는 어떤 경로로 이용하셨나요? (필수)</legend>
              {Object.entries(entryRoutes).map(([key, label]) => (
                <label className="survey-option" key={key}>
                  <input
                    required
                    type="radio"
                    name="entryRoute"
                    value={key}
                    checked={answers.entryRoute === key}
                    onChange={() => update({ entryRoute: key as keyof typeof entryRoutes })}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {answers.entryRoute && !locked && (
              <button
                className="skip-questions"
                type="button"
                onClick={() => consentNote.current?.focus()}
              >
                선택 문항을 건너뛰고 제출 안내로
              </button>
            )}
            {surveyQuestions
              .filter((q) => visibleQuestion(q, answers))
              .map((q) => {
                const labels = q.scale ?? q.options;
                return (
                  <fieldset
                    key={q.key}
                    className="survey-question"
                    disabled={locked || status === "sending"}
                  >
                    <legend>
                      {q.label} <small>(선택)</small>
                    </legend>
                    {labels ? (
                      <>
                        {labels.map((label, i) => {
                          const value = q.scale ? i + 1 : label;
                          return (
                            <label key={label} className="survey-option">
                              <input
                                name={q.key}
                                type="radio"
                                value={value}
                                checked={answers[q.key] === value}
                                onChange={() => update({ [q.key]: value })}
                              />
                              {q.scale && <b>{i + 1}</b>}
                              {label}
                            </label>
                          );
                        })}
                        {answers[q.key] != null && (
                          <button
                            type="button"
                            className="clear-answer"
                            onClick={() => update({ [q.key]: null })}
                          >
                            이 응답 지우기
                          </button>
                        )}
                      </>
                    ) : (
                      <textarea
                        aria-label={q.label}
                        rows={3}
                        maxLength={500}
                        value={answers[q.key] ?? ""}
                        onChange={(e) => update({ [q.key]: e.target.value })}
                        placeholder="개인정보를 제외하고 적어주세요."
                      />
                    )}
                  </fieldset>
                );
              })}
            <details className="survey-disclosure">
              <summary>설문 응답은 어떻게 전달되나요?</summary>
              <p>
                서비스 사용 경험을 개선하기 위해 접속 경로와 직접 답한 문항, 동의·접수 정보를
                받아요.
                {config.retention}
                <br />
                문의 및 삭제 요청: <a href={supportLink}>{contact}</a>
              </p>
              <p>
                설문 답변은 OpenAI로 보내지 않아요. 접수·중복 방지용 기술 정보는 최대 25시간
                유효하며 만료된 값은 다음 요청 때 정리해요.
              </p>
            </details>
            <p className="fine-print" ref={consentNote} tabIndex={-1}>
              제출하면 설문 답변을 Netlify Forms와 {config.recipient}의 운영 이메일에 전달하는 데
              동의해요. 두 곳에서 접수일로부터 1년간 보관한 뒤 운영자가 삭제해요. 채팅과 기록은
              첨부하지 않아요. 설문을 건너뛰어도 괜찮아요.
            </p>
            {error && (
              <p className="error-note" role="alert">
                {error}
              </p>
            )}
            {locked && status === "error" && (
              <p className="fine-print">
                중복 전송을 막기 위해 전송을 요청한 응답 그대로 접수 결과만 다시 확인해요. 전송이
                불확실하면 다시 보내지 않아요.
              </p>
            )}
            <button
              className="primary"
              type="submit"
              disabled={!config.ready || status === "sending"}
            >
              {status === "sending" ? (
                <>
                  <LoaderCircle size={17} className="spin" />
                  설문 접수 확인 중…
                </>
              ) : locked ? (
                <>
                  <Send size={17} />
                  같은 응답으로 접수 다시 확인
                </>
              ) : (
                <>
                  <Send size={17} />
                  동의하고 설문 제출하기
                </>
              )}
            </button>
            <button className="secondary" type="button" onClick={onClose}>
              {status === "sending" ? "대화 화면으로 돌아가기" : "설문 건너뛰고 돌아가기"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
