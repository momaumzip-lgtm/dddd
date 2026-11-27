import { z } from "zod";
import { GUIDED_HISTORY_MESSAGES } from "./config";

export const stages = [
  "CONTEXT_EXPLORATION",
  "EMOTION_IDENTIFICATION",
  "AUTOMATIC_THOUGHT",
  "PERSONAL_MEANING",
  "UNDERLYING_NEED",
  "NEED_VALIDATION",
  "REFRAMING",
  "REFLECTION",
  "RECORD_GENERATION",
  "SURVEY",
  "COMPLETED",
] as const;
export const stageSchema = z.enum(stages);
export type ConversationStage = z.infer<typeof stageSchema>;
export const stageLabels: Record<ConversationStage, string> = {
  CONTEXT_EXPLORATION: "장면을 떠올려요",
  EMOTION_IDENTIFICATION: "감정을 살펴봐요",
  AUTOMATIC_THOUGHT: "그때 스친 생각을 살펴봐요",
  PERSONAL_MEANING: "마음에 남은 이유를 살펴봐요",
  UNDERLYING_NEED: "그때 바랐던 것을 찾고 있어요",
  NEED_VALIDATION: "어떤 마음이 가까운지 살펴봐요",
  REFRAMING: "다른 시선으로 나를 바라봐요",
  REFLECTION: "발견한 마음을 돌아봐요",
  RECORD_GENERATION: "마음을 기록해요",
  SURVEY: "오늘의 기록",
  COMPLETED: "이야기를 마쳤어요",
};

export const controlText = {
  explore: "이 마음을 조금 더 들여다보고 싶어요.",
  skip: "방금 질문은 건너뛰고 싶어요.",
  unsure: "잘 모르겠어요.",
  more: "지금은 정리하지 말고 조금 더 이야기하고 싶어요.",
  record: "지금까지 이야기한 내용으로 마음 기록을 완성해 주세요.",
  end: "오늘은 여기까지 이야기하고 지금까지의 마음을 기록하고 싶어요.",
} as const;
export const controlSchema = z.enum(["explore", "skip", "unsure", "more", "record", "end"]);
export type ExplorationControl = z.infer<typeof controlSchema>;
export const isControlText = (text: string) =>
  Object.values(controlText).some((line) => line === text);

const excerpt = z.string().trim().max(160);
// Model observations are proposals. The server resolves each excerpt against the signed transcript.
export const observationSchema = z
  .object({
    newTopic: z.boolean(),
    situation: excerpt,
    emotions: z.array(excerpt).max(3),
    estimatedIntensity: z.enum(["low", "medium", "high", "veryHigh", "unknown"]),
    thought: excerpt,
    meaning: excerpt,
    wish: excerpt,
    need: excerpt,
    needBasis: excerpt,
    confirmedNeed: excerpt,
    rejected: z.boolean(),
    insight: excerpt,
    reframe: excerpt,
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;

// Token claims contain pointers only. A pointer can be resolved only against the signed history.
const pointer = z.tuple([
  z.number().int().min(0).max(GUIDED_HISTORY_MESSAGES),
  z.number().int().min(0).max(4000),
  z.number().int().min(1).max(160),
]);
export type EvidencePointer = z.infer<typeof pointer>;
export const explorationSchema = z
  .object({
    stage: stageSchema,
    start: z.number().int().min(0).max(GUIDED_HISTORY_MESSAGES),
    situation: pointer.optional(),
    emotions: z.array(pointer).max(3).optional(),
    thought: pointer.optional(),
    meaning: pointer.optional(),
    wish: pointer.optional(),
    pending: z
      .object({ question: pointer, basis: pointer, need: pointer.optional() })
      .strict()
      .optional(),
    confirmed: z
      .array(z.object({ quote: pointer, answer: pointer.optional() }).strict())
      .max(3)
      .optional(),
    rejected: z.array(pointer).max(3).optional(),
    insight: pointer.optional(),
    reframe: pointer.optional(),
    skipped: z.array(stageSchema).max(8).optional(),
    estimatedIntensity: observationSchema.shape.estimatedIntensity.optional(),
    initialEmotionId: z.string().max(16).optional(),
    selectionVersion: z.number().int().min(0).max(10000).optional(),
    deferred: z.boolean().optional(),
  })
  .strict();
export type Exploration = z.infer<typeof explorationSchema>;

export const mindRecordSchema = z
  .object({
    situation: z.string().trim().max(240),
    emotions: z.string().trim().max(240),
    meaning: z.string().trim().max(240),
    needs: z.array(z.string().trim().min(1).max(180)).max(3),
    connection: z.string().trim().max(320),
    discovery: z.string().trim().max(280),
    care: z.array(z.string().trim().min(1).max(180)).max(2),
    message: z.string().trim().max(240),
  })
  .strict();
export type MindRecord = z.infer<typeof mindRecordSchema>;

export const explorationViewSchema = z
  .object({
    conversationStage: stageSchema,
    userTurnCount: z.number().int().nonnegative(),
    readyToComplete: z.boolean(),
    offerRecord: z.boolean(),
    exploredTopics: z.array(stageSchema),
    detectedEmotions: z.array(z.string()).max(4),
    emotionIntensity: z.object({
      reported: z.number().int().min(0).max(100).nullable(),
      estimated: observationSchema.shape.estimatedIntensity,
    }),
    nextQuestion: z.string().max(300).nullable(),
    userRequestedCompletion: z.boolean(),
    completionReason: z.enum(["requested-early", "explored", "without-record"]).nullable(),
    finalRecord: mindRecordSchema.nullable(),
    surveyStatus: z.enum(["unavailable", "available", "submitted"]),
  })
  .strict();
export type ExplorationView = z.infer<typeof explorationViewSchema>;
