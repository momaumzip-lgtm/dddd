import { z } from "zod";
import { emotionSelectionSchema } from "../emotions";
import { controlSchema, explorationViewSchema, mindRecordSchema } from "../exploration";
import { completedChatSchema } from "./chat-stream";

export const tabChatKey = "maumzip:tab:chat:v1";
export const tabSurveyKey = (conversationId: string) => "maumzip:tab:survey:v1:" + conversationId;
const expiry = 2 * 60 * 60 * 1000;
export const browserSessionSchema = z.object({
  conversationId: z.string().uuid(),
  token: z.string().max(4096),
});
export const pendingSchema = z.object({
  text: z.string().max(4000),
  action: z.enum(["chat", "summary", "continue"]),
  messageId: z.string().uuid().optional(),
  control: controlSchema.optional(),
});
const history = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
  .max(80);
export const tabChatSchema = z.object({
  session: browserSessionSchema.nullable(),
  history,
  emotion: emotionSelectionSchema,
  draft: z.string().max(4000),
  pending: pendingSchema.nullable(),
  receipt: z
    .object({
      data: completedChatSchema,
      active: browserSessionSchema,
      request: pendingSchema,
      selectedVersion: z.number().optional(),
      history,
    })
    .nullable(),
  completion: z.enum(["open", "confirmed"]),
  continueAfterRecord: z.boolean(),
  exploration: explorationViewSchema.nullable(),
  diaries: z.record(z.string(), z.string().max(500)),
  records: z.record(z.string(), mindRecordSchema),
  help: z.boolean(),
  surveyInvite: z.boolean(),
  surveyAvailable: z.boolean(),
  surveySubmitted: z.boolean(),
  panel: z.literal("survey").nullable(),
  conversationLimit: z.boolean(),
});
export type TabChat = z.infer<typeof tabChatSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;
export type Pending = z.infer<typeof pendingSchema>;

export function forgetTab(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
export function readTab<T>(key: string, schema: z.ZodType<T>): T | undefined {
  try {
    const value = sessionStorage.getItem(key);
    if (!value || value.length > 220000) return;
    const envelope = z.object({ savedAt: z.number(), data: schema }).safeParse(JSON.parse(value));
    if (envelope.success && Date.now() - envelope.data.savedAt < expiry) return envelope.data.data;
    forgetTab(key);
  } catch {
    forgetTab(key);
  }
}
export function saveTab(key: string, data: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    return true;
  } catch {
    return false;
  }
}
