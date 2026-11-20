"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CircleHelp,
  ClipboardList,
  LoaderCircle,
  MessageCircle,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { emotions, greeting, type Message, type PublicConfig } from "@/lib/config";
import { z } from "zod";
import Survey from "./Survey";
import BrandMark from "./BrandMark";
import QuietGarden from "./QuietGarden";
import EmotionMark from "./EmotionMark";
import { installPagePrivacy } from "@/lib/browser/privacy";
const sessionResponse = z.object({ conversationId: z.string().uuid(), token: z.string() });
const chatResponse = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
  text: z.string(),
  token: z.string(),
  notice: z.boolean(),
  help: z.boolean(),
  conversationLimit: z.boolean().optional(),
});
const errorResponse = z.object({ error: z.string(), code: z.string().optional() });
class VisibleError extends Error {}
type Session = { conversationId: string; token: string };
type Pending = { text: string; action: "chat" | "summary" };
type Panel = "help" | "privacy" | "diary" | "reset" | "survey" | null;
export default function Chat({ config }: { config: PublicConfig }) {
  const [history, setHistory] = useState<Message[]>([]),
    [draft, setDraft] = useState("");
  const [session, setSession] = useState<Session | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "error" | "stopped">("idle"),
    [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>(null),
    [acknowledged, setAcknowledged] = useState(false),
    [help, setHelp] = useState(false),
    [unread, setUnread] = useState(false);
  const [diary, setDiary] = useState(
    "오늘 나는 ___한 상황에서 ___라고 생각했고, 사실은 ___가 필요했음을 알아차렸다.",
  );
  const [surveyEpoch, setSurveyEpoch] = useState(0),
    [surveyInvite, setSurveyInvite] = useState(false);
  const [conversationLimit, setConversationLimit] = useState(false);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const shell = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    running = useRef(false),
    nearBottom = useRef(true);
  const thread = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    ime = useRef(false);
  const reset = () => {
    generation.current++;
    controller.current?.abort();
    running.current = false;
    setHistory([]);
    setDraft("");
    setSession(null);
    setPending(null);
    setStatus("idle");
    setError("");
    setHelp(false);
    setUnread(false);
    setDiary("오늘 나는 ___한 상황에서 ___라고 생각했고, 사실은 ___가 필요했음을 알아차렸다.");
    setSurveyEpoch((e) => e + 1);
    setSurveyInvite(false);
    setConversationLimit(false);
    setSessionInvalid(false);
    setPanel(null);
    nearBottom.current = true;
  };
  useLayoutEffect(() => (shell.current ? installPagePrivacy(shell.current, reset) : undefined), []);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (panel) {
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [panel]);
  useEffect(() => {
    const field = input.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = Math.min(field.scrollHeight, 144) + "px";
    }
  }, [draft]);
  useEffect(() => {
    if (!history.length && !pending && status === "idle") {
      thread.current?.scrollTo({ top: 0 });
      return;
    }
    if (nearBottom.current) {
      thread.current?.scrollTo({ top: thread.current.scrollHeight });
      setUnread(false);
    } else setUnread(true);
  }, [history, pending, status]);
  const jump = () => {
    nearBottom.current = true;
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setUnread(false);
  };
  async function send(item?: Pending) {
    if (running.current || conversationLimit || sessionInvalid) return;
    const request = item || { text: draft.trim(), action: "chat" as const };
    if (!request.text || request.text.length > config.maxInput) return;
    if (!acknowledged) {
      setPanel("privacy");
      return;
    }
    running.current = true;
    const epoch = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setPending(request);
    setStatus("waiting");
    setError("");
    nearBottom.current = true;
    const requestId = crypto.randomUUID();
    try {
      let active = session;
      if (!active) {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        });
        const raw = await response.json();
        if (!response.ok) throw new VisibleError(errorResponse.parse(raw).error);
        active = sessionResponse.parse(raw);
        if (epoch !== generation.current) return;
        setSession(active);
      }
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          conversationId: active.conversationId,
          token: active.token,
          history,
          message: request.text,
          action: request.action,
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]),
      });
      const raw = await response.json();
      if (epoch !== generation.current) return;
      if (!response.ok) {
        const failed = errorResponse.parse(raw);
        if (failed.code === "CONTEXT") setConversationLimit(true);
        if (["STATE", "STALE", "SESSION"].includes(failed.code || "")) setSessionInvalid(true);
        throw new VisibleError(failed.error);
      }
      const data = chatResponse.parse(raw);
      if (data.requestId !== requestId || data.conversationId !== active.conversationId) {
        setSessionInvalid(true);
        throw new VisibleError("대화 상태가 달라졌어요. 새 대화를 시작해 주세요.");
      }
      setHistory([
        ...history,
        { role: "user", content: request.text },
        { role: "assistant", content: data.text },
      ]);
      setSession({ ...active, token: data.token });
      setPending(null);
      setDraft(data.notice ? request.text : "");
      setStatus("idle");
      setHelp(data.help);
      setConversationLimit(data.conversationLimit === true);
      if (request.action === "summary") {
        setDiary(data.text);
        if (!data.notice && !data.help) setSurveyInvite(true);
      }
      if (data.notice) setError("안전 검수를 마치지 못해 대체 안내를 표시했어요.");
    } catch (e) {
      if (epoch !== generation.current) return;
      if (abort.signal.aborted) {
        setStatus("stopped");
        setError("답변 받기를 중단했어요. 이미 전송된 요청은 처리되거나 비용이 발생할 수 있어요.");
      } else {
        setStatus("error");
        setError(
          e instanceof VisibleError
            ? e.message
            : "답변을 받지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
        );
      }
    } finally {
      if (epoch === generation.current) {
        running.current = false;
        controller.current = null;
      }
    }
  }
  const summary = () => {
    setPanel(null);
    void send({
      text: "지금까지 제가 말한 내용만으로 오늘의 깨달음을 짧게 정리해 주세요. 말하지 않은 내용은 빈칸으로 남겨 주세요.",
      action: "summary",
    });
  };
  return (
    <main ref={shell} className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label={`${config.name} 처음으로`}>
          <span className="brand-icon">
            <BrandMark />
          </span>
          <span>
            <strong>{config.name}</strong>
            <small>maumzip</small>
          </span>
        </a>
        <span className="header-caption">마음에 쌓인 말을, 천천히</span>
        <nav aria-label="대화 도구">
          <button aria-label="새 대화" onClick={() => setPanel("reset")} className="quiet">
            <Plus size={18} />
            <span>새 대화</span>
          </button>
          <button className="help-button" onClick={() => setPanel("help")}>
            <CircleHelp size={18} />
            <span>도움 받기</span>
          </button>
        </nav>
      </header>
      <div className="workspace">
        <aside className="side-note">
          <div className="side-copy">
            <span className="eyebrow">
              <span /> 오늘의 마음을 위한 자리
            </span>
            <h1>
              잠깐,
              <br />
              <em>내 마음</em>부터.
            </h1>
            <p>
              바쁜 하루에 잠깐의 여백을.
              <br />잘 말하려 애쓰지 않아도 괜찮아요.
            </p>
          </div>
          <QuietGarden />
          <div className="side-caption">
            <span />한 번에 하나씩, 나의 속도로.
            <span />
          </div>
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <div>
              <strong>이곳에만 머무는 대화</strong>
              <p>
                앱은 대화를 저장하지 않아요.
                <br />
                새로고침하면 다시 불러올 수 없어요.
              </p>
              <button onClick={() => setPanel("privacy")}>데이터 처리 안내 읽기</button>
            </div>
          </div>
        </aside>
        <section className="chat-card" aria-label="AI와 마음 대화">
          <div className="conversation-heading">
            <div className="conversation-title">
              <span className="conversation-icon">
                <BrandMark />
              </span>
              <div>
                <strong>마음 대화</strong>
                <span>서두르지 않아도 괜찮아요</span>
              </div>
            </div>
            <span className="ai-label">AI 도우미</span>
          </div>
          <div
            className="thread"
            ref={thread}
            onScroll={() => {
              const el = thread.current;
              if (el) {
                nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                if (nearBottom.current) setUnread(false);
              }
            }}
          >
            <div className="day-label">
              <span />
              오늘, 이 순간
              <span />
            </div>
            {!history.length && !pending && (
              <div className="welcome-copy">
                <h2>오늘의 마음, 여기에.</h2>
                <p>말이 정리되지 않아도 괜찮아요.</p>
              </div>
            )}
            <div className="message assistant">
              <span className="avatar" aria-hidden="true">
                <BrandMark />
              </span>
              <div>
                <span className="sender">
                  {config.name}
                  <span>AI</span>
                </span>
                <p className="bubble">{greeting}</p>
              </div>
            </div>
            {!history.length && !pending && (
              <div className="emotion-area">
                <p>이런 마음으로 시작해도 좋아요</p>
                <div className="emotion-list">
                  {emotions.map((label, i) => (
                    <button
                      key={label}
                      data-emotion={i}
                      aria-pressed={draft === label}
                      onClick={() => {
                        setDraft(label);
                        input.current?.focus();
                      }}
                    >
                      <EmotionMark index={i} />
                      {label}
                    </button>
                  ))}
                </div>
                <span className="draft-hint">누르면 입력창에 담겨요. 편하게 덧붙여도 좋아요.</span>
              </div>
            )}
            <div className="intro-note">
              <ShieldCheck size={17} />
              <p>
                AI 대화는 전문 상담·진료를 대신하지 않아요. 입력은 외부 AI로 전달되니 개인정보는
                적지 마세요. <button onClick={() => setPanel("privacy")}>자세히 알아보기</button>
              </p>
            </div>
            {(!config.ready || config.development) && (
              <p className="setup-note" role="status">
                {!config.ready
                  ? "AI 연결을 준비 중이에요. 도움 받기와 일기 틀을 이용할 수 있어요."
                  : "현재 시범 운영 중이에요. 이용·개인정보 안내를 확인해 주세요."}
              </p>
            )}
            {history.map((message, i) => (
              <div key={i} className={`message ${message.role}`}>
                {message.role === "assistant" && (
                  <span className="avatar" aria-hidden="true">
                    <BrandMark />
                  </span>
                )}
                <div>
                  {message.role === "assistant" && (
                    <span className="sender">
                      {config.name}
                      <span>AI</span>
                    </span>
                  )}
                  <p className="bubble">{message.content}</p>
                </div>
              </div>
            ))}
            {pending && (
              <div className="message user">
                <p className="bubble">{pending.text}</p>
              </div>
            )}
            {status === "waiting" && (
              <div className="waiting" role="status">
                <LoaderCircle size={17} className="spin" />
                마음을 담아 답변을 준비하고 있어요…
              </div>
            )}
            {error && (
              <div className="error-note" role="alert">
                <p>{error}</p>
                {pending && status !== "waiting" && !sessionInvalid && !conversationLimit && (
                  <button onClick={() => void send(pending)}>
                    <RotateCcw size={16} />
                    다시 답변 받기
                  </button>
                )}
              </div>
            )}
            {help && (
              <div className="inline-help">
                <p>지금 필요한 현실의 도움을 확인해 주세요.</p>
                <button onClick={() => setPanel("help")}>도움 받을 곳 보기</button>
              </div>
            )}
            {(conversationLimit || sessionInvalid) && (
              <div className="conversation-limit" role="status">
                <p>
                  {sessionInvalid
                    ? "새 대화에서 이어가 주세요."
                    : "이번 대화는 여기까지 담을 수 있어요."}
                </p>
                <p>
                  {sessionInvalid
                    ? "연결 중단이나 만료로 대화 상태를 확인하지 못했어요. 필요한 내용은 일기 틀에 직접 정리한 뒤 새 대화를 시작해 주세요."
                    : "대화 길이에 도달했어요. 일기 틀에 직접 정리하거나 새 대화를 시작해 주세요."}
                </p>
                <div>
                  <button onClick={() => setPanel("diary")}>일기 틀 열기</button>
                  <button onClick={() => setPanel("reset")}>새 대화 시작</button>
                </div>
              </div>
            )}
            {surveyInvite && !help && (
              <div className="survey-invite">
                <span className="eyebrow">오늘의 대화를 마무리하며</span>
                <p>이 시간이 어떠셨는지 들려주실래요?</p>
                <button onClick={() => setPanel("survey")}>짧은 사용 경험 설문</button>
                <small>선택 참여 · 채팅 내용은 보내지 않아요</small>
              </div>
            )}
          </div>
          {unread && (
            <button className="unread" onClick={jump}>
              <MessageCircle size={16} />새 답변 보기
            </button>
          )}
          <footer className="composer">
            <div className="composer-actions">
              <button className="diary-button" onClick={() => setPanel("diary")}>
                <BookOpen size={16} />
                오늘의 깨달음 정리
              </button>
              {!help && (
                <button
                  className="survey-button"
                  disabled={status === "waiting"}
                  onClick={() => setPanel("survey")}
                >
                  <ClipboardList size={16} />
                  마무리 설문
                </button>
              )}
            </div>
            <form
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="message">
                지금의 마음을 적어 주세요
              </label>
              <textarea
                id="message"
                autoComplete="off"
                ref={input}
                value={draft}
                maxLength={config.maxInput}
                placeholder="오늘의 마음을 들려주세요…"
                rows={1}
                disabled={status === "waiting"}
                onChange={(e) => setDraft(e.target.value)}
                onCompositionStart={() => {
                  ime.current = true;
                }}
                onCompositionEnd={() => {
                  ime.current = false;
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !ime.current &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229 &&
                    matchMedia("(pointer: fine)").matches
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {status === "waiting" ? (
                <button
                  type="button"
                  className="send-button"
                  aria-label="답변 받기 중단"
                  onClick={() => controller.current?.abort()}
                >
                  <Square size={17} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  disabled={!draft.trim() || conversationLimit || sessionInvalid}
                  aria-label="메시지 전송"
                >
                  <Send size={19} />
                </button>
              )}
            </form>
            <div className="composer-meta">
              <button onClick={() => setPanel("privacy")}>
                <ShieldCheck size={13} />
                이용·개인정보 안내
              </button>
              <span aria-live="off">
                {draft.length.toLocaleString()} / {config.maxInput.toLocaleString()}
              </span>
            </div>
          </footer>
        </section>
      </div>
      <div className="page-footer">
        <span>나를 알아가는 시간, 마음 한걸음.</span>
        <span className="footer-brand">maumzip</span>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setPanel(null)}
        onClose={() => setPanel(null)}
        aria-labelledby={panel === "survey" ? "survey-title" : "panel-title"}
      >
        <div className="dialog-header">
          <span className="eyebrow">{config.name}</span>
          <button className="icon-button" onClick={() => setPanel(null)} aria-label="닫기">
            <X size={22} />
          </button>
        </div>
        {panel === "help" && (
          <>
            <h2 id="panel-title">혼자 견디지 않아도 괜찮아요</h2>
            <p>
              지금 위험하거나 다친 상태라면 AI 답변을 기다리지 말고 현실의 도움을 요청해 주세요.
            </p>
            <div className="phone-list">
              <a href="tel:119">
                <strong>119</strong>
                <span>
                  응급·구조<small>응급의료나 구조가 필요할 때</small>
                </span>
              </a>
              <a href="tel:112">
                <strong>112</strong>
                <span>
                  경찰 긴급신고<small>폭력 등 경찰의 긴급 도움이 필요할 때</small>
                </span>
              </a>
              <a href="tel:109">
                <strong>109</strong>
                <span>
                  자살예방상담<small>자살 관련 위기 상담이 필요할 때</small>
                </span>
              </a>
            </div>
            <p className="fine-print">
              한국 기준 안내예요. 해외에서는 현지 긴급전화를 이용해 주세요. 버튼을 누르면 기기의
              전화 앱이 열립니다. 이 서비스가 대신 신고하거나 상담사에게 연결하지는 않아요.
            </p>
          </>
        )}
        {panel === "privacy" && (
          <>
            <h2 id="panel-title">대화를 시작하기 전에</h2>
            <p>
              이 서비스는 감정과 생각을 정리하는 AI 도우미이며 진단·치료·전문 상담을 제공하지
              않아요. 사람이 실시간으로 지켜보지 않아요.
            </p>
            <h3>입력은 어떻게 처리되나요?</h3>
            <p>
              입력과 현재 대화 맥락은 답변·안전 검수를 위해 운영 서버와 OpenAI로 전달돼요. 실명,
              연락처, 상세 주소 등 개인정보는 적지 마세요.
            </p>
            <h3>대화는 화면에만 보관해요</h3>
            <p>
              운영 앱은 원문·요약·일기를 DB나 브라우저 저장소에 기록하지 않아요. 새로고침하거나 새
              대화를 시작하면 이전 대화를 불러올 수 없어요. 페이지를 떠날 때도 화면 내용을 지워요.
            </p>
            <p>
              익명 세션 쿠키는 최대 2시간, 사용량·중복 방지용 기술 정보의 유효기간은 최대
              25시간이에요. 만료된 기술 정보는 다음 요청 때 정리하며, 호스팅 백업에는 별도 보관
              기간이 적용돼요. 외부로 이미 전송된 데이터를 소급 삭제한 것은 아니에요.
            </p>
            <h3>외부 서비스의 처리·보존</h3>
            <p>
              OpenAI의 API 저장 옵션은 끄지만, 보안·남용 방지 등 외부 제공자의 별도 보존 정책이
              적용될 수 있어요.{" "}
              {config.policy.processing ||
                "처리 위치와 호스팅 로그 보존 조건은 운영자의 최종 확인이 필요해요."}
            </p>
            <a
              href="https://developers.openai.com/api/docs/guides/your-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenAI 데이터 처리 안내 ↗
            </a>
            <h3>선택 설문은 별도로 전달돼요</h3>
            <p>
              마무리 설문에 참여하고 별도로 동의한 경우에만 점수와 자유 의견을 운영자 이메일로
              전달해요. 채팅·일기는 자동 첨부하지 않아요. 설문 내용은 OpenAI로 보내지 않으며,
              메일함과 이메일 발송 서비스의 보관 기준은 설문 화면에서 따로 안내해요.
            </p>
            <h3>운영 및 문의</h3>
            <p>
              운영주체: {config.operator || "운영 정보 확인 중"}
              <br />
              문의·삭제 요청: {config.contact || "문의처 확인 중"}
              <br />
              이용 대상: {config.policy.targetAge || "공개 운영 전 확정 필요"}
            </p>
            <p className="fine-print">
              아래 버튼은 안내를 확인했다는 뜻이에요. 개인정보 처리 동의를 대신하지 않아요.
              운영정책상 별도 동의가 필요한 경우 공개 전에 구분해 마련해야 해요.
            </p>
            <button
              className="primary"
              onClick={() => {
                setAcknowledged(true);
                setPanel(null);
                input.current?.focus();
              }}
            >
              <Check size={18} />
              안내 확인했어요
            </button>
          </>
        )}
        {panel === "diary" && (
          <>
            <h2 id="panel-title">오늘 알아차린 마음</h2>
            <p>
              맞는 말보다, 나에게 솔직한 한 줄이면 충분해요. 정리에서 확인하지 못한 내용은 빈칸으로
              남겨요. 떠오를 때 직접 채워도 괜찮아요.
            </p>
            <label htmlFor="diary" className="sr-only">
              오늘의 깨달음 일기
            </label>
            <textarea
              id="diary"
              autoComplete="off"
              className="diary-field"
              rows={6}
              value={diary}
              onChange={(e) => setDiary(e.target.value)}
              maxLength={2400}
            />
            <p className="fine-print">
              이 화면의 메모리에만 머물러요. 새로고침·새 대화·페이지 이동 시 지워져요.
            </p>
            {history.length > 0 && !conversationLimit && !sessionInvalid && (
              <button className="primary" onClick={summary} disabled={status === "waiting"}>
                <MessageCircle size={18} />
                내가 말한 내용으로 정리하기
              </button>
            )}
          </>
        )}
        {panel === "reset" && (
          <>
            <h2 id="panel-title">새 마음으로 시작할까요?</h2>
            <p>
              현재 대화, 입력한 글, 일기와 작성 중인 설문을 이 화면에서 지워요. 다시 불러올 수
              없어요. 외부 AI나 이메일로 이미 전송한 내용까지 삭제하는 기능은 아니에요.
            </p>
            <button
              className="primary"
              onClick={() => {
                reset();
                setPanel(null);
                input.current?.focus();
              }}
            >
              대화 지우고 새로 시작
            </button>
            <button className="secondary" onClick={() => setPanel(null)}>
              계속 대화하기
            </button>
          </>
        )}
        <Survey
          key={surveyEpoch}
          visible={panel === "survey"}
          config={config.survey}
          contact={config.contact}
          session={session}
          onSession={setSession}
          onClose={() => setPanel(null)}
        />
      </dialog>
    </main>
  );
}
