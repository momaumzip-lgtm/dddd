export const greeting =
  "안녕하세요. 지금 느끼는 감정과 떠오르는 생각을 천천히 정리해봐요. 오늘 어떤 감정이 가장 크게 느껴지나요?";
export const emotions = ["불안해요", "답답해요", "속상해요", "무기력해요", "잘 모르겠어요"];
export type Message = { role: "user" | "assistant"; content: string };
export type PublicConfig = {
  name: string;
  operator: string;
  contact: string;
  ready: boolean;
  maxInput: number;
  development: boolean;
  survey: import("./survey").SurveyConfig;
  policy: { targetAge: string; processing: string };
};

export const GUIDED_HISTORY_MESSAGES = 100;
