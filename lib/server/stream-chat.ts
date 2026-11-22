import { z } from "zod";
import type { Message } from "../config";
import { DIARY_INVITATION, freshProgress, responsePlan, type Progress } from "../conversation";
import { correctedSelection, selectionContext, type EmotionSelection } from "../emotions";
import { AppError } from "./errors";
import { preserveAttribution } from "./attribution";
import type { Gate } from "./limits";
import type { Safety } from "./schemas";
import { urgent, retainRisk, safetyReply, safetyText, hasSafetyClarification } from "./safety";
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
export type StreamContext = {
  emotion: ReturnType<typeof selectionContext>;
  forceComplete: boolean;
  listening: boolean;
  skipDiary?: boolean;
  followupQuestion?: boolean;
  openingQuestion?: boolean;
  turn: number;
  previousSafety: Safety;
};
export interface StreamingProvider {
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
const sentenceBoundaries = new Intl.Segmenter("ko", { granularity: "sentence" });
function selectSentences(text: string, allowQuestion: boolean, diarySummary: boolean) {
  const kept: string[] = [];
  let asked = false;
  for (const part of sentenceBoundaries.segment(text)) {
    const sentence = part.segment.trim();
    if (!sentence) continue;
    // The editor supplies its own invitation after the grounded summary.
    if (
      diarySummary &&
      /(?:다이어리|일기|기록|초안).{0,28}(?:남겨|적어|써|복사해|고쳐)\s*(?:보셔도|보세요|두세요|주세요)/.test(
        sentence,
      )
    )
      continue;
    const marks = sentence.match(/[?？؟﹖]/g)?.length ?? 0;
    const question =
      marks > 0 ||
      /(?:나요|인가요|한가요|떤가요|까요|습니까|어때요|주실래요|말씀해\s?주세요|말해\s?주세요|알려\s?주세요)[.。]*$/.test(
        sentence,
      );
    if (question) {
      if (
        !allowQuestion ||
        asked ||
        marks > 1 ||
        /그리고|또한|무엇.*어떻|어떤.*왜|인지.*인지/.test(sentence)
      )
        continue;
      asked = true;
    }
    kept.push(sentence);
  }
  return { text: kept.join(" "), asked };
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
  const slot = await gate.enter(args.sid, args.cid, args.rid, args.revision);
  const emotion = correctedSelection(args.emotion, args.message),
    plan = responsePlan(args.progress, args.action, args.message, args.history);
  const messages: Message[] = [...args.history, { role: "user", content: args.message }];
  let safety = retainRisk(args.safety, urgent(args.message)),
    body = "",
    diaryDraft: string | null = null,
    committed = false,
    questions = 0,
    mode = "continue",
    firstMs: number | undefined;
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
        messages
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join("\n"),
      );
      // Contextual safety routing remains for flagged input and unresolved checks, not every ordinary turn.
      if (checked.flagged || safety === "check") {
        await slot.extra();
        const route = await ai.classify(messages, checked.categories, safety);
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
      let result = await ai.streamReply(
        messages,
        {
          emotion: selectionContext(emotion),
          forceComplete: plan.forceComplete,
          listening: plan.listening,
          skipDiary: plan.skipDiary,
          followupQuestion: plan.followupQuestion,
          openingQuestion: plan.openingQuestion,
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
      generationMs = performance.now() - genStart;
      if (!suppressed) {
        if (
          mode !== result.mode ||
          received.length !== result.sentences.length ||
          received.some((sentence, i) => sentence.trim() !== result.sentences[i].trim())
        )
          throw new AppError(502, "STREAM_FORMAT", "답변 내용을 확인하지 못했어요.");
        if (!plan.forceComplete && (result.mode === "complete" || result.mode === "close"))
          throw new AppError(
            502,
            "MODE",
            "대화를 이어갈 답변을 받지 못했어요. 다시 요청해 주세요.",
          );
        if (plan.forceComplete && result.mode === "continue")
          throw new AppError(502, "MODE", "정리 상태를 확인하지 못했어요. 다시 요청해 주세요.");
        const reviewStart = performance.now();
        // Review cumulative text and the diary in one request. A subsequent edit or
        // filter changes the cache key, so only the exact reviewed text can be reused.
        const candidates = result.sentences.map((_, i) =>
          result.sentences.slice(0, i + 1).join(" "),
        );
        if (result.diaryDraft) candidates.push(result.diaryDraft);
        const [verified, flags] = await Promise.all([
          preserveAttribution(messages, result, async (statements, fields, diaryIndex, verify) => {
            await slot.extra();
            return ai.checkAttribution(statements, fields, diaryIndex, verify);
          }),
          ai.moderateOutputs(candidates),
        ]);
        result = verified;
        candidates.forEach((text, i) => outputFlags.set(text, flags[i]));
        outputCheckMs += performance.now() - reviewStart;
        for (let sentence of result.sentences) {
          const selected = selectSentences(
            sentence,
            result.mode === "continue" &&
              !plan.listening &&
              questions === 0 &&
              (!plan.openingQuestion || Boolean(body)),
            result.mode === "complete",
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
      if (!body && !(mode === "complete" && result.diaryDraft))
        throw new AppError(
          502,
          "EMPTY",
          mode === "complete" || mode === "close"
            ? "질문 없는 정리를 완성하지 못했어요. 다시 요청할 수 있어요."
            : "표시할 답변을 받지 못했어요. 입력은 그대로 남아 있어요.",
        );
      if (
        (plan.openingQuestion || plan.followupQuestion) &&
        mode === "continue" &&
        safety === "normal" &&
        questions === 0
      )
        throw new AppError(
          502,
          "QUESTION",
          "다음 질문을 끝까지 받지 못했어요. 같은 입력으로 다시 요청할 수 있어요.",
        );
      if (mode === "complete" && !plan.skipDiary && safety === "normal" && result.diaryDraft) {
        const quote = result.sourceQuote?.trim();
        if (!quote || !messages.some((m) => m.role === "user" && m.content.includes(quote)))
          throw new AppError(
            502,
            "DRAFT_SOURCE",
            "기록에 담을 표현을 확인하지 못했어요. 다시 요청해 주세요.",
          );
        if (await flagged(result.diaryDraft))
          throw new AppError(502, "OUTPUT_SAFETY", "기록 초안을 확인하지 못했어요.");
        diaryDraft = result.diaryDraft;
        if (!body) publish(diaryDraft);
      }
    }
    const progress: Progress =
      safety !== "normal"
        ? { ...plan.current, completed: false }
        : {
            turns: plan.current.turns + (args.action === "summary" ? 0 : 1),
            questions: plan.current.questions + questions,
            completed: plan.forceComplete && (mode === "complete" || mode === "close"),
          };
    const surveyReady = progress.completed && safety === "normal";
    if (diaryDraft && safety === "normal") publish("\n\n" + DIARY_INVITATION);
    progress.messageIds = [...(args.progress.messageIds || []), messageId];
    if (!body) throw new AppError(502, "EMPTY", "답변을 완성하지 못했어요.");
    await slot.stage(args.revision + 1);
    committed = true;
    return {
      body,
      surveyReady,
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
