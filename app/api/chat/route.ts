import { GUIDED_HISTORY_MESSAGES } from "@/lib/config";
import { responsePlan } from "@/lib/conversation";
import { selectionForClient } from "@/lib/emotions";
import { NextRequest } from "next/server";
import { chatSchema, MAX_HISTORY_MESSAGES } from "@/lib/server/schemas";
import { validateState, state } from "@/lib/server/session";
import { limits, configured, chatModel } from "@/lib/server/config";
import { json, failure, readJson } from "@/lib/server/http";
import { Gate } from "@/lib/server/limits";
import { DatabaseStore } from "@/lib/server/database";
import { PROMPT_VERSION } from "@/lib/server/prompts";
import { runChat } from "@/lib/server/chat";
import { AppError, explainProviderError } from "@/lib/server/errors";
import { controlText } from "@/lib/exploration";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const arrived = performance.now();
  try {
    const raw = await readJson(req, 360000);
    if (
      raw &&
      typeof raw === "object" &&
      "history" in raw &&
      Array.isArray(raw.history) &&
      raw.history.length >=
        ("guided" in raw && raw.guided === true ? GUIDED_HISTORY_MESSAGES : MAX_HISTORY_MESSAGES)
    )
      throw new AppError(
        409,
        "CONTEXT",
        "이 대화가 담을 수 있는 길이에 도달했어요. 필요한 내용을 옮겨 적고 새 대화를 시작할 수 있어요.",
      );
    const parsed = chatSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, "INPUT", "입력 내용을 확인해 주세요.");
    const p = parsed.data,
      c = limits();
    if (p.control && (!p.guided || p.message !== controlText[p.control]))
      throw new AppError(400, "INPUT", "대화 선택을 확인해 주세요.");
    if (p.message.length > c.input)
      throw new AppError(413, "INPUT_LENGTH", `한 번에 ${c.input}자까지 보낼 수 있어요.`);
    const length = p.history.reduce((n, m) => n + m.content.length, 0) + p.message.length;
    const reserveRecord =
      p.guided &&
      responsePlan({ turns: 0, questions: 0, completed: false }, p.action, p.message, p.history)
        .forceComplete;
    if (
      length > (p.guided ? 60000 : c.history) ||
      (p.guided &&
        !reserveRecord &&
        (p.history.length >= GUIDED_HISTORY_MESSAGES - 2 || length > 56000))
    )
      throw new AppError(
        409,
        "CONTEXT",
        "이 대화가 담을 수 있는 길이에 도달했어요. 필요한 내용을 옮겨 적고 새 대화를 시작할 수 있어요.",
      );
    const s = await validateState(
      req.cookies.get("maeum_session")?.value,
      p.token,
      p.conversationId,
      p.history,
    );
    if (s.ackRid)
      await new Gate(new DatabaseStore(), c).acknowledge(
        s.sid,
        p.conversationId,
        s.ackRid,
        s.revision,
      );
    if (!configured())
      throw new AppError(
        503,
        "SETUP",
        "AI 대화 설정을 준비 중이에요. 도움 받기는 계속 이용할 수 있어요.",
      );
    const { AI } = await import("@/lib/server/openai");
    if (p.guided || req.headers.get("accept")?.includes("application/x-ndjson")) {
      const { runStreamingChat } = await import("@/lib/server/stream-chat");
      const readyMs = performance.now() - arrived;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const emit = (event: Record<string, unknown>) =>
            controller.enqueue(
              encoder.encode(JSON.stringify({ ...event, requestId: p.requestId }) + "\n"),
            );
          try {
            emit({ type: "start" });
            const result = await runStreamingChat(
              {
                sid: s.sid,
                cid: p.conversationId,
                rid: p.requestId,
                messageId: p.messageId,
                revision: s.revision,
                safety: s.safety,
                progress: s.progress,
                history: p.history,
                message: p.message,
                action: p.action,
                emotion: p.emotion,
                guided: p.guided,
                sessionUsage: p.guided,
                control: p.control,
              },
              new Gate(new DatabaseStore(), c),
              new AI(chatModel(), c.output, { signal: req.signal, requestId: p.requestId }),
              (delta) => emit({ type: "text", delta }),
            );
            const token = await state(
              s.sid,
              p.conversationId,
              result.history,
              result.safety,
              result.explorationView?.conversationStage ||
                (result.progress.completed ? "end" : "emotion"),
              result.revision,
              result.progress,
              p.requestId,
            );
            emit({
              type: "done",
              text: result.body,
              token,
              conversationId: p.conversationId,
              notice: false,
              help: result.safety !== "normal",
              completed: result.progress.completed,
              surveyReady: result.surveyReady,
              diaryDraft: result.diaryDraft,
              exploration: result.explorationView,
              turns: result.progress.turns,
              questions: result.progress.questions,
              emotion: selectionForClient(result.emotion, raw?.emotion?.intensityBand),
              conversationLimit:
                result.history.length >=
                  (p.guided ? GUIDED_HISTORY_MESSAGES - 2 : MAX_HISTORY_MESSAGES) ||
                Boolean(
                  p.guided &&
                  result.history.reduce((total, item) => total + item.content.length, 0) > 54500,
                ),
              timing: {
                promptVersion: PROMPT_VERSION,
                model: chatModel(),
                requestSetupMs: readyMs,
                ...result.timing,
              },
            });
            console.info("chat_timing", {
              requestId: p.requestId,
              model: chatModel(),
              promptVersion: PROMPT_VERSION,
              requestSetupMs: readyMs,
              ...result.timing,
            });
          } catch (error) {
            const visible = explainProviderError(error);
            console.warn("chat_failed", { requestId: p.requestId, code: visible.code });
            try {
              emit({ type: "error", error: visible.message, code: visible.code });
            } catch {}
          } finally {
            try {
              controller.close();
            } catch {}
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
          "X-Request-ID": p.requestId,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const result = await runChat(
      {
        sid: s.sid,
        cid: p.conversationId,
        rid: p.requestId,
        revision: s.revision,
        safety: s.safety,
        stage: s.stage,
        history: p.history,
        message: p.message,
        summary: p.action === "summary",
      },
      new Gate(new DatabaseStore(), c),
      new AI(chatModel(), c.output, { signal: req.signal, requestId: p.requestId }),
    );
    return json({
      text: result.body,
      token: await state(
        s.sid,
        p.conversationId,
        result.history,
        result.safety,
        result.stage,
        result.revision,
      ),
      conversationId: p.conversationId,
      requestId: p.requestId,
      notice: result.notice,
      help: result.safety !== "normal",
      conversationLimit: result.conversationLimit,
    });
  } catch (error) {
    return failure(error);
  }
}
