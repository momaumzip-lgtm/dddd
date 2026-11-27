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
import PrivacyNotice from "./PrivacyNotice";
import DiaryDraft from "./DiaryDraft";
import MindRecordCard from "./MindRecordCard";
import {
  controlText,
  stageLabels,
  type ExplorationControl,
  type ExplorationView,
  type MindRecord,
} from "@/lib/exploration";
import { supportLink } from "@/lib/service-info";
import Survey from "./Survey";
import BrandMark from "./BrandMark";
import QuietGarden from "./QuietGarden";
import EmotionPicker from "./EmotionPicker";
import {
  emotionItems,
  itemLabel,
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
import {
  browserSessionSchema,
  readTab,
  saveTab,
  forgetTab,
  tabChatKey,
  tabChatSchema,
  tabSurveyKey,
  type BrowserSession as Session,
  type Pending,
  type TabChat,
} from "@/lib/browser/tab-memory";
type Panel = "help" | "start" | "privacy" | "reset" | "survey" | "emotion" | null;
async function openSession(signal: AbortSignal): Promise<Session> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (!response.ok) throw await failedChatRequest(response);
  return browserSessionSchema.parse(await response.json());
}
export default function Chat({ config }: { config: PublicConfig }) {
  const [started, setStarted] = useState(false),
    [emotion, setEmotion] = useState<EmotionSelection | null>(null),
    [completion, setCompletion] = useState<"open" | "confirmed">("open"),
    [diaries, setDiaries] = useState<Record<number, string>>({}),
    [streamText, setStreamText] = useState("");
  const complete = completion !== "open";
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
  const [viewEpoch, setViewEpoch] = useState(0),
    [surveyInvite, setSurveyInvite] = useState(false);
  const [slowReply, setSlowReply] = useState(false);
  const [surveyAvailable, setSurveyAvailable] = useState(false);
  const [conversationLimit, setConversationLimit] = useState(false);
  const [exploration, setExploration] = useState<ExplorationView | null>(null);
  const [records, setRecords] = useState<Record<number, MindRecord>>({});
  const [remember, setRemember] = useState(false);
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const retiring = useRef(false);
  const [invalidInput, setInvalidInput] = useState<string | null>(null);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const openingSession = useRef<{ controller: AbortController; promise: Promise<Session> } | null>(
    null,
  );
  const shell = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    running = useRef(false),
    nearBottom = useRef(true);
  const thread = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    ime = useRef(false);
  const reset = (preserveTab = false) => {
    retiring.current = preserveTab;
    if (!preserveTab) {
      const saved = readTab(tabChatKey, tabChatSchema);
      const conversationId = session?.conversationId || saved?.session?.conversationId;
      if (conversationId) forgetTab(tabSurveyKey(conversationId));
      forgetTab(tabChatKey);
    }
    generation.current++;
    controller.current?.abort();
    running.current = false;
    setHistory([]);
    receipt.current = null;
    setStarted(false);
    setAcknowledged(false);
    setEmotion(null);
    emotionRef.current = null;
    setCompletion("open");
    setDiaries({});
    setRecords({});
    setExploration(null);
    setRemember(false);
    setSurveySubmitted(false);
    setStorageUnavailable(false);
    setStreamText("");
    continueRef.current = false;
    setDraft("");
    setSession(null);
    setPending(null);
    setStatus("idle");
    setError("");
    setHelp(false);
    setUnread(false);
    setViewEpoch((e) => e + 1);
    setSurveyInvite(false);
    setSurveyAvailable(false);
    setConversationLimit(false);
    setSessionInvalid(false);
    setInvalidInput(null);
    setPanel(null);
    nearBottom.current = true;
  };
  function rememberCurrent(overrides: Partial<TabChat> = {}) {
    if (!remember || !started || !emotion || retiring.current) return;
    if (
      !saveTab(tabChatKey, {
        session,
        history,
        emotion,
        draft,
        pending,
        receipt: receipt.current,
        completion,
        continueAfterRecord: continueRef.current,
        exploration,
        diaries,
        records,
        help,
        surveyInvite,
        surveyAvailable,
        surveySubmitted,
        panel: panel === "survey" ? "survey" : null,
        conversationLimit,
        ...overrides,
      } satisfies TabChat)
    )
      setStorageUnavailable(true);
  }
  useLayoutEffect(() => {
    rememberCurrent();
  }, [
    started,
    remember,
    session,
    history,
    emotion,
    draft,
    pending,
    completion,
    exploration,
    diaries,
    records,
    help,
    surveyInvite,
    surveyAvailable,
    surveySubmitted,
    panel,
    conversationLimit,
  ]);
  useLayoutEffect(
    () =>
      shell.current
        ? installPagePrivacy(
            shell.current,
            () => reset(true),
            () => {
              const saved = readTab(tabChatKey, tabChatSchema);
              if (!saved) return false;
              retiring.current = false;
              setRemember(true);
              setAcknowledged(true);
              setStarted(true);
              selectEmotion(saved.emotion);
              setSession(saved.session);
              setHistory(saved.history);
              setDraft(saved.draft);
              receipt.current = saved.receipt;
              continueRef.current = saved.continueAfterRecord;
              setPending(saved.pending);
              setCompletion(saved.completion);
              setExploration(saved.exploration);
              setDiaries(saved.diaries);
              setRecords(saved.records);
              setHelp(saved.help);
              setSurveyInvite(saved.surveyInvite);
              setSurveyAvailable(saved.surveyAvailable);
              setSurveySubmitted(saved.surveySubmitted);
              setConversationLimit(saved.conversationLimit);
              setPanel(saved.panel);
              if (saved.pending) {
                setStatus("error");
                setError(
                  saved.receipt
                    ? "받은 답변 접수를 아직 확인하지 않았어요. 같은 답변을 이어서 확인할 수 있어요."
                    : "이어서 확인하지 못한 메시지가 있어요. 입력은 이 탭에 남아 있어요.",
                );
              }
              return true;
            },
          )
        : undefined,
    [],
  );
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = shell.current;
    if (!viewport || !root || !started || !matchMedia("(pointer: coarse)").matches) return;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const keyboard = window.innerHeight - viewport.height > 110 && viewport.scale === 1;
        if (keyboard) root.style.setProperty("--chat-viewport", `${Math.round(viewport.height)}px`);
        else root.style.removeProperty("--chat-viewport");
        root.dataset.keyboard = keyboard ? "true" : "false";
        if (nearBottom.current) thread.current?.scrollTo({ top: thread.current.scrollHeight });
      });
    };
    viewport.addEventListener("resize", resize);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", resize);
      root.style.removeProperty("--chat-viewport");
      delete root.dataset.keyboard;
    };
  }, [started]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!started || session) return;
    const controller = new AbortController();
    const promise = openSession(controller.signal);
    openingSession.current = { controller, promise };
    promise
      .then((value) => {
        if (!controller.signal.aborted) setSession(value);
      })
      .catch(() => {})
      .finally(() => {
        if (openingSession.current?.promise === promise) openingSession.current = null;
      });
    return () => controller.abort();
  }, [started, Boolean(session)]);
  useEffect(() => {
    if (panel) {
      dialog.current?.showModal();
      dialog.current?.scrollTo({ top: 0 });
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
    if (
      running.current ||
      (conversationLimit &&
        item?.action !== "summary" &&
        receipt.current?.request.action !== "summary") ||
      sessionInvalid ||
      (!item && complete)
    )
      return;
    const request: Pending = receipt.current?.request ||
      item ||
      (pending && pending.text === draft.trim() ? pending : null) || {
        text: draft.trim(),
        action: continueRef.current ? "continue" : "chat",
        messageId: crypto.randomUUID(),
      };
    request.messageId ||= crypto.randomUUID();
    if (!request.text || request.text === invalidInput || request.text.length > config.maxInput)
      return;
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
    setInvalidInput(null);
    setSlowReply(false);
    setStatus("waiting");
    setError("");
    nearBottom.current = true;
    const requestId = receipt.current?.data.requestId || crypto.randomUUID();
    performance.mark("chat-send:" + requestId);
    requestAnimationFrame(() => performance.mark("chat-ack:" + requestId));
    const deadline = AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]);
    const delayNotice = setTimeout(() => {
      if (epoch === generation.current) setSlowReply(true);
    }, 10000);
    let firstText = false;
    try {
      let active = receipt.current?.active || session;
      if (!active) {
        const opening = openingSession.current;
        if (opening) {
          const cancelOpening = () => opening.controller.abort();
          deadline.addEventListener("abort", cancelOpening, { once: true });
          try {
            active = await opening.promise;
          } finally {
            deadline.removeEventListener("abort", cancelOpening);
          }
        } else active = await openSession(deadline);
        deadline.throwIfAborted();
        if (epoch !== generation.current) return;
        setSession(active);
      }
      const sentEmotion = emotionRef.current;
      const selectedVersion = receipt.current?.selectedVersion ?? sentEmotion?.version;
      const baseHistory = receipt.current?.history || history;
      let data = receipt.current?.data;
      if (!data) {
        performance.mark("chat-request:" + requestId);
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
            guided: true,
            control: request.control,
          }),
          signal: deadline,
        });
        if (!response.ok) {
          const failed = await failedChatRequest(response);
          if (epoch !== generation.current) return;
          if (["SESSION", "STATE", "STALE"].includes(failed.code || "")) setSessionInvalid(true);
          if (response.status === 400 || response.status === 413) setInvalidInput(request.text);
          if (failed.code === "CONTEXT") setConversationLimit(true);
          throw failed;
        }
        data = await readChatStream(response, requestId, (text) => {
          if (epoch === generation.current) {
            setStreamText(text);
            if (!firstText) {
              firstText = true;
              clearTimeout(delayNotice);
              performance.mark("chat-text:" + requestId);
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
        rememberCurrent({ session: active, pending: request, receipt: receipt.current });
      }
      const confirmed = await fetch("/api/chat/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: active.conversationId, token: data.token }),
        signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]),
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
      setCompletion(data.completed ? "confirmed" : "open");
      const note = data.diaryDraft;
      if (note) setDiaries((previous) => ({ ...previous, [baseHistory.length + 1]: note }));
      const record = data.exploration?.finalRecord;
      if (record) setRecords((previous) => ({ ...previous, [baseHistory.length + 1]: record }));
      if (data.exploration) setExploration(data.exploration);
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
      setDraft((current) =>
        data.notice ? request.text : current.trim() === request.text ? "" : current,
      );
      setStatus("idle");
      setHelp(data.help);
      setConversationLimit(data.conversationLimit === true);
      setSurveyInvite(data.surveyReady && !data.help);
      if (data.surveyReady && !data.help) setSurveyAvailable(true);
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
      clearTimeout(delayNotice);
      if (epoch === generation.current) {
        running.current = false;
        controller.current = null;
      }
    }
  }
  function choose(control: ExplorationControl) {
    if (control === "more" || control === "explore")
      requestAnimationFrame(() => input.current?.focus());
    void send({
      control,
      text: controlText[control],
      action:
        control === "record" || control === "end"
          ? "summary"
          : continueRef.current
            ? "continue"
            : "chat",
    });
  }
  return (
    <main
      ref={shell}
      data-chat-open={started ? "true" : undefined}
      data-restoring="true"
      className="app-shell"
    >
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (started) setPanel("reset");
            else shell.current?.querySelector(".emotion-picker")?.scrollTo({ top: 0 });
          }}
          aria-label={`${config.name} 처음으로`}
        >
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
          {started && (
            <button aria-label="새 대화" onClick={() => setPanel("reset")} className="quiet">
              <Plus size={18} />
              <span>새 대화</span>
            </button>
          )}
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
              <strong>내가 선택하는 대화 보관</strong>
              <p>
                서비스는 대화 원문을 별도로 저장하지 않아요.
                <br />
                시작할 때 선택하면 이 탭에서만 이어갈 수 있어요.
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
              key={viewEpoch}
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
                  {emotion
                    ? emotionItems(emotion)
                        .map((item) => {
                          const strength =
                            item.intensityPercent === undefined
                              ? intensityBands.find((band) => band.id === item.intensityBand)
                                  ?.shortLabel
                              : `${item.intensityPercent}%`;
                          return [itemLabel(item), strength].filter(Boolean).join(" ");
                        })
                        .join(" · ")
                    : "미정"}
                </span>
                <button onClick={() => setPanel("emotion")}>바꾸기</button>
                {surveyAvailable && !surveyInvite && !help && (
                  <button onClick={() => setPanel("survey")}>사용 경험 설문</button>
                )}
                <small>
                  {help
                    ? "안전 확인"
                    : complete && surveySubmitted
                      ? stageLabels.COMPLETED
                      : exploration
                        ? stageLabels[exploration.conversationStage]
                        : complete
                          ? "대화 마침"
                          : "이야기 중"}
                </small>
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
                    <h2>
                      {emotion && emotion.emotionId !== "unknown"
                        ? "오늘 언제 그 마음이 들었나요?"
                        : "오늘 마음에 남은 장면이 있나요?"}
                    </h2>
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
                {storageUnavailable && (
                  <p className="setup-note" role="status">
                    이 브라우저에서는 탭에 대화를 보관할 수 없어요.
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
                      {records[i] && (
                        <MindRecordCard
                          record={records[i]}
                          onChange={(record) => setRecords((old) => ({ ...old, [i]: record }))}
                        />
                      )}
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
                    {streamText
                      ? "답변을 이어서 받고 있어요…"
                      : slowReply
                        ? "답변 도착이 늦어지고 있어요. 중단한 뒤 다시 요청할 수 있어요."
                        : "보내주신 이야기를 읽고 있어요…"}
                  </div>
                )}
                {error && (
                  <div className="error-note" role="alert">
                    <p>{error}</p>
                    {pending &&
                      invalidInput === null &&
                      status !== "waiting" &&
                      !sessionInvalid &&
                      (!conversationLimit || pending.action === "summary") && (
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
                        : "대화 길이에 도달했어요. 지금까지의 이야기는 마음 기록으로 남길 수 있어요."}
                    </p>
                    <div>
                      <button onClick={() => setPanel("reset")}>새 대화 시작</button>
                    </div>
                  </div>
                )}
                {complete && !help && (
                  <button
                    className="continue-chat secondary"
                    onClick={() => {
                      continueRef.current = completion === "confirmed";
                      setCompletion("open");
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
                    <p>{surveySubmitted ? "설문을 접수했어요." : "이번 대화는 어떠셨나요?"}</p>
                    <a
                      href="#survey"
                      onClick={(event) => {
                        event.preventDefault();
                        setPanel("survey");
                      }}
                    >
                      {surveySubmitted ? "설문 접수 확인" : "사용 경험 알려주기"}
                    </a>
                    <small>선택 참여 · 기록을 복사하지 않아도 참여할 수 있어요</small>
                  </div>
                )}
              </div>
              <p className="sr-only" role="status" aria-atomic="true">
                {history.at(-1)?.role === "assistant" ? history.at(-1)?.content : ""}
              </p>
              {unread && (
                <button className="unread" onClick={jump}>
                  <MessageCircle size={16} />새 답변 보기
                </button>
              )}
              <footer className="composer" hidden={complete}>
                {history.length > 0 && !help && !sessionInvalid && !continueRef.current && (
                  <div className="chat-controls" aria-label="대화 진행 선택">
                    {!conversationLimit && (
                      <div className="chat-control-row">
                        {(
                          [
                            { id: "unsure", label: "잘 모르겠어요" },
                            { id: "explore", label: "더 깊게 물어봐 줘" },
                            { id: "skip", label: "다른 질문 해줘" },
                          ] as const
                        ).map(({ id, label }) => (
                          <button
                            key={id}
                            type="button"
                            disabled={status === "waiting" || Boolean(receipt.current)}
                            onClick={() => choose(id)}
                          >
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p>질문은 계속 이어져요 · 충분할 때 언제든 눌러 정리하세요</p>
                    <button
                      className="chat-record-button"
                      type="button"
                      disabled={status === "waiting" || Boolean(receipt.current)}
                      onClick={() => choose("record")}
                    >
                      ✨ 여기까지 나눈 마음 정리받기
                    </button>
                  </div>
                )}

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
                    readOnly={status === "waiting" || sessionInvalid || conversationLimit}
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
                      key="stop"
                      type="button"
                      className="send-button"
                      aria-label="답변 받기 중단"
                      onClick={(event) => {
                        event.preventDefault();
                        controller.current?.abort();
                      }}
                    >
                      <Square size={17} />
                    </button>
                  ) : (
                    <button
                      key="send"
                      type="submit"
                      className="send-button"
                      disabled={
                        !draft.trim() ||
                        draft.trim() === invalidInput ||
                        conversationLimit ||
                        sessionInvalid
                      }
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
            onConfirm={(rememberTab) => {
              if (panel === "start") {
                retiring.current = false;
                setRemember(rememberTab);
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
          key={viewEpoch}
          visible={panel === "survey"}
          config={config.survey}
          contact={config.contact}
          session={session}
          onSession={setSession}
          remember={remember}
          onSubmitted={() => setSurveySubmitted(true)}
          onClose={() => setPanel(null)}
        />
      </dialog>
    </main>
  );
}
