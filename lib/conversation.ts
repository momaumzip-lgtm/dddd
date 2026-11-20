import { z } from "zod";
export const progressSchema = z
  .object({
    turns: z.number().int().min(0).max(40),
    questions: z.number().int().min(0).max(2),
    completed: z.boolean(),
    messageIds: z.array(z.string().uuid()).max(40).optional(),
  })
  .strict();
export type Progress = z.infer<typeof progressSchema>;
export const freshProgress: Progress = { turns: 0, questions: 0, completed: false };
export const wantsFinish = (text: string) =>
  /정리해|정리\s*부탁|그만(?:할|하|둘|해|하고|$)|끝낼|마칠|여기까지(?:야|할|해|정리|$)|모르겠/.test(
    text,
  );
export const wantsListening = (text: string) =>
  /그냥\s*들어|조언.{0,6}(싫|말|원하지)|질문.{0,8}(싫|하지\s*마|말고|원하지)/.test(text);
export function responsePlan(
  progress: Progress,
  action: string,
  latest: string,
  history: { role: string; content: string }[],
) {
  const current = action === "continue" ? freshProgress : progress;
  const listening = [
    ...history.filter((m) => m.role === "user").map((m) => m.content),
    latest,
  ].reduce((previous, text) => {
    if (wantsListening(text)) return true;
    if (
      /조언해|조언.{0,8}(원해|주세요)|해결.{0,8}(알려|원해)|방법.{0,8}알려|수정\s*순서|실무.{0,8}도와/.test(
        text,
      )
    )
      return false;
    return previous;
  }, false);
  return {
    current,
    forceComplete:
      action === "summary" ||
      wantsFinish(latest) ||
      current.turns >= 2 ||
      current.questions >= 2 ||
      listening,
    listening,
    remainingQuestions: Math.max(0, 2 - current.questions),
  };
}
