import { z } from "zod";
export const SURVEY_VERSION = "experience-2026-11-18-v1";
export const surveyQuestions = [
  { key: "helpfulness", label: "감정과 생각을 정리하는 데 도움이 되었나요?" },
  { key: "ease", label: "화면과 대화 기능을 편하게 이용하셨나요?" },
  { key: "reuse", label: "필요할 때 다시 이용하고 싶으신가요?" },
] as const;
export const surveyScale = [
  "전혀 그렇지 않아요",
  "그렇지 않아요",
  "보통이에요",
  "그런 편이에요",
  "매우 그래요",
];
export const answersSchema = z
  .object({
    helpfulness: z.number().int().min(1).max(5),
    ease: z.number().int().min(1).max(5),
    reuse: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500),
  })
  .strict();
export const surveyRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    conversationId: z.string().uuid(),
    token: z.string().max(4096),
    version: z.literal(SURVEY_VERSION),
    consent: z.literal(true),
    answers: answersSchema,
  })
  .strict();
export type SurveyAnswers = z.infer<typeof answersSchema>;
export type SurveyConfig = { ready: boolean; recipient: string; retention: string };
