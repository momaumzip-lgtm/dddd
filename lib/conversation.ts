import { z } from "zod";
export const progressSchema = z
  .object({
    turns: z.number().int().min(0).max(40),
    questions: z.number().int().min(0).max(40),
    completed: z.boolean(),
    messageIds: z.array(z.string().uuid()).max(40).optional(),
  })
  .strict();
export type Progress = z.infer<typeof progressSchema>;
export const freshProgress: Progress = { turns: 0, questions: 0, completed: false };
export const wantsFinish = (text: string) =>
  /^(?:지금\s*|이제\s*|오늘은\s*)?(?:정리해\s*(?:줘|주세요)?|그만할래(?:요)?|끝내자|마무리해\s*주세요|여기까지(?:\s*할래요)?)[.!\s]*$/.test(
    text.trim(),
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
  let listening = false,
    skipDiary = false;
  for (const text of [...history.filter((m) => m.role === "user").map((m) => m.content), latest]) {
    if (wantsListening(text)) listening = true;
    else if (
      /조언해|조언.{0,8}(원해|주세요)|해결.{0,8}(알려|원해)|방법.{0,8}알려|수정\s*순서|실무.{0,8}도와|살펴보고\s*싶|질문해|어떻게\s*(?:말하면|쓰면|전하면|답하면)|문자.{0,10}(?:써\s*줘|써\s*주세요)/.test(
        text,
      )
    )
      listening = false;
    const declinesDiary =
      /(?:기록|일기|다이어리|초안).{0,10}(?:안\s*(?:할|쓸|하고|쓰고)|싫|하지\s*마|원하지|필요\s*없|(?:하고|쓰고|남기고)\s*싶지)/.test(
        text,
      );
    const requestsDiary =
      /(?:기록|일기|다이어리|초안).{0,12}(?:남기고\s*싶|하고\s*싶|쓰고\s*싶|써\s*(?:줘|주세요)|해\s*(?:줘|주세요)|만들어\s*(?:줘|주세요))/.test(
        text,
      );
    if (declinesDiary) skipDiary = true;
    else if (requestsDiary) {
      skipDiary = false;
      listening = false;
    }
  }
  const asksToRecordNow =
    /(?:기록|일기|초안)(?:으로|을|를)?\s*(?:하고\s*싶(?:어|어요)|(?:해|써|만들어)\s*(?:줘|주세요))[.!\s]*$/.test(
      latest,
    );
  const forceComplete =
    action === "summary" || wantsFinish(latest) || (!skipDiary && asksToRecordNow);
  const exploring =
    !forceComplete &&
    !/(?:이야기|살펴보|알아보|탐색|얘기).{0,8}(?:싶지|싫|그만)/.test(latest) &&
    /(?:더|계속|깊이).{0,10}(?:이야기|살펴보|알아보|탐색|얘기).{0,6}(?:싶|할래|해보|볼래)/.test(
      latest,
    );
  return { current, forceComplete, exploring, listening, skipDiary: skipDiary || listening };
}
export const JOURNAL_CLOSING =
  "대화로 정리된 생각을 내 것으로 만드는 마지막 단계예요. 펜을 들어 오늘의 핵심 깨달음을 다이어리에 기록해 보세요";
