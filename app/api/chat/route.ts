import { NextRequest } from "next/server";
import { chatSchema, MAX_HISTORY_MESSAGES } from "@/lib/server/schemas";
import { validateState, state } from "@/lib/server/session";
import { limits, configured, chatModel } from "@/lib/server/config";
import { json, failure, readJson } from "@/lib/server/http";
import { Gate } from "@/lib/server/limits";
import { DatabaseStore } from "@/lib/server/database";
import { runChat } from "@/lib/server/chat";
import { AppError, explainProviderError } from "@/lib/server/errors";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    const raw = await readJson(req, 128000);
    if (
      raw &&
      typeof raw === "object" &&
      "history" in raw &&
      Array.isArray(raw.history) &&
      raw.history.length >= MAX_HISTORY_MESSAGES
    )
      throw new AppError(
        409,
        "CONTEXT",
        "이 대화가 담을 수 있는 길이에 도달했어요. 일기 틀로 정리한 뒤 새 대화를 시작해 주세요.",
      );
    const parsed = chatSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, "INPUT", "입력 내용을 확인해 주세요.");
    const p = parsed.data,
      c = limits();
    if (p.message.length > c.input)
      throw new AppError(413, "INPUT_LENGTH", `한 번에 ${c.input}자까지 보낼 수 있어요.`);
    if (p.history.reduce((n, m) => n + m.content.length, 0) + p.message.length > c.history)
      throw new AppError(
        409,
        "CONTEXT",
        "이 대화가 담을 수 있는 길이에 도달했어요. 화면의 일기 틀로 정리하거나 새 대화를 시작해 주세요.",
      );
    const s = await validateState(
      req.cookies.get("maeum_session")?.value,
      p.token,
      p.conversationId,
      p.history,
    );
    if (!configured())
      throw new AppError(
        503,
        "SETUP",
        "AI 대화 설정을 준비 중이에요. 도움 받기와 일기 틀은 계속 이용할 수 있어요.",
      );
    const { AI } = await import("@/lib/server/openai");
    if (req.headers.get("accept")?.includes("application/x-ndjson")) {
      const { runStreamingChat } = await import("@/lib/server/stream-chat");
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
              result.progress.completed ? "end" : "emotion",
              result.revision,
              result.progress,
            );
            emit({
              type: "done",
              text: result.body,
              token,
              conversationId: p.conversationId,
              notice: false,
              help: result.safety !== "normal",
              completed: result.progress.completed,
              turns: result.progress.turns,
              questions: result.progress.questions,
              emotion: result.emotion,
              conversationLimit: result.history.length >= MAX_HISTORY_MESSAGES,
              timing: result.timing,
            });
            console.info("chat_timing", {
              requestId: p.requestId,
              model: chatModel(),
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
