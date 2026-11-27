import { z } from "zod";
import type { Message } from "../config";
import { DIARY_INVITATION, freshProgress, responsePlan, type Progress } from "../conversation";
import {
  emotionItems,
  correctedSelection,
  selectionContext,
  type EmotionSelection,
} from "../emotions";
import { AppError } from "./errors";
import { hasOutputInstructions, selectSentences, sentenceBoundaries } from "./reply-text";
import { preserveAttribution } from "./attribution";
import type { Gate } from "./limits";
import type { Safety } from "./schemas";
import { urgent, retainRisk, safetyReply, safetyText, hasSafetyClarification } from "./safety";
import { runGuidedTurn, type GuidedEvidence, type GuidedPrompt } from "./guided-chat";
import type { ExplorationControl, ExplorationView, MindRecord, Observation } from "../exploration";
export const streamReplySchema = z
  .object({
    mode: z.enum(["continue", "complete", "close", "safety", "refusal"]),
    safety: z.enum(["normal", "check", "emergency", "violence"]),
    sentences: z.array(z.string().min(1).max(1200)).min(1).max(6),
  })
  .strict();
export type StreamReply = z.infer<typeof streamReplySchema> & {
  diaryDraft?: string;
  sourceQuote?: string;
};
export const reflectionReadiness = z
  .object({
    wish: z.string().max(200),
    meaning: z.string().max(200),
    confirmedMeaning: z.string().max(200),
    reaction: z.string().max(200),
    insight: z.string().max(200),
    next: z.enum([
      "thought",
      "fact",
      "wish",
      "meaning",
      "similar",
      "reaction",
      "perspective",
      "continue",
      "diary",
    ]),
  })
  .strict();
type Readiness = z.infer<typeof reflectionReadiness>;
export type StreamContext = {
  emotion: ReturnType<typeof selectionContext>;
  forceComplete: boolean;
  listening: boolean;
  skipDiary?: boolean;
  followupQuestion?: boolean;
  openingQuestion?: boolean;
  recordCorrection?: boolean;
  manualSummary?: boolean;
  clarifyQuestion?: boolean;
  asksForPracticalHelp?: boolean;
  reflectionStep?: Readiness["next"];
  diaryEvidence?: Pick<Readiness, "wish" | "meaning" | "confirmedMeaning" | "reaction" | "insight">;
  diaryFeedback?: "surface" | "unsupported";
  repairSummarySpeaker?: boolean;
  rejectedMeaning?: boolean;
  retryConversation?: boolean;
  guided?: GuidedPrompt;
  turn: number;
  previousSafety: Safety;
};
export interface StreamingProvider {
  accountResponses?(charge: () => Promise<void>): void;
  reviewExploration(messages: Message[], evidence: GuidedEvidence): Promise<Observation>;
  generateMindRecord(
    messages: Message[],
    evidence: GuidedEvidence,
    retry: boolean,
  ): Promise<MindRecord>;
  reviewMindRecord(
    messages: Message[],
    evidence: GuidedEvidence,
    record: MindRecord,
  ): Promise<boolean>;
  reviewReadiness(messages: Message[]): Promise<Readiness>;
  reviewDiary(
    messages: Message[],
    evidence: NonNullable<StreamContext["diaryEvidence"]>,
    draft: string,
  ): Promise<"grounded" | "surface" | "unsupported">;
  moderateOutputs(texts: string[]): Promise<boolean[]>;
  checkAttribution: Parameters<typeof preserveAttribution>[2];
  moderate(text: string): Promise<{ flagged: boolean; categories: unknown }>;
  classify(
    messages: Message[],
    signals: unknown,
    previous: Safety,
  ): Promise<{
    safety: Safety;
    harmfulRequest: boolean;
    noQuestions: boolean;
    safetyResolved?: boolean;
  }>;
  streamReply(
    messages: Message[],
    context: StreamContext,
    onSentence: (text: string, header: { mode: string; safety: string }) => Promise<void>,
    onFirstText?: () => void,
  ): Promise<StreamReply>;
}
function unreadableReply(reply: StreamReply) {
  const fields = [...reply.sentences, ...(reply.diaryDraft ? [reply.diaryDraft] : [])];
  return (
    hasOutputInstructions(fields.join(" ")) ||
    fields.some(
      (text) =>
        !/[가-힣]/.test(text) ||
        /[\u0000-\u0008\u000e-\u001f]|assistant to=|brief_reply|output valid JSON/i.test(text),
    )
  );
}
const rejectsProposedMeaning =
  /그(?:런)?\s*(?:뜻|의미|느낌|해석)(?:이|은|는)?\s*아니|그렇(?:지\s*않|진\s*않)|그(?:보다는|것보다는)/;
function affirmsMeaning(text: string) {
  return (
    /^(?:응|네|맞아(?:요)?|맞습니다|맞네요|그게 맞아요|그렇(?:죠|습니다|네요)|그런 것 같아요|그게 중요했어요)(?:[\s.,!?。！？]|$)/.test(
      text.trim(),
    ) &&
    !rejectsProposedMeaning.test(text) &&
    !/아니(?:에요|예요|요)|(?:그런|그|그게|그건)\s*(?:뜻이?\s*)?(?:아니|아닌)|맞긴|틀렸/.test(text)
  );
}
export async function runStreamingChat(
  args: {
    sid: string;
    cid: string;
    rid: string;
    messageId?: string;
    revision: number;
    safety: Safety;
    progress: Progress;
    history: Message[];
    message: string;
    action: string;
    emotion: EmotionSelection;
    guided?: boolean;
    sessionUsage?: boolean;
    control?: ExplorationControl;
  },
  gate: Gate,
  ai: StreamingProvider,
  onText: (delta: string) => void,
) {
  if (args.action === "continue" && !args.progress.completed)
    throw new AppError(409, "PROGRESS", "현재 대화를 먼저 마무리해 주세요.");
  if (args.progress.completed && args.action !== "continue" && args.safety === "normal")
    throw new AppError(
      409,
      "COMPLETED",
      "이번 정리는 마쳤어요. 이어서 이야기하기를 선택해 주세요.",
    );
  const messageId = args.messageId || args.rid;
  if (args.progress.messageIds?.includes(messageId))
    throw new AppError(
      409,
      "MESSAGE_DUPLICATE",
      "이미 반영한 메시지예요. 새 이야기를 적어 주세요.",
    );
  const started = performance.now();
  const emotion = correctedSelection(args.emotion, args.message),
    plan = responsePlan(args.progress, args.action, args.message, args.history);
  const slot =
    args.guided && args.sessionUsage
      ? await gate.enterGuided(args.sid, args.cid, args.rid, args.revision, plan.forceComplete)
      : await gate.enter(args.sid, args.cid, args.rid, args.revision);
  const directAccounting = Boolean(args.guided && args.sessionUsage && ai.accountResponses);
  if (directAccounting) ai.accountResponses?.(slot.extra);
  const allowance = directAccounting ? { extra: async () => {} } : slot;
  const turns = plan.current.turns + (args.action === "summary" || args.control ? 0 : 1);
  const messages: Message[] = [...args.history, { role: "user", content: args.message }];
  const recordRequested = args.action === "summary" || plan.recordStory !== null;
  const recordInput: Message[] =
    args.action === "summary"
      ? args.history
      : plan.recordStory === null
        ? messages
        : plan.recordStory
          ? [...args.history, { role: "user", content: plan.recordStory }]
          : args.history;
  const userStory = recordInput
    .filter((message) => message.role === "user")
    .map((message) => message.content.replace(/\s/g, ""));
  const directEmotions = args.guided
    ? emotionItems(emotion)
        .filter((item) => item.emotionId === "custom")
        .map((item) => item.customLabel)
    : [];
  const safetyHistory: Message[] = args.guided
    ? [
        ...directEmotions.map((content) => ({ role: "user" as const, content })),
        ...messages.slice(-12),
      ]
    : messages;
  let safety = retainRisk(args.safety, urgent([args.message, ...directEmotions].join("\n"))),
    body = "",
    diaryDraft: string | null = null,
    committed = false,
    questions = 0,
    mode = "continue",
    firstMs: number | undefined;
  let exploration = !args.guided ? undefined : args.progress.exploration;
  let explorationView: ExplorationView | undefined;
  const admissionMs = performance.now() - started;
  let modelFirstTextMs: number | undefined;
  let generationStartedMs: number | undefined;
  let generationMs = 0,
    modelFirstMs: number | undefined,
    outputCheckMs = 0;
  const publish = (text: string) => {
    if (firstMs === undefined) firstMs = performance.now() - started;
    const delta = (body ? " " : "") + text;
    body += delta;
    onText(delta);
  };
  try {
    if (safety === "normal" || safety === "check") {
      const checked = await ai.moderate(
        safetyHistory
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join("\n"),
      );
      // Contextual safety routing remains for flagged input and unresolved checks, not every ordinary turn.
      if (checked.flagged || safety === "check") {
        await allowance.extra();
        const route = await ai.classify(safetyHistory, checked.categories, safety);
        safety = retainRisk(
          safety,
          route.safety,
          route.safetyResolved === true && hasSafetyClarification(args.message),
        );
        if (route.harmfulRequest && safety === "normal") {
          publish(safetyText.refusal);
          mode = "refusal";
        }
      }
    }
    if (safety !== "normal") {
      publish(safetyReply(args.safety, safety));
      mode = "safety";
    } else if (!body && args.guided) {
      const start = performance.now();
      const outcome = await runGuidedTurn({
        ai,
        slot: allowance,
        history: args.history,
        latest: args.message,
        plan,
        emotion,
        previous: exploration,
        control: args.control,
        restart: args.action === "continue",
        turns,
      });
      exploration = outcome.state;
      explorationView = outcome.view;
      safety = outcome.safety;
      questions = outcome.questions;
      generationMs = performance.now() - start;
      publish(outcome.body);
    } else if (!body) {
      const genStart = performance.now();
      generationStartedMs = genStart - started;
      let suppressed = false;
      const received: string[] = [];
      const outputFlags = new Map<string, boolean>();
      const flagged = async (text: string) => {
        const known = outputFlags.get(text);
        if (known !== undefined) return known;
        const start = performance.now();
        const check = await ai.moderate(text);
        outputCheckMs += performance.now() - start;
        return check.flagged;
      };
      let reflectionStep: Readiness["next"] | undefined;
      let diaryEvidence: StreamContext["diaryEvidence"];
      let diaryFeedback: StreamContext["diaryFeedback"];
      let repairSummarySpeaker = false;
      const segment = recordInput.slice(-(plan.current.turns * 2 + 1));
      const lastUserIndex = segment.findLastIndex((message) => message.role === "user");
      const lastUser = segment[lastUserIndex];
      const preceding = segment[lastUserIndex - 1];
      const lastQuestion =
        preceding?.role === "assistant"
          ? Array.from(sentenceBoundaries.segment(preceding.content)).at(-1)?.segment.trim() || ""
          : "";
      const confirmedReply =
        lastUser?.role === "user" &&
        /[?？]$/.test(lastQuestion) &&
        affirmsMeaning(lastUser.content);
      const rejectedMeaning =
        /[?？]$/.test(lastQuestion) && rejectsProposedMeaning.test(args.message);
      const reviewWorkIntroduction =
        plan.workReflection &&
        plan.followupQuestion &&
        !plan.clarifyQuestion &&
        !plan.skipDiary &&
        plan.current.turns === 1;
      const reviewRequestedRecord =
        recordRequested && !plan.skipDiary && !plan.recordCorrection && segment.length > 0;
      if (
        plan.mayReflect ||
        reviewWorkIntroduction ||
        reviewRequestedRecord ||
        (plan.followupQuestion && plan.current.turns === 1 && confirmedReply)
      ) {
        await allowance.extra();
        const review = await ai.reviewReadiness(segment);
        const userWords = segment
          .filter((m) => m.role === "user")
          .map((m) => m.content.replace(/\s+/g, ""));
        const [wish, meaning, suggestedReaction] = [
          review.wish,
          review.meaning,
          review.reaction,
        ].map((quote) => quote.replace(/\s+/g, ""));
        const latestWords = userWords.at(-1) ?? "";
        // A model may prefix a short answer with its question. Keep only the literal answer.
        const reaction =
          latestWords.length >= 4 && suggestedReaction.endsWith(latestWords)
            ? latestWords
            : suggestedReaction;
        const grounded = (q: string) => q.length >= 2 && userWords.some((s) => s.includes(q));
        const hasMeaning =
          grounded(meaning) &&
          (!grounded(wish) || (!wish.includes(meaning) && !meaning.includes(wish)));
        const proposed = review.confirmedMeaning.trim();
        let confirmedMeaning = "";
        if (confirmedReply && !/아니면|둘\s*중|어느\s*쪽/.test(lastQuestion)) {
          if (
            proposed.length >= 7 &&
            lastQuestion.replace(/\s+/g, "").includes(proposed.replace(/\s+/g, ""))
          )
            confirmedMeaning = proposed;
          else if (
            lastQuestion.length <= 200 &&
            /안심이\s*(?:들었을까요|들었겠어요|필요했을까요|필요했던\s*걸까요)[?？]$/.test(
              lastQuestion,
            )
          )
            confirmedMeaning = lastQuestion;
        }
        const hasReaction =
          grounded(reaction) &&
          reaction !== wish &&
          !/^(?:(?:네|응|맞아|그래요|가끔|종종|자주|전에도|몇번|가끔씩)(?:있었(?:어요|어)|그래요|있어요)?)[.!。]*$/.test(
            reaction,
          );
        reflectionStep = review.next;
        const latest = args.message;
        if (
          reflectionStep === "thought" &&
          grounded(reaction) &&
          /(?:것|거)\s*같|해야\s*한다|해야\s*(?:할|돼)|라고\s*생각|일까\s*봐/.test(reaction)
        ) {
          reflectionStep = /(?:것|거)\s*같|일까\s*봐/.test(reaction) ? "fact" : "meaning";
        }
        if (
          reflectionStep === "similar" &&
          (/(?:종종|가끔|자주|전에도|예전에도|항상|그럴\s*때마다)/.test(latest) ||
            segment.some(
              (m) =>
                m.role === "assistant" &&
                /(?:비슷한|이런|그런).{0,22}(?:전에도|예전에도|적이)|(?:전에도|예전에도).{0,22}(?:있었|경험)/.test(
                  m.content,
                ),
            ))
        )
          reflectionStep = hasReaction ? "perspective" : "reaction";
        if (reflectionStep === "meaning" && hasMeaning)
          reflectionStep = hasReaction ? "perspective" : "reaction";
        const insight = review.insight.replace(/\s+/g, "");
        const voicedInsight =
          latestWords.endsWith(insight) && /(?:구나|알겠어요|알게됐어요)[.。!]*$/.test(insight);
        const hasInsight =
          insight.length >= 7 &&
          grounded(insight) &&
          (voicedInsight ||
            (hasMeaning && insight === meaning) ||
            [wish, meaning, reaction].some((quote) => grounded(quote) && insight !== quote));
        if (
          plan.workReflection &&
          !hasInsight &&
          !hasMeaning &&
          !confirmedMeaning &&
          /면.{0,36}(?:걸까\s*봐|될까\s*봐|(?:것|거)\s*같|라고\s*생각)|일까\s*봐/.test(latest) &&
          !/실제로|직접.{0,14}(?:말|들)|아무도|분명히.{0,10}했/.test(latest)
        )
          reflectionStep = "fact";
        if (
          (plan.mayReflect || reviewRequestedRecord || (confirmedReply && plan.followupQuestion)) &&
          (confirmedMeaning ||
            (review.next === "diary" && (hasInsight || hasMeaning)) ||
            (voicedInsight && hasInsight))
        ) {
          reflectionStep = "diary";
          diaryEvidence = {
            wish: grounded(wish) ? review.wish : "",
            meaning: hasMeaning && !confirmedMeaning ? review.meaning : "",
            confirmedMeaning,
            reaction: hasReaction
              ? reaction === latestWords
                ? args.message
                : review.reaction
              : "",
            insight: hasInsight ? review.insight : "",
          };
        } else if (reflectionStep === "diary" || (grounded(wish) && !hasMeaning && !hasInsight))
          reflectionStep = grounded(wish) ? "meaning" : "wish";
      }
      const finish = plan.forceComplete || reflectionStep === "diary";
      const emotionContext = selectionContext(emotion);
      const losesSpeaker = (reply: StreamReply) =>
        ((reply.mode === "continue" &&
          plan.openingQuestion &&
          emotionContext.category === "positive") ||
          (recordRequested && (reply.mode === "complete" || reply.mode === "close"))) &&
        reply.sentences.some((sentence) =>
          /(?:^|[^가-힣])(?:제가|내가|저는|나는|제|내)\s/.test(
            sentence
              .replace(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/g, "")
              .replace(
                /(?:^|(?<=[.。]\s))제가\s+(?:(?:앞서|아까|방금)\s+[^?？.。]{0,45}?)?잘못\s*(?:이해했어요|짚었어요|말했어요|이해했습니다)[.。]/g,
                "",
              ),
          ),
        );
      const generate = (retrying: boolean) =>
        ai.streamReply(
          messages,
          {
            emotion: emotionContext,
            forceComplete: finish,
            reflectionStep,
            diaryEvidence,
            diaryFeedback,
            ...(repairSummarySpeaker ? { repairSummarySpeaker: true } : {}),
            ...(rejectedMeaning ? { rejectedMeaning: true } : {}),
            ...(retrying && !finish && plan.followupQuestion ? { retryConversation: true } : {}),
            listening: plan.listening,
            skipDiary: plan.skipDiary,
            followupQuestion: plan.followupQuestion,
            openingQuestion: plan.openingQuestion,
            recordCorrection: plan.recordCorrection,
            ...(recordRequested && !plan.recordCorrection ? { manualSummary: true } : {}),
            clarifyQuestion: plan.clarifyQuestion,
            asksForPracticalHelp: plan.asksForPracticalHelp,
            turn: plan.current.turns + 1,
            previousSafety: safety,
          },
          async (sentence, header) => {
            received.push(sentence);
            if (modelFirstMs === undefined) modelFirstMs = performance.now() - started;
            const h = streamReplySchema.pick({ mode: true, safety: true }).parse(header);
            if (mode !== "continue" && h.mode !== mode)
              throw new AppError(502, "STREAM_FORMAT", "답변 상태를 확인하지 못했어요.");
            mode = h.mode;
            safety = retainRisk(safety, h.safety);
            if (safety !== "normal" || h.mode === "safety") {
              if (!suppressed) {
                publish(safetyReply(args.safety, safety === "normal" ? "check" : safety));
                safety = safety === "normal" ? "check" : safety;
              }
              suppressed = true;
              return;
            }
            if (h.mode === "refusal") {
              if (!suppressed) publish(safetyText.refusal);
              suppressed = true;
            }
          },
          () => {
            modelFirstTextMs = performance.now() - started;
          },
        );
      const prepareReply = async (retrying = false) => {
        const generationStarted = performance.now();
        let result = await generate(retrying);
        generationMs += performance.now() - generationStarted;
        if (suppressed) return result;
        if (unreadableReply(result) || (result.mode === "continue" && losesSpeaker(result)))
          throw new AppError(502, "FORMAT", "답변을 읽을 수 없어요. 입력은 그대로 남아 있어요.");
        if (
          mode !== result.mode ||
          received.length !== result.sentences.length ||
          received.some((sentence, i) => sentence.trim() !== result.sentences[i].trim())
        )
          throw new AppError(502, "STREAM_FORMAT", "답변 내용을 확인하지 못했어요.");
        if (!finish && (result.mode === "complete" || result.mode === "close"))
          throw new AppError(
            502,
            "MODE",
            "대화를 이어갈 답변을 받지 못했어요. 다시 요청해 주세요.",
          );
        if (finish && result.mode === "continue")
          throw new AppError(502, "MODE", "정리 상태를 확인하지 못했어요. 다시 요청해 주세요.");
        if (
          result.mode === "continue" &&
          /싶(?:어(?:요)?|습니다|다)[.。!\s]*$/.test(args.message) &&
          result.sentences.some((sentence) =>
            /기로\s*(?:하신|하셨|했다|결정하셨)|결심하셨/.test(sentence),
          ) &&
          !userStory.some((story) => /기로(?:했|결정|하겠)|결심했/.test(story))
        )
          throw new AppError(
            502,
            "ATTRIBUTION",
            "사용자가 바란 일과 정한 일을 확인하지 못했어요. 다시 요청해 주세요.",
          );
        if (
          result.mode === "continue" &&
          result.sentences.some((sentence) =>
            /오늘\s*(?:의\s*)?(?:다이어리|일기)(?:에는|에)|(?:다이어리|일기)에.{0,70}(?:남겨|적어|써)\s*(?:볼|보세요|보셔도)/.test(
              sentence,
            ),
          )
        ) {
          if (!retrying || plan.openingQuestion || plan.clarifyQuestion)
            throw new AppError(
              502,
              "QUESTION",
              "대화를 이어갈 답변을 받지 못했어요. 다시 요청해 주세요.",
            );
          result = {
            ...result,
            sentences: ["더 이야기하고 싶은 부분이 있으면 편한 만큼 이어서 말씀하셔도 괜찮아요."],
          };
        }
        const clarificationNote =
          plan.assumedReply && result.mode === "continue"
            ? "기대한 대답이 있었던 것처럼 제가 물었네요."
            : null;
        if (clarificationNote) {
          const question = result.sentences.at(-1) || "";
          // Keep a scene-specific question when it refers to what happened. If it still
          // assumes an unexpressed wish, ask about the exchange without assigning a wish.
          const repeatsAssumption =
            /바랐|바라|바라는|기대|원했|해주길|해줬으면|해줄\s*것|듣고\s*싶|했으면|말하고\s*싶/.test(
              question,
            );
          result = {
            ...result,
            sentences: [repeatsAssumption ? "그 말을 들은 뒤에 대화가 더 이어졌어요?" : question],
          };
        }
        if (
          plan.briefDisappointment &&
          result.mode === "continue" &&
          result.sentences.some((sentence) =>
            /기대하|기대했|기대해|기대가|기다리던|손꼽아/.test(sentence),
          ) &&
          !messages.some(
            (message) =>
              message.role === "user" &&
              /기대|기다렸|기다리고|바랐|보고\s*싶/.test(message.content),
          )
        ) {
          result = { ...result, sentences: ["그 일이 조금 마음에 남았군요."] };
        }
        if (
          result.mode === "continue" &&
          (plan.openingQuestion || plan.clarifyQuestion) &&
          !selectSentences(result.sentences.at(-1) ?? "", true, false, new Set()).asked
        )
          throw new AppError(
            502,
            "QUESTION",
            "다음 질문을 끝까지 받지 못했어요. 같은 입력으로 다시 요청할 수 있어요.",
          );
        if (result.diaryDraft) {
          const ownInsight = diaryEvidence?.insight
            ? Array.from(sentenceBoundaries.segment(diaryEvidence.insight), (part) =>
                part.segment.trim(),
              ).at(-1)
            : undefined;
          // If the user already voiced the discovery as a diary sentence, keep their wording.
          const draft =
            ownInsight && ownInsight.length <= 220 && /^[^?？!"“”\n]+구나[.。]?$/.test(ownInsight)
              ? ownInsight
              : result.diaryDraft;
          const diaryDraft = draft.replace(
            /(^|\s)([가-힣]{2,10}(?:이|가|은|는|을|를))\s+\2(?=\s|[,.!?。]|$)/g,
            "$1$2",
          );
          result = { ...result, diaryDraft };
          if (result.mode === "complete" && !plan.skipDiary) {
            const quotes = [
              result.sourceQuote,
              diaryEvidence?.insight,
              diaryEvidence?.reaction,
              diaryEvidence?.wish,
              diaryEvidence?.confirmedMeaning ? lastUser?.content : null,
              plan.recordCorrection ? plan.recordStory : null,
            ];
            const hasSource = quotes.some((quote) => {
              const words = quote?.replace(/\s/g, "");
              return words && userStory.some((story) => story.includes(words));
            });
            if (!hasSource)
              throw new AppError(
                502,
                "DRAFT_SOURCE",
                "기록에 담을 표현을 확인하지 못했어요. 다시 요청해 주세요.",
              );
          }
        }
        const question = result.sentences.at(-1) ?? "";
        if (
          rejectedMeaning &&
          result.mode === "continue" &&
          /(?:그렇게\s*제안한|그\s*(?:뜻|해석|마음|의미)|방금.{0,7}(?:해석|제안)).{0,28}(?:맞나요|맞을까요|있었을까요)/.test(
            question,
          )
        )
          throw new AppError(
            502,
            "QUESTION",
            "이어서 나눌 질문을 확인하지 못했어요. 다시 요청해 주세요.",
          );
        if (
          reflectionStep === "meaning" &&
          result.mode === "continue" &&
          /어느\s*쪽|둘\s*중|그\s*중.{0,20}가까[운워]/.test(question)
        )
          throw new AppError(
            502,
            "QUESTION",
            "지금 이야기와 이어지는 질문을 받지 못했어요. 다시 요청해 주세요.",
          );
        if (
          plan.workReflection &&
          result.mode === "continue" &&
          !plan.listening &&
          /[?？]$/.test(question) &&
          /(?:프로젝트|업무|작업|일정|마감|진행률|보고서|일을).{0,30}(?:어디까지|몇\s*(?:퍼센트|%|개)|어느\s*단계|언제까지|완료|끝내[야려]|얼마나\s*(?:남|진행)|우선순위)|(?:어떤|어느)\s*(?:부분|단계|작업|기능).{0,16}(?:막혔|안\s*(?:됐|되)|완료|남았)|(?:마감|기한)(?:이|은|는)?\s*(?:언제|며칠)/.test(
            question,
          ) &&
          !/기분|느낌|생각|마음|버겁|부담|긴장|압박|쉬고|걱정/.test(question)
        ) {
          throw new AppError(
            502,
            "QUESTION",
            "지금 이야기와 이어지는 질문을 받지 못했어요. 입력은 그대로 남아 있어요.",
          );
        }
        const reviewStart = performance.now();
        // Review cumulative text and the diary in one request. A subsequent edit or
        // filter changes the cache key, so only the exact reviewed text can be reused.
        const visible = clarificationNote
          ? [clarificationNote, ...result.sentences]
          : result.sentences;
        const candidates = visible.map((_, i) => visible.slice(0, i + 1).join(" "));
        const draft = result.diaryDraft;
        if (draft) candidates.push(draft);
        const evidence = diaryEvidence;
        // A discovery can use a confirmed interpretation. Review its facts and meaning together.
        const [attributed, flags, verdict] = await Promise.all([
          preserveAttribution(
            messages,
            evidence ? { ...result, diaryDraft: undefined } : result,
            async (statements, fields, diaryIndex, verify) => {
              await allowance.extra();
              return ai.checkAttribution(statements, fields, diaryIndex, verify);
            },
          ),
          ai.moderateOutputs(candidates),
          evidence && draft
            ? allowance.extra().then(() => ai.reviewDiary(segment, evidence, draft))
            : ("grounded" as const),
        ]);
        let verified = evidence ? { ...attributed, diaryDraft: draft } : attributed;
        const speakerChanged = losesSpeaker(verified);
        if (unreadableReply(verified))
          throw new AppError(502, "FORMAT", "답변을 읽을 수 없어요. 입력은 그대로 남아 있어요.");
        if (speakerChanged) {
          if (retrying && verified.mode === "complete" && verified.diaryDraft) {
            // The diary is checked separately. A faulty summary must not discard a valid record.
            verified = { ...verified, sentences: ["말씀하신 내용으로 한 줄을 정리했어요."] };
          } else {
            repairSummarySpeaker = recordRequested;
            throw new AppError(502, "FORMAT", "답변을 읽을 수 없어요. 입력은 그대로 남아 있어요.");
          }
        }
        if (verdict !== "grounded") {
          diaryFeedback = verdict;
          throw new AppError(
            502,
            "DRAFT_MEANING",
            "기록에 담을 마음을 확인하지 못했어요. 다시 요청해 주세요.",
          );
        }
        // The acknowledgement describes our previous question, not an actor in the user's story.
        result = clarificationNote
          ? { ...verified, sentences: [clarificationNote, ...verified.sentences] }
          : verified;
        candidates.forEach((text, i) => outputFlags.set(text, flags[i]));
        outputCheckMs += performance.now() - reviewStart;
        return result;
      };
      let result: StreamReply;
      try {
        result = await prepareReply();
      } catch (error) {
        // A draft that failed validation has not reached the browser.
        if (
          suppressed ||
          !(error instanceof AppError) ||
          !["FORMAT", "ATTRIBUTION", "QUESTION", "DRAFT_SOURCE", "DRAFT_MEANING"].includes(
            error.code,
          )
        )
          throw error;
        await allowance.extra();
        received.length = 0;
        mode = "continue";
        result = await prepareReply(true);
      }
      if (
        result.mode === "complete" &&
        !plan.skipDiary &&
        safety === "normal" &&
        result.diaryDraft
      ) {
        if (await flagged(result.diaryDraft))
          throw new AppError(502, "OUTPUT_SAFETY", "기록 초안을 확인하지 못했어요.");
        diaryDraft = result.diaryDraft;
      }
      if (!suppressed) {
        const displayed = new Set<string>();
        for (let sentence of result.sentences) {
          const selected = selectSentences(
            sentence,
            result.mode === "continue" &&
              !plan.listening &&
              questions === 0 &&
              (!(plan.openingQuestion || plan.followupQuestion) ||
                sentence === result.sentences.at(-1)),
            result.mode === "complete",
            displayed,
          );
          if (!selected.text) continue;
          sentence = selected.text;
          if (selected.asked) questions++;
          if (
            /(?:당신은|당신이|사용자는).{0,20}(?:우울증|망상장애|성격장애)(?:입니다|이에요|예요)|(?:복용량|용량).{0,12}(?:늘리|줄이|증량|중단)|(?:자살|자해).{0,12}(?:방법은|하려면)/.test(
              sentence,
            )
          )
            throw new AppError(
              502,
              "OUTPUT_SAFETY",
              "답변의 안전을 확인하지 못했어요. 다시 요청할 수 있어요.",
            );
          if (
            result.mode === "complete" &&
            /(?:알려|말씀해).{0,8}(?:주면|주시면|주세요|주실|줄래)/.test(sentence)
          )
            throw new AppError(
              502,
              "QUESTION",
              "추가 답변을 요구하지 않는 정리를 완성하지 못했어요. 다시 요청할 수 있어요.",
            );
          if (await flagged((body ? body + " " : "") + sentence))
            throw new AppError(
              502,
              "OUTPUT_SAFETY",
              "답변의 안전을 확인하지 못했어요. 도움 받기를 이용할 수 있어요.",
            );
          publish(sentence);
        }
      }
      mode = result.mode;
      if (!body && mode === "continue" && plan.listening && safety === "normal")
        publish("편한 만큼 이어서 말씀해 주세요.");
      if (!body && !(mode === "complete" && result.diaryDraft))
        throw new AppError(
          502,
          "EMPTY",
          mode === "complete" || mode === "close"
            ? "질문 없는 정리를 완성하지 못했어요. 다시 요청할 수 있어요."
            : "표시할 답변을 받지 못했어요. 입력은 그대로 남아 있어요.",
        );
      if (
        (plan.openingQuestion || plan.clarifyQuestion) &&
        mode === "continue" &&
        safety === "normal" &&
        questions === 0
      )
        throw new AppError(
          502,
          "QUESTION",
          "다음 질문을 끝까지 받지 못했어요. 같은 입력으로 다시 요청할 수 있어요.",
        );
      if (diaryDraft && !body) publish(diaryDraft);
    }
    const progress: Progress =
      safety !== "normal"
        ? { ...plan.current, completed: false }
        : {
            turns,
            questions: plan.current.questions + questions,
            completed: args.guided
              ? Boolean(explorationView?.userRequestedCompletion)
              : (plan.forceComplete && (mode === "complete" || mode === "close")) ||
                Boolean(diaryDraft),
          };
    if (exploration) progress.exploration = exploration;
    const surveyReady =
      progress.completed &&
      safety === "normal" &&
      (!args.guided || Boolean(explorationView?.finalRecord));
    if (diaryDraft && safety === "normal") publish("\n\n" + DIARY_INVITATION);
    progress.messageIds = [...(args.progress.messageIds || []), messageId].slice(-40);
    if (!body) throw new AppError(502, "EMPTY", "답변을 완성하지 못했어요.");
    await slot.stage(args.revision + 1);
    committed = true;
    return {
      body,
      surveyReady,
      explorationView,
      diaryDraft,
      history: [...messages, { role: "assistant" as const, content: body }],
      safety,
      progress,
      emotion,
      revision: args.revision + 1,
      timing: {
        admissionMs,
        firstTextMs: firstMs,
        modelFirstTextMs,
        modelFirstSentenceMs: modelFirstMs,
        generationStartedMs,
        generationMs,
        outputCheckMs,
        totalMs: performance.now() - started,
      },
    };
  } finally {
    if (!committed) await slot.finish().catch(() => {});
  }
}
