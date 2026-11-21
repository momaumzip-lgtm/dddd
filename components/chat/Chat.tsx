"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CircleHelp,
  LoaderCircle,
  MessageCircle,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { type Message, type PublicConfig } from "@/lib/config";
import { z } from "zod";
import PrivacyNotice from "./PrivacyNotice";
import DiaryDraft from "./DiaryDraft";
import { supportLink } from "@/lib/service-info";
import Survey from "./Survey";
import BrandMark from "./BrandMark";
import QuietGarden from "./QuietGarden";
import EmotionPicker from "./EmotionPicker";
import {
  emotionLabel,
  intensityBands,
  emotionSelectionSchema,
  type EmotionSelection,
} from "@/lib/emotions";
import {
  readChatStream,
  ChatDisplayError,
  chatErrorMessage,
  failedChatRequest,
  type CompletedChat,
} from "@/lib/browser/chat-stream";
import { installPagePrivacy } from "@/lib/browser/privacy";
const sessionResponse = z.object({ conversationId: z.string().uuid(), token: z.string() });
type Session = { conversationId: string; token: string };
type Pending = { text: string; action: "chat" | "summary" | "continue"; messageId?: string };
type Panel = "help" | "start" | "privacy" | "reset" | "survey" | "emotion" | null;
export default function Chat({ config }: { config: PublicConfig }) {
  const [started, setStarted] = useState(false),
    [emotion, setEmotion] = useState<EmotionSelection | null>(null),
    [complete, setComplete] = useState(false),
    [diaries, setDiaries] = useState<Record<number, string>>({}),
    [streamText, setStreamText] = useState("");
  const receipt = useRef<{
    data: CompletedChat;
    active: Session;
    request: Pending;
    selectedVersion?: number;
    history: Message[];
  } | null>(null);
  const emotionRef = useRef<EmotionSelection | null>(null),
    continueRef = useRef(false);
  const selectEmotion = (value: EmotionSelection) => {
    emotionRef.current = value;
    setEmotion(value);
  };
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
    receipt.current = null;
    setStarted(false);
    setEmotion(null);
    emotionRef.current = null;
    setComplete(false);
    setDiaries({});
    setStreamText("");
    continueRef.current = false;
    setDraft("");
    setSession(null);
    setPending(null);
    setStatus("idle");
    setError("");
    setHelp(false);
    setUnread(false);
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
  useLayoutEffect(() => {
    if (!history.length && !pending && status === "idle") {
      thread.current?.scrollTo({ top: 0 });
      return;
    }
    if (nearBottom.current) {
      thread.current?.scrollTo({ top: thread.current.scrollHeight });
      setUnread(false);
    } else setUnread(true);
  }, [history, pending, status, streamText]);
  const jump = () => {
    nearBottom.current = true;
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setUnread(false);
  };
  async function send(item?: Pending) {
    if (running.current || conversationLimit || sessionInvalid || (!item && complete)) return;
    const request: Pending = receipt.current?.request ||
      item || {
        text: draft.trim(),
        action: continueRef.current ? "continue" : "chat",
        messageId: crypto.randomUUID(),
      };
    request.messageId ||= crypto.randomUUID();
    if (!request.text || request.text.length > config.maxInput) return;
    if (!acknowledged) {
      setPanel("start");
      return;
    }
    running.current = true;
    const epoch = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setPending(request);
    setStreamText("");
    setStatus("waiting");
    setError("");
    nearBottom.current = true;
    const requestId = receipt.current?.data.requestId || crypto.randomUUID();
    performance.mark("chat-send:" + requestId);
    requestAnimationFrame(() => performance.mark("chat-ack:" + requestId));
    let firstText = false;
    try {
      let active = receipt.current?.active || session;
      if (!active) {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok) throw await failedChatRequest(response);
        active = sessionResponse.parse(await response.json());
        if (epoch !== generation.current) return;
        setSession(active);
      }
      const sentEmotion = emotionRef.current;
      const selectedVersion = receipt.current?.selectedVersion ?? sentEmotion?.version;
      const baseHistory = receipt.current?.history || history;
      let data = receipt.current?.data;
      if (!data) {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify({
            requestId,
            messageId: request.messageId,
            emotion: sentEmotion,
            conversationId: active.conversationId,
            token: active.token,
            history,
            message: request.text,
            action: request.action,
          }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]),
        });
        if (!response.ok) {
          const failed = await failedChatRequest(response);
          if (epoch !== generation.current) return;
          if (["SESSION", "STATE", "STALE"].includes(failed.code || "")) setSessionInvalid(true);
          if (failed.code === "CONTEXT") setConversationLimit(true);
          throw failed;
        }
        data = await readChatStream(response, requestId, (text) => {
          if (epoch === generation.current) {
            setStreamText(text);
            if (!firstText) {
              firstText = true;
              requestAnimationFrame(() =>
                requestAnimationFrame(() => performance.mark("chat-first-paint:" + requestId)),
              );
            }
          }
        });
        if (epoch !== generation.current) return;
        if (data.conversationId !== active.conversationId)
          throw new ChatDisplayError(
            "대화 연결을 확인하지 못했어요. 이전 대화는 이 화면에 남아 있어요.",
          );
        receipt.current = { data, active, request, selectedVersion, history: baseHistory };
      }
      const confirmed = await fetch("/api/chat/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: active.conversationId, token: data.token }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
      });
      if (!confirmed.ok)
        throw new ChatDisplayError(
          "답변은 받았지만 접수 확인을 마치지 못했어요. 받은 답변 접수를 다시 확인해 주세요. AI를 새로 호출하지 않아요.",
        );
      if (epoch !== generation.current) return;
      if (data.conversationId !== active.conversationId)
        throw new ChatDisplayError(
          "대화 연결을 확인하지 못했어요. 이전 대화는 이 화면에 남아 있어요.",
        );
      if (emotionRef.current?.version === selectedVersion)
        selectEmotion(emotionSelectionSchema.parse(data.emotion));
      performance.mark("chat-done:" + requestId);
      setComplete(data.completed);
      const note = data.diaryDraft;
      if (note) setDiaries((previous) => ({ ...previous, [baseHistory.length + 1]: note }));
      continueRef.current = false;
      receipt.current = null;
      setHistory([
        ...baseHistory,
        { role: "user", content: request.text },
        { role: "assistant", content: data.text },
      ]);
      setSession({ ...active, token: data.token });
      setPending(null);
      setStreamText("");
      setDraft((current) => (data.notice ? request.text : current === request.text ? "" : current));
      setStatus("idle");
      setHelp(data.help);
      setConversationLimit(data.conversationLimit === true);
      setSurveyInvite(data.surveyReady && !data.help);
      if (data.notice) setError("안전 검수를 마치지 못해 대체 안내를 표시했어요.");
    } catch (e) {
      if (epoch !== generation.current) return;
      if (abort.signal.aborted) {
        setStatus("stopped");
        setError("답변 받기를 중단했어요. 이미 전송된 요청은 처리되거나 비용이 발생할 수 있어요.");
      } else {
        setStatus("error");
        setError(chatErrorMessage(e));
      }
    } finally {
      if (epoch === generation.current) {
        running.current = false;
        controller.current = null;
      }
    }
  }
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
              마음에,
              <br />
              <em>작은 여백</em>을.
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
              <strong>저장하지 않는 대화</strong>
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
          {!started ? (
            <EmotionPicker
              value={emotion}
              onDone={(value) => {
                selectEmotion(value);
                if (acknowledged) setStarted(true);
                else setPanel("start");
              }}
            />
          ) : (
            <>
              <div className="current-emotion">
                <span>
                  {emotion ? emotionLabel(emotion) : "미정"} ·{" "}
                  {emotion?.intensityBand === "unknown"
                    ? "강도 미정"
                    : intensityBands.find((b) => b.id === emotion?.intensityBand)?.label ||
                      "강도 미정"}
                </span>
                <button onClick={() => setPanel("emotion")}>바꾸기</button>
                <small>{complete ? "대화 마침" : help ? "안전 확인" : "이야기 중"}</small>
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
                    <h2>어떤 일이 있었나요?</h2>
                    <p>한 문장만 적어도 괜찮아요. 고른 감정은 이미 전해졌어요.</p>
                  </div>
                )}
                <div className="intro-note">
                  <ShieldCheck size={17} />
                  <p>
                    AI 대화는 전문 상담·진료를 대신하지 않아요. 입력은 외부 AI로 전달되니 개인정보는
                    적지 마세요.{" "}
                    <button onClick={() => setPanel("privacy")}>자세히 알아보기</button>
                  </p>
                </div>
                {(!config.ready || config.development) && (
                  <p className="setup-note" role="status">
                    {!config.ready
                      ? "AI 연결을 준비 중이에요. 도움 받기를 이용할 수 있어요."
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
                      {diaries[i] && <DiaryDraft initial={diaries[i]} />}
                    </div>
                  </div>
                ))}
                {pending && (
                  <div className="message user">
                    <p className="bubble">{pending.text}</p>
                  </div>
                )}
                {streamText && (
                  <div className="message assistant">
                    <p className="bubble">
                      {streamText}
                      {status !== "waiting" && (
                        <small className="partial-note"> · 답변이 중단됐어요</small>
                      )}
                    </p>
                  </div>
                )}
                {status === "waiting" && (
                  <div className="waiting" role="status">
                    <LoaderCircle size={17} className="spin" />
                    {streamText ? "답변을 이어서 받고 있어요…" : "보내주신 이야기를 읽고 있어요…"}
                  </div>
                )}
                {error && (
                  <div className="error-note" role="alert">
                    <p>{error}</p>
                    {pending && status !== "waiting" && !sessionInvalid && !conversationLimit && (
                      <button onClick={() => void send(pending)}>
                        <RotateCcw size={16} />
                        {receipt.current ? "받은 답변 접수 다시 확인" : "다시 답변 받기"}
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
                        ? "연결 중단이나 만료로 대화 상태를 확인하지 못했어요. 필요한 내용은 이 화면에서 확인할 수 있어요. 새 대화는 직접 선택해 주세요."
                        : "대화 길이에 도달했어요. 필요한 내용은 이 화면에서 확인할 수 있어요. 새 대화는 직접 선택해 주세요."}
                    </p>
                    <div>
                      <button onClick={() => setPanel("reset")}>새 대화 시작</button>
                    </div>
                  </div>
                )}
                {history.length > 0 &&
                  !complete &&
                  !help &&
                  !pending &&
                  !continueRef.current &&
                  !sessionInvalid &&
                  !conversationLimit && (
                    <button
                      type="button"
                      className="continue-chat secondary"
                      onClick={() =>
                        void send({
                          action: "summary",
                          text: "지금까지 이야기한 내용으로 정리해 주세요.",
                        })
                      }
                    >
                      지금 정리하기
                    </button>
                  )}
                {complete && !help && (
                  <button
                    className="continue-chat secondary"
                    onClick={() => {
                      setComplete(false);

                      continueRef.current = true;
                      setSurveyInvite(false);
                      requestAnimationFrame(() => input.current?.focus());
                    }}
                  >
                    이어서 이야기하기
                  </button>
                )}
                {surveyInvite && !help && (
                  <div className="survey-invite">
                    <span className="eyebrow">오늘의 대화를 마무리하며</span>
                    <p>이번 대화는 어떠셨나요?</p>
                    <a
                      href="#survey"
                      onClick={(event) => {
                        event.preventDefault();
                        setPanel("survey");
                      }}
                    >
                      사용 경험 알려주기
                    </a>
                    <small>선택 참여 · 채팅 내용은 보내지 않아요</small>
                  </div>
                )}
              </div>
              {unread && (
                <button className="unread" onClick={jump}>
                  <MessageCircle size={16} />새 답변 보기
                </button>
              )}
              <footer className="composer" hidden={complete}>
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
                    placeholder={
                      history.length
                        ? "편하게 이어서 적어주세요…"
                        : "어떤 일이 있었나요? 한 문장도 괜찮아요."
                    }
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
            </>
          )}
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
        aria-label={panel === "emotion" ? "감정과 강도 바꾸기" : undefined}
        aria-labelledby={
          panel === "emotion" ? undefined : panel === "survey" ? "survey-title" : "panel-title"
        }
      >
        <div className="dialog-header">
          <span className="eyebrow">{config.name}</span>
          <button className="icon-button" onClick={() => setPanel(null)} aria-label="닫기">
            <X size={22} />
          </button>
        </div>
        {panel === "emotion" && (
          <EmotionPicker
            value={emotion}
            onDone={(value) => {
              selectEmotion(value);
              setPanel(null);
            }}
            onCancel={() => setPanel(null)}
          />
        )}
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
            <p>
              문의 및 삭제 요청: <a href={supportLink}>{config.contact}</a>
            </p>
          </>
        )}
        {(panel === "start" || panel === "privacy") && (
          <PrivacyNotice
            config={config}
            starting={panel === "start"}
            onConfirm={() => {
              if (panel === "start") {
                setAcknowledged(true);
                setStarted(true);
                requestAnimationFrame(() => input.current?.focus());
              }
              setPanel(null);
            }}
          />
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
