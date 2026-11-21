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
  /(?:^|[,.!?]\s*|\s+(?=오늘은|이제|여기까지)|(?:대화는?|대화를)\s+)(?:(?:지금|이제|오늘은|그냥|바로)\s*)*(?:정리해\s*(?:줘|주세요)?|그만할(?:래|게)(?:요)?|끝내(?:자|\s*(?:줘|주세요))|마무리(?:할게요?|해\s*(?:줘|주세요))|여기까지(?:\s*할(?:래|게)요?)?)[.!\s]*$/.test(
    text.trim(),
  );
export const wantsListening = (text: string) =>
  /(?:그냥|말만|얘기만|이야기만)\s*들어(?:\s*(?:줘|주|줬)|[.!?\s]*$)|들어\s*만\s*(?:줘|주)|묻지\s*(?:말|마)|질문(?:은|을|도)?\s*(?:없이|말고|그만|빼|싫|원하지|하지\s*(?:말|마))|질문.{0,6}받고\s*싶지/.test(
    text,
  );

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
      /(?:기록|일기|다이어리|초안).{0,10}(?:안\s*(?:할|쓸|하고|쓰고)|싫|거절|하지\s*마|원하지|필요\s*없|(?:하고|쓰고|남기고)\s*싶지)/.test(
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
    /(?:(?:기록|일기|초안|다이어리)(?:으로|에|을|를)?\s*(?:남기고\s*싶|하고\s*싶|쓰고\s*싶|(?:정리해|남겨|해|써|만들어)\s*(?:줘|주세요))|(?:한\s*(?:줄|문장)(?:으로|로)?|이\s*마음을?|그걸|이걸|지금|바로)\s*(?:적고\s*싶|남기고\s*싶|적어\s*(?:줘|주세요)))(?:어요?|요)?[.!\s]*$/.test(
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
  // A direct request for wording calls for an answer. An ordinary account, even a detailed one, opens exploration.
  const asksForWording =
    /(?:문자|메시지|답장|표현|문구).{0,35}(?:써\s*(?:줘|주세요)|쓰면|작성해|추천해)|어떻게\s*(?:말하면|전하면|답하면|쓰면)/.test(
      latest,
    );
  const firstInput = action === "chat" && progress.turns === 0 && history.length === 0;
  const openingQuestion = firstInput && !forceComplete && !listening && !asksForWording;
  return {
    current,
    forceComplete,
    exploring,
    listening,
    firstInput,
    openingQuestion,
    skipDiary: skipDiary || listening,
  };
}
export const DIARY_INVITATION =
  "지금까지 나눈 이야기로 짧은 기록을 만들었어요. 내 말에 맞게 고치거나, 남기고 싶을 때 복사해 두세요.";
