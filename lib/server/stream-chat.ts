import { z } from "zod";
import type { Message } from "../config";
import { freshProgress, responsePlan, type Progress } from "../conversation";
import { correctedSelection, selectionContext, type EmotionSelection } from "../emotions";
import { AppError } from "./errors";
import type { Gate } from "./limits";
import type { Safety } from "./schemas";
import { urgent, retainRisk, safetyReply, safetyText, hasSafetyClarification } from "./safety";
export const streamReplySchema = z
  .object({
    mode: z.enum(["continue", "complete", "safety", "refusal"]),
    safety: z.enum(["normal", "check", "emergency", "violence"]),
    sentences: z.array(z.string().min(1).max(1200)).min(1).max(6),
  })
  .strict();
export type StreamReply = z.infer<typeof streamReplySchema>;
export type StreamContext = {
  emotion: ReturnType<typeof selectionContext>;
  forceComplete: boolean;
  listening: boolean;
  remainingQuestions: number;
  turn: number;
  previousSafety: Safety;
};
export interface StreamingProvider {
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
  ): Promise<StreamReply>;
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
    committed = false,
    questions = 0,
    mode = "complete",
    firstMs: number | undefined;
  const admissionMs = performance.now() - started;
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
      let suppressed = false;
      const result = await ai.streamReply(
        messages,
        {
          emotion: selectionContext(emotion),
          forceComplete: plan.forceComplete,
          listening: plan.listening,
          remainingQuestions: plan.remainingQuestions,
          turn: plan.current.turns + 1,
          previousSafety: safety,
        },
        async (sentence, header) => {
          if (modelFirstMs === undefined) modelFirstMs = performance.now() - started;
          const h = streamReplySchema.pick({ mode: true, safety: true }).parse(header);
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
            return;
          }
          if (plan.forceComplete && h.mode !== "complete")
            throw new AppError(502, "MODE", "정리 상태를 확인하지 못했어요. 다시 요청해 주세요.");
          const isQuestion = /[?？]|(?:나요|까요|습니까|말해\s?주세요|알려\s?주세요)[.。]*$/.test(
            sentence,
          );
          if (isQuestion && (++questions > 1 || h.mode === "complete" || plan.forceComplete))
            throw new AppError(
              502,
              "QUESTION",
              "질문 없는 정리를 완성하지 못했어요. 다시 요청할 수 있어요.",
            );
          if (isQuestion && /그리고|또한|무엇.*어떻|어떤.*왜|인지.*인지/.test(sentence))
            throw new AppError(
              502,
              "QUESTION",
              "질문을 간단히 정리하지 못했어요. 다시 요청할 수 있어요.",
            );
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
          const checkStart = performance.now();
          const checked = await ai.moderate((body ? body + " " : "") + sentence);
          outputCheckMs += performance.now() - checkStart;
          if (checked.flagged)
            throw new AppError(
              502,
              "OUTPUT_SAFETY",
              "답변의 안전을 확인하지 못했어요. 도움 받기를 이용할 수 있어요.",
            );
          publish(sentence);
        },
      );
      generationMs = performance.now() - genStart;
      if (!suppressed && body !== result.sentences.join(" "))
        throw new AppError(502, "STREAM_FORMAT", "답변 내용을 확인하지 못했어요.");
      mode = result.mode;
    }
    const progress: Progress =
      safety !== "normal"
        ? { ...plan.current, completed: false }
        : {
            turns: plan.current.turns + (args.action === "summary" ? 0 : 1),
            questions: Math.min(2, plan.current.questions + questions),
            completed: mode !== "continue" || plan.forceComplete,
          };
    progress.messageIds = [...(args.progress.messageIds || []), messageId];
    if (!body) throw new AppError(502, "EMPTY", "답변을 완성하지 못했어요.");
    await slot.finish(args.revision + 1);
    committed = true;
    return {
      body,
      history: [...messages, { role: "assistant" as const, content: body }],
      safety,
      progress,
      emotion,
      revision: args.revision + 1,
      timing: {
        admissionMs,
        firstTextMs: firstMs,
        modelFirstSentenceMs: modelFirstMs,
        generationMs,
        outputCheckMs,
        totalMs: performance.now() - started,
      },
    };
  } finally {
    if (!committed) await slot.finish().catch(() => {});
  }
}
