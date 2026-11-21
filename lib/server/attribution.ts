import { z } from "zod";
import type { Message } from "../config";
import { AppError } from "./errors";
import type { StreamReply } from "./stream-chat";

export const attributionReview = z
  .object({
    edits: z
      .array(
        z
          .object({
            field: z.number().int().nonnegative(),
            before: z.string().min(1).max(200),
            after: z.string().max(200),
            evidence: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
type Review = (
  statements: string[],
  fields: string[],
  diaryIndex: number | null,
  verify: boolean,
) => Promise<z.infer<typeof attributionReview>>;

// Korean subjects may be omitted. Inspect both the source and the proposed wording,
// including newly introduced people, recipients, reported speech and shared actions.
const actorCue =
  /[가-힣](?:이|가|은|는|께서|에게|한테|한테서|와|과|랑|하고)(?=\s|[,.:!?])|함께|같이|혼자|직접|대신|서로|둘이|우리|라고|달라|친구|동료|선배|후배|가족|부모|아이|선생님|팀장|엄마|아빠|동생|언니|오빠|누나|형이|\b(?:I|we|they|he|she|together)\b/i;
const attributionError = () =>
  new AppError(502, "ATTRIBUTION", "누가 한 일인지 확인하지 못했어요. 입력은 그대로 남아 있어요.");

export async function preserveAttribution(input: Message[], reply: StreamReply, review: Review) {
  const statements = input.filter((m) => m.role === "user").map((m) => m.content);
  const fields = [...reply.sentences];
  if (reply.diaryDraft) fields.push(reply.diaryDraft);
  if (![...statements, ...fields].some((text) => actorCue.test(text))) return reply;
  const diaryIndex = reply.diaryDraft ? reply.sentences.length : null;
  const { edits } = await review(statements, fields, diaryIndex, false);
  if (!edits.length) return reply;
  for (const { field, before, after, evidence } of edits) {
    const value = fields[field];
    if (
      !statements.some((s) => s.includes(evidence)) ||
      !value ||
      !value.includes(before) ||
      value.indexOf(before) !== value.lastIndexOf(before) ||
      /[\r\n]/.test(before + after) ||
      before.replace(/[^?？.!。]/g, "") !== after.replace(/[^?？.!。]/g, "")
    )
      throw attributionError();
    fields[field] = value.replace(before, () => after).trim();
    if (!fields[field] || fields[field].length > (field === reply.sentences.length ? 500 : 600))
      throw attributionError();
  }
  // Verify the assembled wording, including the question and diary, before publishing any correction.
  if ((await review(statements, fields, diaryIndex, true)).edits.length) throw attributionError();
  return {
    ...reply,
    sentences: fields.slice(0, reply.sentences.length),
    ...(reply.diaryDraft ? { diaryDraft: fields[reply.sentences.length] } : {}),
  };
}
