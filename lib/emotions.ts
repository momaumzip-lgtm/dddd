import { z } from "zod";
export type Emotion = {
  id: string;
  category: "positive" | "negative";
  label: string;
  aliases: string[];
};
export const emotionCatalog: readonly Emotion[] = [
  { id: "pos-001", category: "positive", label: "행복함", aliases: [] },
  { id: "pos-002", category: "positive", label: "감사함", aliases: [] },
  { id: "pos-003", category: "positive", label: "연결감", aliases: [] },
  { id: "pos-004", category: "positive", label: "흥분됨", aliases: [] },
  { id: "pos-005", category: "positive", label: "뿌듯함", aliases: [] },
  { id: "pos-006", category: "positive", label: "즐거움", aliases: [] },
  { id: "pos-007", category: "positive", label: "열정적임", aliases: [] },
  { id: "pos-008", category: "positive", label: "활기참", aliases: [] },
  { id: "pos-009", category: "positive", label: "경외심", aliases: [] },
  { id: "pos-010", category: "positive", label: "자랑스러움", aliases: [] },
  { id: "pos-011", category: "positive", label: "만족감", aliases: [] },
  { id: "pos-012", category: "positive", label: "희망", aliases: [] },
  { id: "pos-013", category: "positive", label: "사랑", aliases: [] },
  { id: "pos-014", category: "positive", label: "기쁨", aliases: ["기뻐", "기뻐요"] },
  { id: "pos-015", category: "positive", label: "자신감 넘침", aliases: ["자신감넘침"] },
  { id: "pos-016", category: "positive", label: "이완됨", aliases: [] },
  { id: "pos-017", category: "positive", label: "편안함", aliases: [] },
  { id: "pos-018", category: "positive", label: "흥미로움", aliases: [] },
  { id: "pos-019", category: "positive", label: "충전됨", aliases: [] },
  { id: "pos-020", category: "positive", label: "영감 받음", aliases: ["영감받음"] },
  { id: "pos-021", category: "positive", label: "배려심", aliases: [] },
  { id: "pos-022", category: "positive", label: "애정 넘침", aliases: ["애정넘침"] },
  { id: "pos-023", category: "positive", label: "축복받은 기분", aliases: ["축복받은기분"] },
  { id: "pos-024", category: "positive", label: "이끌림", aliases: [] },
  { id: "pos-025", category: "positive", label: "자유로움", aliases: [] },
  { id: "pos-026", category: "positive", label: "장난스러움", aliases: [] },
  { id: "pos-027", category: "positive", label: "유머러스함", aliases: [] },
  { id: "pos-028", category: "positive", label: "평온함", aliases: [] },
  { id: "pos-029", category: "positive", label: "들뜸", aliases: [] },
  { id: "pos-030", category: "positive", label: "천진난만함", aliases: [] },
  { id: "pos-031", category: "positive", label: "순수함", aliases: [] },
  { id: "pos-032", category: "positive", label: "유쾌함", aliases: [] },
  { id: "pos-033", category: "positive", label: "겸손함", aliases: [] },
  { id: "pos-034", category: "positive", label: "낭만적임", aliases: [] },
  { id: "pos-035", category: "positive", label: "낙관적임", aliases: [] },
  { id: "pos-036", category: "positive", label: "호기심", aliases: [] },
  { id: "pos-037", category: "positive", label: "공감됨", aliases: [] },
  { id: "pos-038", category: "positive", label: "감성적임", aliases: [] },
  { id: "pos-039", category: "positive", label: "놀라움", aliases: [] },
  { id: "pos-040", category: "positive", label: "친근함", aliases: [] },
  { id: "pos-041", category: "positive", label: "부드러움", aliases: [] },
  { id: "pos-042", category: "positive", label: "성취감", aliases: [] },
  { id: "pos-043", category: "positive", label: "믿음직함", aliases: [] },
  { id: "pos-044", category: "positive", label: "존경스러움", aliases: [] },
  { id: "pos-045", category: "positive", label: "안도감", aliases: [] },
  { id: "pos-046", category: "positive", label: "위안됨", aliases: [] },
  { id: "pos-047", category: "positive", label: "따뜻함", aliases: [] },
  { id: "pos-048", category: "positive", label: "확신", aliases: [] },
  { id: "pos-049", category: "positive", label: "통쾌함", aliases: [] },
  { id: "pos-050", category: "positive", label: "감동 받음", aliases: ["감동받음"] },
  { id: "pos-051", category: "positive", label: "벅차오름", aliases: [] },
  { id: "pos-052", category: "positive", label: "누그러짐", aliases: [] },
  { id: "pos-053", category: "positive", label: "짜릿함", aliases: [] },
  { id: "pos-054", category: "positive", label: "신남", aliases: [] },
  { id: "pos-055", category: "positive", label: "정겨움", aliases: ["정겨운"] },
  { id: "pos-056", category: "positive", label: "기력이 넘침", aliases: ["기력이넘침"] },
  { id: "pos-057", category: "positive", label: "홀가분함", aliases: [] },
  { id: "neg-001", category: "negative", label: "배신감", aliases: [] },
  { id: "neg-002", category: "negative", label: "억울함", aliases: [] },
  { id: "neg-003", category: "negative", label: "무시당한 느낌", aliases: ["무시당한느낌"] },
  { id: "neg-004", category: "negative", label: "조롱당한 느낌", aliases: ["조롱당한느낌"] },
  { id: "neg-005", category: "negative", label: "분함", aliases: ["화남", "화난", "화났어"] },
  { id: "neg-006", category: "negative", label: "침해당함", aliases: [] },
  { id: "neg-007", category: "negative", label: "부러움", aliases: [] },
  { id: "neg-008", category: "negative", label: "열등감", aliases: [] },
  { id: "neg-009", category: "negative", label: "도덕적 분별심", aliases: ["도덕적분별심"] },
  { id: "neg-010", category: "negative", label: "자괴감", aliases: [] },
  { id: "neg-011", category: "negative", label: "막막함", aliases: [] },
  { id: "neg-012", category: "negative", label: "두려움", aliases: [] },
  { id: "neg-013", category: "negative", label: "압도된 느낌", aliases: ["압도된느낌"] },
  { id: "neg-014", category: "negative", label: "불안함", aliases: ["불안", "불안해요"] },
  { id: "neg-015", category: "negative", label: "거절당한 느낌", aliases: ["거절당한느낌"] },
  { id: "neg-016", category: "negative", label: "수치스러움", aliases: [] },
  { id: "neg-017", category: "negative", label: "짜증", aliases: [] },
  { id: "neg-018", category: "negative", label: "슬픔", aliases: [] },
  { id: "neg-019", category: "negative", label: "공허함", aliases: [] },
  { id: "neg-020", category: "negative", label: "후회됨", aliases: [] },
  { id: "neg-021", category: "negative", label: "실망감", aliases: [] },
  { id: "neg-022", category: "negative", label: "협박받는 느낌", aliases: ["협박받는느낌"] },
  { id: "neg-023", category: "negative", label: "무관심함", aliases: [] },
  { id: "neg-024", category: "negative", label: "공감 안 됨", aliases: ["공감안됨"] },
  { id: "neg-025", category: "negative", label: "무기력함", aliases: [] },
  { id: "neg-026", category: "negative", label: "몰아세워진 기분", aliases: ["몰아세워진기분"] },
  { id: "neg-027", category: "negative", label: "산만함", aliases: [] },
  { id: "neg-028", category: "negative", label: "충격적임", aliases: [] },
  { id: "neg-029", category: "negative", label: "어지러움", aliases: [] },
  { id: "neg-030", category: "negative", label: "구역감", aliases: [] },
  { id: "neg-031", category: "negative", label: "긴장감", aliases: [] },
  { id: "neg-032", category: "negative", label: "오싹함", aliases: [] },
  { id: "neg-033", category: "negative", label: "염려", aliases: [] },
  { id: "neg-034", category: "negative", label: "질투", aliases: [] },
  { id: "neg-035", category: "negative", label: "미움", aliases: [] },
  { id: "neg-036", category: "negative", label: "비참", aliases: [] },
  { id: "neg-037", category: "negative", label: "우울", aliases: [] },
  { id: "neg-038", category: "negative", label: "버림받은 기분", aliases: ["버림받은기분"] },
  { id: "neg-039", category: "negative", label: "한심함", aliases: [] },
  { id: "neg-040", category: "negative", label: "상실감", aliases: [] },
  { id: "neg-041", category: "negative", label: "외로움", aliases: [] },
  { id: "neg-042", category: "negative", label: "소외감", aliases: [] },
  { id: "neg-043", category: "negative", label: "귀찮음", aliases: [] },
  { id: "neg-044", category: "negative", label: "고립감", aliases: [] },
  { id: "neg-045", category: "negative", label: "피해의식", aliases: [] },
  { id: "neg-046", category: "negative", label: "의심스러움", aliases: [] },
  { id: "neg-047", category: "negative", label: "적개심", aliases: [] },
  { id: "neg-048", category: "negative", label: "약오름", aliases: [] },
  { id: "neg-049", category: "negative", label: "부담스러움", aliases: [] },
  { id: "neg-050", category: "negative", label: "초조함", aliases: ["초초", "초조"] },
  {
    id: "neg-051",
    category: "negative",
    label: "괴롭힘당하는 기분",
    aliases: ["괴롭힘당하는기분"],
  },
  { id: "neg-052", category: "negative", label: "낙담함", aliases: [] },
  { id: "neg-053", category: "negative", label: "까마득함", aliases: [] },
  { id: "neg-054", category: "negative", label: "피곤함", aliases: [] },
  { id: "neg-055", category: "negative", label: "지겨움", aliases: [] },
  {
    id: "neg-056",
    category: "negative",
    label: "서운함",
    aliases: ["서운한", "서운해", "서운해요"],
  },
  { id: "neg-057", category: "negative", label: "열받음", aliases: [] },
  { id: "neg-058", category: "negative", label: "맥빠짐", aliases: [] },
  { id: "neg-059", category: "negative", label: "무료함", aliases: [] },
  { id: "neg-060", category: "negative", label: "질림", aliases: [] },
  { id: "neg-061", category: "negative", label: "겸연쩍음", aliases: ["겸연쩎음"] },
  { id: "neg-062", category: "negative", label: "그리움", aliases: [] },
  { id: "neg-063", category: "negative", label: "먹먹함", aliases: [] },
  { id: "neg-064", category: "negative", label: "거북함", aliases: [] },
  { id: "neg-065", category: "negative", label: "공포", aliases: [] },
  { id: "neg-066", category: "negative", label: "걱정", aliases: [] },
  { id: "neg-067", category: "negative", label: "좌절", aliases: [] },
  { id: "neg-068", category: "negative", label: "성가심", aliases: ["성가신"] },
];
export const intensityBands = [
  { id: "0_20", label: "0~20%", description: "아주 약하게" },
  { id: "20_40", label: "20~40%", description: "조금" },
  { id: "40_60", label: "40~60%", description: "어느 정도" },
  { id: "60_80", label: "60~80%", description: "꽤 크게" },
  { id: "80_100", label: "80~100%", description: "아주 크게" },
  { id: "unknown", label: "잘 모르겠어요", description: "지금은 미정" },
] as const;
export const emotionSelectionSchema = z
  .object({
    emotionId: z
      .string()
      .refine(
        (id) => id === "unknown" || id === "custom" || emotionCatalog.some((e) => e.id === id),
      ),
    customLabel: z.string().trim().max(40).default(""),
    intensityBand: z.enum(["0_20", "20_40", "40_60", "60_80", "80_100", "unknown"]),
    version: z.number().int().min(0).max(10000),
  })
  .strict()
  .refine((e) => e.emotionId !== "custom" || e.customLabel.length > 0)
  .transform((e) => (e.emotionId === "custom" ? e : { ...e, customLabel: "" }));
export type EmotionSelection = z.infer<typeof emotionSelectionSchema>;
export const unknownEmotion: EmotionSelection = {
  emotionId: "unknown",
  customLabel: "",
  intensityBand: "unknown",
  version: 0,
};
export function emotionLabel(value: EmotionSelection) {
  return value.emotionId === "custom"
    ? value.customLabel
    : emotionCatalog.find((e) => e.id === value.emotionId)?.label || "잘 모르겠어요";
}
export function selectionContext(value: EmotionSelection) {
  const entry = emotionCatalog.find((e) => e.id === value.emotionId);
  return {
    emotionId: value.emotionId,
    version: value.version,
    emotion: emotionLabel(value),
    category: entry?.category || "unknown",
    intensityBand: value.intensityBand,
    responseGuidance: {
      "0_20":
        "잠깐 스친 느낌도 가볍게 받아준다. 큰 상처나 강한 기쁨으로 부풀리지 않는다. 더 알고 싶어 하면 장면 속 작은 차이를 살핀다.",
      "20_40":
        "가볍게 남은 마음을 당사자가 쓴 말로 받아준다. 장면 속 말이나 행동 하나에서 이야기를 잇는다.",
      "40_60":
        "마음이 움직인 대목을 분명히 짚는다. 이미 들은 내용을 제외하고 그때 떠오른 생각이나 기대 한 가지를 살핀다.",
      "60_80":
        "그 사람에게 그 감정이 지금 꽤 크게 남아 있음을 반영한다. 크게 기대했다거나 사건이 심각했다고 바꿔 말하지 않는다. 질문은 그때의 한 반응이나 한 장면에 좁힌다.",
      "80_100":
        entry?.category === "positive"
          ? "실제 좋은 일에 맞춰 기쁨을 함께한다. 불안 진정이나 위기 안내를 붙이지 않는다."
          : "감정이 지금 아주 크게 와닿는다는 점을 첫 문장에서 분명하게 인정한다. 기대의 크기나 원인은 추정하지 않는다. 질문은 긴 상황 설명 없이 기억나는 말 한마디, 눈에 남은 모습 하나처럼 바로 답할 수 있는 범위로 좁힌다. 이 값만으로 위기로 판정하지 않는다.",
      unknown: "강도를 추측하거나 숫자로 만들지 않고 말한 경험부터 다룬다.",
    }[value.intensityBand],
  };
}
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export function searchEmotions(query: string, category = "all") {
  const q = normalize(query);
  return emotionCatalog.filter(
    (e) =>
      (!q ? category === "all" || e.category === category : true) &&
      [e.label, ...e.aliases].some((s) => normalize(s).includes(q)),
  );
}
export function correctedSelection(value: EmotionSelection, message: string): EmotionSelection {
  // A contrast about the event (rather than the feeling) must not change the picker.
  const contrasts = message
    .split(/아니라|아니고|보다는/)
    .slice(1)
    .reverse();
  const found = contrasts.flatMap((part) => {
    const target = part
      .replace(/^[,\s]*(?:(?:사실은?|오히려|그냥|지금은|좀 더|조금 더)\s*)*/, "")
      .trimStart();
    return emotionCatalog.filter((e) =>
      [e.label, ...e.aliases].some(
        (label) =>
          label.length >= 2 &&
          target.startsWith(label) &&
          !/^(?:이|은|는|가|을|를)?\s*(?:아니|없|느끼지 않)/.test(target.slice(label.length)),
      ),
    );
  })[0];
  return found && found.id !== value.emotionId
    ? {
        ...value,
        emotionId: found.id,
        customLabel: "",
        intensityBand: "unknown",
        version: value.version + 1,
      }
    : value;
}
