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
  { id: "low", label: "약하게 느껴져요", shortLabel: "약하게" },
  { id: "medium", label: "중간 정도로 느껴져요", shortLabel: "중간 정도로" },
  { id: "high", label: "강하게 느껴져요", shortLabel: "강하게" },
] as const;

const currentBands = z.enum(["low", "medium", "high", "unknown"]);
// An already-open client can send the previous selection with its next message.
const legacyBands = {
  "0_20": "low",
  "20_40": "low",
  "40_60": "medium",
  "60_80": "high",
  "80_100": "high",
} as const;
const legacyBandSchema = z.enum(["0_20", "20_40", "40_60", "60_80", "80_100"]);
export const intensityBandSchema = z.union([
  currentBands,
  legacyBandSchema.transform((band) => legacyBands[band]),
]);
export const emotionSelectionSchema = z
  .object({
    emotionId: z
      .string()
      .refine(
        (id) => id === "unknown" || id === "custom" || emotionCatalog.some((e) => e.id === id),
      ),
    customLabel: z.string().trim().max(40).default(""),
    intensityBand: intensityBandSchema,
    version: z.number().int().min(0).max(10000),
  })
  .strict()
  .refine((e) => e.emotionId !== "custom" || e.customLabel.length > 0)
  .transform((e) => (e.emotionId === "custom" ? e : { ...e, customLabel: "" }));
export type EmotionSelection = z.infer<typeof emotionSelectionSchema>;
// An older open tab validates the reply against the same scale it sent.
export function selectionForClient(selection: EmotionSelection, requestedBand: unknown) {
  const previous = legacyBandSchema.safeParse(requestedBand);
  return previous.success && selection.intensityBand === legacyBands[previous.data]
    ? { ...selection, intensityBand: previous.data }
    : selection;
}
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
      low:
        entry?.category === "positive"
          ? "가벼운 기쁨을 가볍게 반긴다. 실제 말이나 행동 하나를 가리키며 무엇이 특별했는지 한두 마디로 답할 수 있게 묻는다. 웃거나 울었다고 미리 가정하지 않는다. 작품명이나 색처럼 기쁨과 무관한 정보는 묻지 않는다."
          : "작은 느낌에 어울리게 담백하게 말한다. 사건 앞뒤에서 아직 듣지 않은 말이나 행동 하나를 묻는다. 이미 어느 때 무엇이 걸렸는지 말했다면 그걸 다시 묻지 않는다. 위로나 해결책부터 권하지 않는다.",
      medium:
        entry?.category === "positive"
          ? "직접 한 일과 그 결과 중 사용자가 더 이야기할 만한 한 지점을 잡는다. 원문에 나온 두 일이 이어졌다면 그 연결이 특히 좋았는지 짧게 물을 수 있다. 상대방 마음을 추정하거나 물건 정보를 캐묻지 않는다."
          : "사실에서 사용자의 바람으로 한 걸음 옮긴다. 하던 말이 끊겼다면 마저 하고 싶었던 말, 앞일이 걱정된다면 그때 어떻게 시작하고 싶은지처럼 한 가지를 묻는다. 직접 바람을 밝혔다면 다시 묻지 않는다. 누가 했는지 모르는 일은 당사자가 확인한 변화와 그 영향을 다룬다.",
      high:
        entry?.category === "positive"
          ? "기쁜 장면을 충분히 반긴다. 그 기쁨을 간직하거나 나누는 작은 선택을 하나 묻는다. 이미 느낀 기쁨을 맞히게 하지 말고, 다시 해 보고 싶은 일이나 남겨 두고 싶은 한마디처럼 바로 답할 수 있게 한다. 진정이나 위기 안내는 붙이지 않는다."
          : "그 자리에 있었던 사람에게 다정하게 한마디 건넨다. 방금 나온 구체적인 상황에 맞춰 듣고 싶었던 말이나 받고 싶은 도움 중 한 가지만 짧게 묻는다. 공개적으로 상처 주는 말을 들었다면 그 말을 한 사람에게 듣고 싶었던 말로 초점을 좁힌다. 원인이나 경위를 설명시키지 않는다. 강도 자체는 위험 신호가 아니다.",
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
