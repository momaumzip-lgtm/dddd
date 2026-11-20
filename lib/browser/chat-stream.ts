import { z } from "zod";
export const completedChatSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
  text: z.string().min(1),
  token: z.string(),
  notice: z.boolean(),
  help: z.boolean(),
  completed: z.boolean(),
  surveyReady: z.boolean().optional().default(false),
  turns: z.number(),
  questions: z.number(),
  emotion: z.object({
    emotionId: z.string(),
    customLabel: z.string(),
    intensityBand: z.string(),
    version: z.number(),
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
  if (!response.body) throw new Error("답변 연결을 확인할 수 없어요.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    text = "",
    done: z.infer<typeof completedChatSchema> | undefined;
  try {
    while (true) {
      const item = await reader.read();
      buffer += decoder.decode(item.value, { stream: !item.done });
      if (buffer.length > 150000) throw new Error("답변이 너무 길어요.");
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.requestId !== requestId) throw new Error("다른 요청의 답변이에요.");
        if (done) throw new Error("완료 뒤 예상하지 못한 응답이에요.");
        if (event.type === "text") {
          text += z.string().parse(event.delta);
          onText(text);
        } else if (event.type === "error") throw new Error(z.string().parse(event.error));
        else if (event.type === "done") {
          done = completedChatSchema.parse(event);
          if (done.text !== text) throw new Error("답변 내용이 일치하지 않아요.");
        }
      }
      if (item.done) break;
    }
    if (buffer.trim() || !done)
      throw new Error(
        "답변 연결이 끊겼어요. 받은 내용은 아래에 남아 있어요. 다시 요청할 수 있어요.",
      );
    return done;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
