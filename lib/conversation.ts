import { z } from "zod";
import { explorationSchema } from "./exploration";
export const progressSchema = z
  .object({
    turns: z.number().int().min(0).max(40),
    questions: z.number().int().min(0).max(40),
    completed: z.boolean(),
    messageIds: z.array(z.string().uuid()).max(40).optional(),
    exploration: explorationSchema.optional(),
  })
  .strict();
export type Progress = z.infer<typeof progressSchema>;
export const freshProgress: Progress = { turns: 0, questions: 0, completed: false };
export const wantsFinish = (text: string) =>
  /(?:^|[,.!?]\s*|\s+(?=오늘은|이제|여기까지)|(?:대화는?|대화를)\s+)(?:(?:지금|이제|오늘은|이만|그냥|바로)\s*)*(?:정리해\s*(?:줘|주세요)?|그만할(?:래|게)(?:요)?|끝내(?:자|\s*(?:줘|주세요))|마무리(?:할게요?|해\s*(?:줘|주세요))|여기까지(?:\s*할(?:래|게)요?)?)[.!\s]*$/.test(
    text.trim(),
  );
export const wantsListening = (text: string) =>
  /(?:그냥|말만|얘기만|이야기만)\s*들어(?:\s*(?:줘(?:요)?|주세요|주실래요)(?=[.!?\s]*$)|[.!?\s]*$)|들어\s*만\s*(?:줘|주)|묻지\s*(?:말|마)|질문(?:은|을|도)?\s*(?:없이|말고|그만|빼|싫|원하지|하지\s*(?:말|마))|질문.{0,6}받고\s*싶지/.test(
    text,
  );

function onlyExpressesUncertainty(text: string) {
  const clauses = text
    .split(/[.!。！,\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return (
    clauses.length > 0 &&
    clauses.every((clause) => {
      const words = clause.replace(
        /^(?:(?:아직|저도|그냥|잘|딱히|지금은|뭔지|그건|정확히)\s*)+/,
        "",
      );
      return /^(?:모르겠(?:어(?:요)?|습니다|네요)|(?:뭐라(?:고)?\s*)?(?:말하|설명하|표현하)기\s*(?:좀\s*)?(?:어려워(?:요)?|어렵네요)|(?:기억|생각)이?\s*안\s*나(?:요)?)$/.test(
        words,
      );
    })
  );
}

function storyBeforeDiaryRequest(text: string) {
  const trimmed = text.trim().replace(/[.!?。！？\s]+$/, "");
  const clause = trimmed
    .split(/[.!?。！？,，\n]/)
    .at(-1)
    ?.trim();
  if (!clause || /나중에|다음번에|다음에|내일|이따가/.test(clause)) return null;
  const asksForDraft =
    /(?:기록|일기|초안|다이어리)(?:으로|에|을|를)?\s*(?:한\s*(?:줄|문장)(?:으로|로)?\s*)?(?:정리해|남겨|적어|해|써|만들어)\s*(?:줘|주세요|줄래요)$/.exec(
      clause,
    );
  const asksForLine =
    /(?:한\s*(?:줄|문장)(?:으로|로)?|이\s*마음을?|그걸|이걸|지금|바로)\s*적어\s*(?:줘|주세요|줄래요)$/.exec(
      clause,
    );
  // First-person wishes are ambiguous unless they refer to this chat or its written result.
  const wantsDraftHere =
    /^(?:(?:이제는?|지금은?|바로|여기서|이걸|그걸|이 마음을|오늘 대화를)\s*)+(?:한\s*(?:줄|문장)(?:으로|로)?\s*)?(?:기록|일기|초안|다이어리)(?:으로|에|을|를)?\s*(?:남기고|하고|쓰고|적고)\s*싶(?:어|어요|습니다)$/.exec(
      clause,
    );
  const wantsOneLine =
    /^한\s*(?:줄|문장)(?:으로|로)?\s*(?:기록하고|적고|남기고)\s*싶(?:어|어요|습니다)$/.exec(clause);
  const request = asksForDraft ?? asksForLine ?? wantsDraftHere ?? wantsOneLine;
  return request ? trimmed.slice(0, trimmed.length - clause.length + request.index).trim() : null;
}

// A short question can refer to our last prompt, rather than describe a new event.
function asksAboutQuestion(text: string) {
  const lastClause =
    text
      .trim()
      .replace(/[?？.!…。]+$/, "")
      .split(/[.!?？。\n]/)
      .at(-1) || "";
  const words = lastClause.replace(/\s+/g, "").replace(/^(?:근데|그런데|그럼)/, "");
  const referent = words.replace(/^(?:그게|그건|그거|방금질문은|그질문은|여기서)/, "");
  if (
    /(?:이냐는말은|이라는말은|라는말은|라는질문은|냐는게|냐는건)무슨뜻(?:이야|이에요|인가요|이죠)?$/.test(
      referent,
    )
  )
    return true;
  if (
    /^(?:무슨|어떤|누구의?)(?:뜻|말|소리|반응|기대|대답|도움|상황)(?:이야|이죠|이에요|인데요|예요|이요|요|인가요|인지(?:잘)?모르겠(?:어|어요))?$/.test(
      referent,
    )
  )
    return true;
  if (
    /^(?:무슨|어떤)(?:뜻|말|반응|기대|도움)(?:을|를)?(?:말하는|말씀하시는|묻는)(?:거|건)(?:야|예요|가요|데요)?$/.test(
      referent,
    )
  )
    return true;
  return /^(?:(?:그|방금)?질문(?:이|을)?(?:이해가?안(?:돼|돼요|가요)|어렵네요)|(?:다시|쉽게)(?:물어봐|물어봐줘|물어봐주세요|말해줘|설명해주세요))$/.test(
    words,
  );
}

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
  const recordStory = skipDiary ? null : storyBeforeDiaryRequest(latest);
  const forceComplete = action === "summary" || wantsFinish(latest) || recordStory !== null;
  // A direct request for wording calls for an answer. An ordinary account, even a detailed one, opens exploration.
  const asksForWording =
    /(?:문자|메시지|답장|표현|문구).{0,35}(?:써\s*(?:줘|주세요)|쓰면|작성해|추천해)|어떻게\s*(?:말하면|전하면|답하면|쓰면)/.test(
      latest,
    );
  const asksForPracticalHelp =
    /(?:프로젝트|업무|작업|보고서|일정|마감|우선순위|할 일).{0,40}(?:계획.{0,12}(?:짜|잡|세워)|(?:짜|정리해|나눠|잡아|도와)\s*(?:줘|주세요)|(?:방법|순서).{0,10}(?:알려|가르쳐))|수정\s*순서.{0,8}알려/.test(
      latest,
    ) && !/(?:라고 했|라고 하더|라고 들|라고 부탁했)/.test(latest);
  if (asksForPracticalHelp) listening = false;
  const workReflection =
    !asksForPracticalHelp &&
    [...history.filter((m) => m.role === "user").map((m) => m.content), latest].some((text) =>
      /회사|업무|프로젝트|팀장|직장|출근|퇴근|마감|보고서/.test(text),
    );
  const firstInput = action === "chat" && progress.turns === 0 && history.length === 0;
  // A brief feeling or an uncertain answer can stand on its own for this turn.
  const previous = history.at(-1);
  const shortNegativeAnswer =
    /^(?:(?:네|응|아니(?:요)?)[,，]?\s*)?(?:(?:아직|딱히|별로|그런\s*(?:일|적)(?:은|이)?)\s*)*없(?:어(?:요)?|었(?:어(?:요)?|습니다)|습니다|네요)[.!。…\s]*$/.test(
      latest.trim(),
    );
  const briefDisappointment =
    /^(?:(?:네|응)[,，]?\s*)?(?:(?:그냥|조금|좀|살짝|약간)\s*)*(?:(?:서운|섭섭)(?:했(?:어요|어|네요|습니다)|해(?:요)?|하네요|하긴\s*(?:했어요|해요)|하더라고요)|아쉬(?:웠(?:어요|어|네요)|워(?:요)?))[.!。…\s]*$/.test(
      latest.trim(),
    );
  if (
    !forceComplete &&
    (briefDisappointment ||
      (previous?.role === "assistant" &&
        /[?？]\s*$/.test(previous.content) &&
        (shortNegativeAnswer ||
          (onlyExpressesUncertainty(latest) &&
            (/어려|어렵|기억/.test(latest) ||
              onlyExpressesUncertainty(
                history.filter((m) => m.role === "user").at(-1)?.content || "",
              ))))))
  )
    listening = true;
  const openingQuestion =
    firstInput && !forceComplete && !listening && !asksForWording && !asksForPracticalHelp;
  const clarifyQuestion =
    !forceComplete &&
    !listening &&
    previous?.role === "assistant" &&
    /[?？]/.test(previous.content) &&
    asksAboutQuestion(latest);
  // "What reaction?" can call out an expectation introduced by our own question.
  const assumedReply =
    clarifyQuestion &&
    /(?:바랐던|바라는|기대(?:한|했던))\s*(?:반응|대답)|(?:반응|대답)(?:을|이)?\s*(?:바랐|기대)/.test(
      previous.content,
    ) &&
    ![...history.filter((m) => m.role === "user").map((m) => m.content), latest].some((text) =>
      /바랐|바라는|기대했|원했|(?:줬|줬으|했으)면\s*(?:했|좋)|듣고\s*싶/.test(text),
    );
  const followupQuestion =
    !firstInput &&
    !forceComplete &&
    !listening &&
    !asksForWording &&
    !asksForPracticalHelp &&
    (clarifyQuestion || !/[?？]$/.test(latest.trim()));
  // A new segment after "continue" needs its own evidence before it can finish.
  const mayReflect =
    followupQuestion &&
    !skipDiary &&
    !clarifyQuestion &&
    !onlyExpressesUncertainty(latest) &&
    current.turns >= 2 &&
    !/(?:더|계속|아직).{0,15}(?:얘기|이야기|알고|말하고|살펴|궁금|생각나)|(?:끝내|마치|정리하)고\s*싶지/.test(
      latest,
    );
  return {
    current,
    forceComplete,
    recordStory,
    recordCorrection:
      forceComplete &&
      /반대로|정정|잘못\s*(?:말|썼|적)|바꿔\s*말|고쳐\s*(?:써|줘|주세요)/.test(latest),
    followupQuestion,
    clarifyQuestion,
    assumedReply,
    mayReflect,
    asksForPracticalHelp,
    workReflection,
    listening,
    briefDisappointment,
    declinesDiary: skipDiary,
    firstInput,
    openingQuestion,
    skipDiary: skipDiary || listening,
  };
}
export const DIARY_INVITATION = "오늘 다이어리에는 이 한 줄을 남겨보세요.";
