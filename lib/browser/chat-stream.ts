import { z } from "zod";
import { explorationViewSchema } from "../exploration";
export class ChatDisplayError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
export function chatErrorMessage(error: unknown) {
  if (error instanceof ChatDisplayError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError")
    return "답변을 기다리는 시간이 길어졌어요. 입력은 이 화면에 남아 있어요. 다시 시도해 주세요.";
  if (error instanceof TypeError)
    return "연결이 잠시 끊겼어요. 이 화면의 대화와 입력은 그대로 남아 있어요. 연결을 확인한 뒤 다시 시도해 주세요.";
  return "답변을 끝까지 확인하지 못했어요. 이전 대화와 입력은 이 화면에 남아 있어요. 다시 답변을 받아 주세요.";
}
export async function failedChatRequest(response: Response) {
  const payload = await response.json().catch(() => null);
  const code = typeof payload?.code === "string" ? payload.code : undefined;
  if (code && typeof payload.error === "string" && /^[가-힣]/.test(payload.error))
    return new ChatDisplayError(payload.error, code);
  const message =
    response.status === 429
      ? "요청이 잠시 몰렸어요. 조금 뒤 다시 시도해 주세요."
      : response.status === 400 || response.status === 413
        ? "입력 내용을 확인한 뒤 다시 보내 주세요."
        : "대화 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
  return new ChatDisplayError(message, code);
}
export const completedChatSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
  text: z.string().min(1),
  token: z.string(),
  notice: z.boolean(),
  help: z.boolean(),
  completed: z.boolean(),
  surveyReady: z.boolean().optional().default(false),
  diaryDraft: z.string().max(500).nullish(),
  turns: z.number(),
  questions: z.number(),
  exploration: explorationViewSchema.optional(),
  emotion: z.object({
    emotionId: z.string(),
    customLabel: z.string(),
    intensityBand: z.string(),
    version: z.number(),
    intensityPercent: z.number().int().min(0).max(100).optional(),
  }),
  conversationLimit: z.boolean().optional(),
  timing: z.record(z.string(), z.unknown()).optional(),
});
export type CompletedChat = z.infer<typeof completedChatSchema>;
export async function readChatStream(
  response: Response,
  requestId: string,
  onText: (text: string) => void,
) {
  if (!response.body) throw new ChatDisplayError("답변 연결을 확인할 수 없어요.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    text = "",
    done: z.infer<typeof completedChatSchema> | undefined;
  let firstByte = true;
  try {
    while (true) {
      const item = await reader.read();
      if (firstByte && item.value?.length) {
        performance.mark("chat-byte:" + requestId);
        firstByte = false;
      }
      buffer += decoder.decode(item.value, { stream: !item.done });
      if (buffer.length > 150000) throw new ChatDisplayError("답변이 너무 길어요.");
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.requestId !== requestId) throw new ChatDisplayError("다른 요청의 답변이에요.");
        if (done) throw new ChatDisplayError("완료 뒤 예상하지 못한 응답이에요.");
        if (event.type === "text") {
          text += z.string().parse(event.delta);
          onText(text);
        } else if (event.type === "error")
          throw new ChatDisplayError(
            typeof event.error === "string" && /^[가-힣]/.test(event.error)
              ? event.error
              : "답변을 마치지 못했어요. 다시 시도해 주세요.",
          );
        else if (event.type === "done") {
          done = completedChatSchema.parse(event);
          if (done.text !== text) throw new ChatDisplayError("답변 내용이 일치하지 않아요.");
        }
      }
      if (item.done) break;
    }
    if (buffer.trim() || !done)
      throw new ChatDisplayError(
        "답변 연결이 끊겼어요. 받은 내용은 아래에 남아 있어요. 다시 요청할 수 있어요.",
      );
    return done;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
