import { z } from "zod";
export const MAX_HISTORY_MESSAGES = 80;
export const messageSchema = z
  .object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })
  .strict();
export const chatSchema = z
  .object({
    requestId: z.string().uuid(),
    conversationId: z.string().uuid(),
    token: z.string().max(4096),
    history: z.array(messageSchema).max(MAX_HISTORY_MESSAGES),
    message: z.string().trim().min(1).max(4000),
    action: z.enum(["chat", "summary"]).default("chat"),
  })
  .strict();
export const replySchema = z
  .object({
    body: z
      .string()
      .min(1)
      .max(1000)
      .regex(/^[^?？]*$/),
    question: z
      .string()
      .max(180)
      .regex(/^$|^[^?？.。!！\n]+[?？]$/)
      .nullable(),
    stage: z.enum(["emotion", "thought", "need", "diary", "listen", "end"]),
    safety: z.enum(["normal", "check", "emergency", "violence"]),
  })
  .strict();
export const classificationSchema = z
  .object({
    safety: z.enum(["normal", "check", "emergency", "violence"]),
    harmfulRequest: z.boolean(),
    noQuestions: z.boolean(),
    safetyResolved: z.boolean(),
  })
  .strict();
export type Safety = z.infer<typeof classificationSchema>["safety"];
export type Reply = z.infer<typeof replySchema>;
