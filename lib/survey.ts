import { z } from "zod";
export const SURVEY_VERSION = "experience-2026-11-21-v2";
export const entryRoutes = {
  online_link: "온라인 링크를 통해 접속했어요",
  qr: "QR코드를 찍고 접속했어요",
} as const;
const agree = [
  "전혀 그렇지 않아요",
  "그렇지 않은 편이에요",
  "보통이에요",
  "그런 편이에요",
  "매우 그래요",
];
const burden = [
  "전혀 부담되지 않았어요",
  "별로 부담되지 않았어요",
  "보통이에요",
  "부담됐어요",
  "매우 부담됐어요",
];
const ease = ["매우 불편했어요", "불편했어요", "보통이에요", "편리했어요", "매우 편리했어요"];
const pace = ["너무 짧고 아쉬웠어요", "딱 적당했어요", "조금 길고 피곤했어요"] as const;
const reuse = ["매일", "주 3~4회", "주 1~2회", "필요할 때 가끔", "다시 쓰지 않을 것 같다"] as const;
const judgment = ["있었다", "없었다"] as const;
const score = z
  .number()
  .int()
  .min(1)
  .max(5)
  .nullish()
  .transform((v) => v ?? null);
const note = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => v || null);
const surveyFields = z
  .object({
    entryRoute: z.enum(["online_link", "qr"]),
    selfUnderstanding: score,
    organizationHelpfulness: score,
    judgmentOrAwkwardness: z
      .enum(judgment)
      .nullish()
      .transform((v) => v ?? null),
    awkwardnessDetail: note,
    disclosureBurden: score,
    conversationPace: z
      .enum(pace)
      .nullish()
      .transform((v) => v ?? null),
    reuseFrequency: z
      .enum(reuse)
      .nullish()
      .transform((v) => v ?? null),
    recommendationIntent: score,
    improvementSuggestions: note,
    qrAccessEase: score,
    qrDiaryMotivation: score,
    qrFlowFeedback: note,
  })
  .strict();
export const answersSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const fields: Record<string, unknown> = { ...input };
  if (fields.entryRoute !== "qr")
    for (const key of ["qrAccessEase", "qrDiaryMotivation", "qrFlowFeedback"]) delete fields[key];
  if (fields.judgmentOrAwkwardness !== "있었다") delete fields.awkwardnessDetail;
  return fields;
}, surveyFields);
export type SurveyAnswers = z.output<typeof surveyFields>;
export type SurveyDraft = Partial<z.input<typeof surveyFields>>;
type Key = Exclude<keyof SurveyAnswers, "entryRoute">;
type Question = {
  key: Key;
  label: string;
  scale?: string[];
  options?: readonly string[];
  when?: "qr" | "awkward";
};
export const surveyQuestions: Question[] = [
  {
    key: "selfUnderstanding",
    label: "AI와 대화한 후, 나를 더 잘 이해하게 되었나요?",
    scale: agree,
  },
  {
    key: "organizationHelpfulness",
    label: "감정과 생각을 정리하는 데 도움이 되었나요?",
    scale: agree,
  },
  {
    key: "judgmentOrAwkwardness",
    label: "대화 중 AI가 내 마음을 섣불리 판단·단정하거나, 답변이 어색하게 느껴진 순간이 있었나요?",
    options: judgment,
  },
  {
    key: "awkwardnessDetail",
    label: "어떤 부분이 불편하거나 어색했는지 편하게 적어주세요.",
    when: "awkward",
  },
  {
    key: "disclosureBurden",
    label: "AI에게 나의 솔직한 개인 감정을 입력하는 데 부담이 있었나요?",
    scale: burden,
  },
  { key: "conversationPace", label: "대화의 길이와 호흡은 어땠나요?", options: pace },
  {
    key: "reuseFrequency",
    label: "앞으로도 이 AI 대화를 다시 사용해 보고 싶나요?",
    options: reuse,
  },
  {
    key: "recommendationIntent",
    label: "이 AI 대화를 주변 지인에게 추천하고 싶나요?",
    scale: agree,
  },
  { key: "improvementSuggestions", label: "더 나아졌으면 하는 점이 있다면 편하게 적어주세요." },
  {
    key: "qrAccessEase",
    label: "QR코드를 찍고 웹페이지로 이동하는 과정은 얼마나 편리했나요?",
    scale: ease,
    when: "qr",
  },
  {
    key: "qrDiaryMotivation",
    label: "AI와 대화를 마친 뒤, 다이어리에 깨달은 점을 바로 적고 싶어졌나요?",
    scale: agree,
    when: "qr",
  },
  {
    key: "qrFlowFeedback",
    label:
      "다이어리를 쓰다가 QR로 AI와 대화하고 다시 기록하는 흐름에서, 불편했거나 아쉬웠던 점이 있나요?",
    when: "qr",
  },
];
export function visibleQuestion(q: Question, draft: SurveyDraft) {
  return q.when === "qr"
    ? draft.entryRoute === "qr"
    : q.when === "awkward"
      ? draft.judgmentOrAwkwardness === "있었다"
      : true;
}
export function updateSurvey(draft: SurveyDraft, change: SurveyDraft) {
  const next = { ...draft, ...change };
  for (const q of surveyQuestions) if (!visibleQuestion(q, next)) delete next[q.key];
  return next;
}
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
export type SurveyConfig = { ready: boolean; recipient: string; retention: string };
