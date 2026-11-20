"use client";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Send } from "lucide-react";
import { z } from "zod";
import {
  SURVEY_VERSION,
  surveyQuestions,
  surveyScale,
  type SurveyConfig,
  type SurveyAnswers,
} from "@/lib/survey";
type Session = { conversationId: string; token: string };
type Attempt = {
  requestId: string;
  conversationId: string;
  token: string;
  version: typeof SURVEY_VERSION;
  consent: true;
  answers: SurveyAnswers;
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
  const [ratings, setRatings] = useState({ helpfulness: 0, ease: 0, reuse: 0 }),
    [comment, setComment] = useState(""),
    [consent, setConsent] = useState(false);
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
    if (
      busy.current ||
      status === "done" ||
      !config.ready ||
      !consent ||
      Object.values(ratings).some((r) => r < 1)
    )
      return;
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
          answers: { ...ratings, comment: comment.trim() },
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
          <p className="fine-print">이메일 도착이나 수신자의 열람까지 확인했다는 뜻은 아니에요.</p>
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
          <p>
            세 가지 문항과 자유 의견을 준비했어요. 참여하지 않아도 대화를 계속하거나 마칠 수 있어요.
          </p>
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
            {surveyQuestions.map((q) => (
              <fieldset
                key={q.key}
                className="survey-question"
                disabled={locked || status === "sending"}
              >
                <legend>{q.label}</legend>
                <div className="rating-options">
                  {surveyScale.map((label, i) => (
                    <label key={label} className={ratings[q.key] === i + 1 ? "selected" : ""}>
                      <input
                        type="radio"
                        name={q.key}
                        value={i + 1}
                        checked={ratings[q.key] === i + 1}
                        required
                        onChange={() => setRatings((value) => ({ ...value, [q.key]: i + 1 }))}
                      />
                      <strong>{i + 1}</strong>
                      <span className="sr-only">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="rating-captions">
                  <span>전혀 그렇지 않아요</span>
                  <span>매우 그래요</span>
                </div>
              </fieldset>
            ))}
            <div className="survey-comment">
              <label htmlFor="survey-comment">
                더 나아졌으면 하는 점 <span>(선택)</span>
              </label>
              <textarea
                id="survey-comment"
                autoComplete="off"
                value={comment}
                maxLength={500}
                rows={3}
                disabled={locked || status === "sending"}
                onChange={(e) => setComment(e.target.value)}
                placeholder="화면이나 이용 경험에 대한 의견을 남겨 주세요."
              />
              <small>{comment.length} / 500 · 실명·연락처·상담 내용은 적지 마세요.</small>
            </div>
            <details className="survey-disclosure">
              <summary>설문 응답은 어떻게 전달되나요?</summary>
              <p>
                목적: 서비스 사용 경험 개선
                <br />
                항목: 위 세 문항의 점수와 직접 적은 자유 의견
                <br />
                수신: {config.recipient}의 운영 이메일
                <br />
                전달: 이메일 발송 서비스 Resend
                <br />
                보관·삭제 기준: {config.retention}
                <br />
                문의·삭제 요청: {contact || "문의처 확인 중"}
              </p>
              <p>
                채팅 원문·대화 요약·일기는 자동 첨부하지 않아요. 앱 DB에는 설문 내용을 저장하지
                않지만 운영자 메일함과 발송 서비스에서 처리·보관돼요. 접수·중복 방지용 기술 정보는
                최대 25시간 유지해요.
              </p>
            </details>
            <label className="survey-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={locked || status === "sending"}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                위 안내에 따라 설문 응답을 운영자의 이메일로 전달하는 데 동의합니다. (선택)
              </span>
            </label>
            {error && (
              <p className="error-note" role="alert">
                {error}
              </p>
            )}
            {locked && status === "error" && (
              <p className="fine-print">
                중복 전송을 막기 위해 전송을 요청한 응답 그대로 접수를 다시 확인해요.
              </p>
            )}
            <button
              className="primary"
              type="submit"
              disabled={
                !config.ready ||
                !consent ||
                Object.values(ratings).some((r) => r < 1) ||
                status === "sending"
              }
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
                  설문 제출하기
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
