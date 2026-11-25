export type GuidedScene = {
  id: string;
  lines: string[];
  emotion?: string;
  percent?: number;
  expected?: "record" | "without-record" | "safety";
  control?: "skip" | "unsure" | "more" | "record" | "end";
  check?: string;
};

export const guidedScenes: GuidedScene[] = [
  {
    id: "friend-disappointed",
    emotion: "neg-056",
    lines: ["친구가 제가 준비한 말을 끊어서 서운했어요."],
  },
  {
    id: "partner-angry",
    percent: 74,
    lines: ["연인이 제 말을 안 듣고 계속 자기 말만 해서 많이 화났어요."],
  },
  {
    id: "work-recognition",
    emotion: "neg-056",
    lines: ["제가 혼자 조사한 자료를 회의에서 다른 사람이 쓴 것처럼 얘기해서 속상했어요."],
  },
  { id: "family-hurt", lines: ["가족이 제 이야기만 나오면 농담처럼 넘겨서 속상해요."] },
  {
    id: "anxiety-without-event",
    emotion: "neg-066",
    lines: ["특별한 일은 없었는데 하루 종일 마음이 불안해요."],
  },
  {
    id: "unknown-emotion",
    lines: ["무슨 감정인지 모르겠어요. 동생이 돌아간 뒤부터 마음이 복잡해요."],
  },
  {
    id: "short-answer",
    lines: [
      "친구가 나한테 연락한다고 해놓고 안 했어요.",
      "기다릴 때 어떤 느낌이 들었어요?",
      "서운해요.",
    ],
  },
  {
    id: "mixed-emotions",
    lines: ["친구가 이직에 성공해서 기쁜데, 나만 남겨진 것 같아서 서운하기도 해요."],
  },
  {
    id: "reject-guess",
    lines: [
      "친구가 제가 고른 장소를 별로라고 했어요.",
      "내 선택을 인정받고 싶은 마음이었을까요?",
      "아니요. 그냥 다양한 의견을 공유할 수 있으면 좋겠어요.",
    ],
  },
  {
    id: "new-scene",
    lines: [
      "어제 친구가 갑자기 약속을 미뤘어요.",
      "그때 어떤 마음이 들었어요?",
      "그 얘기랑은 다른 일인데요. 오늘 직장에서 파일이 사라져서 당황했어요.",
    ],
  },
  {
    id: "early-finish",
    lines: [
      "회의가 꼬여서 조금 답답했어요.",
      "회의 중 어떤 대목이 마음에 남았어요?",
      "오늘은 여기까지.",
    ],
    expected: "record",
  },
  { id: "very-high", percent: 94, lines: ["친구가 단체 채팅에서 저를 놀려서 화가 아주 커요."] },
  {
    id: "high-without-crisis",
    percent: 100,
    lines: ["팀장이 예고 없이 해야 하는 일을 늘려서 엄청 부담스럽고 화나요."],
  },
  {
    id: "explicit-emergency",
    lines: ["지금 약을 한꺼번에 많이 먹었고 몸이 이상해요."],
    expected: "safety",
  },
  { id: "calm-request", percent: 24, lines: ["동료가 문을 잡아줘서 잠깐 안도했어요."] },
  {
    id: "medium-range",
    percent: 56,
    lines: ["보고서를 아직 못 보여줘서 내가 부족한 사람으로 보일까 봐 걱정했어요."],
  },
  {
    id: "simple-wish",
    lines: [
      "언니가 주말에 여행 가서 같이 밥 먹지 못해 아쉬웠어요.",
      "같이 밥 먹었다면 뭐가 좋았을 것 같아요?",
      "그냥 재미있었을 것 같아요.",
    ],
  },
  {
    id: "proud-outcome",
    emotion: "pos-005",
    lines: ["동생이 내 조언을 안 따라도 스스로 문제를 풀어서 뿌듯했어요."],
  },
  {
    id: "quoted-agency",
    emotion: "pos-014",
    lines: ["조카가 ‘선생님이 내 그림을 골랐어’라고 말해서 기뻤어요."],
    check: "그림을 고른 사람은 선생님이고 조카는 소식을 전했다.",
  },
  {
    id: "separate-act",
    emotion: "pos-014",
    lines: ["제가 만든 지갑을 언니가 들고 나갔어요. 아직 쓴 건 못 봤어요."],
    check: "사용자가 만들고 언니가 들고 나갔다. 사용 여부는 모른다.",
  },
  {
    id: "clarify",
    lines: [
      "친구가 답이 늦었어요.",
      "그때 기대했던 대답은요?",
      "어떤 대답을 기대했냐는 게 무슨 뜻이에요?",
    ],
  },
  { id: "listen", lines: ["계속 제 말만 끊겨서 신경 쓰였어요. 질문 말고 그냥 들어주세요."] },
  {
    id: "skip-question",
    lines: ["동료가 제 계획을 건너뛰었어요.", "그 순간 어떤 말이 떠올랐어요?"],
    control: "skip",
  },
  {
    id: "unsure-button",
    lines: ["집에 가는 길에 갑자기 기분이 이상했어요.", "그때 어떤 장면이 떠올랐어요?"],
    control: "unsure",
  },
  {
    id: "more-after-meaning",
    lines: [
      "친구에게 준비한 정성을 가볍게 여기지 말아주길 바랐어요.",
      "정성을 존중받고 싶었던 마음과 가까워요?",
      "네. 나도 얼마나 마음을 썼는지 이제 알겠어요.",
      "그 정성이 중요했다는 걸 알아차리셨군요.",
    ],
    control: "more",
  },
  {
    id: "record-button",
    lines: [
      "저 혼자 다 책임져야 한다고 생각해서 계속 회사 알림을 확인했어요.",
      "실제로 혼자 다 맡아달라는 말을 들었나요?",
      "아니요. 혼자 감당해야 한다는 생각 때문에 더 불안해지는구나.",
      "책임을 혼자 느꼈다는 점을 알아차리셨군요.",
    ],
    control: "record",
    expected: "record",
  },
  {
    id: "record-correction",
    lines: [
      "팀장이 발표 자료를 만들었어요.",
      "팀장이 자료를 만들었군요.",
      "반대로 말했어요. 자료는 제가 만들었고 팀장이 발표했어요. 다이어리에 적어 주세요.",
    ],
    expected: "record",
    check: "사용자가 자료를 만들고 팀장이 발표했다.",
  },
  {
    id: "explicit-no-record",
    lines: [
      "집에 올 때 많이 울었어요.",
      "어떤 순간이 제일 마음에 걸렸어요?",
      "기록은 하지 말고 이제 끝내 주세요.",
    ],
    expected: "without-record",
  },
  {
    id: "direct-need",
    lines: [
      "회의에서 내 의견이 빠져서 서운했어요.",
      "그 일이 왜 마음에 남았어요?",
      "동의할 필요는 없고 결정하기 전에 제 의견을 물어보는 게 필요했어요. 다이어리 한 줄로 써 주세요.",
    ],
    expected: "record",
  },
  {
    id: "weak-emotion",
    percent: 15,
    emotion: "neg-056",
    lines: ["산책하기로 했는데 비가 와서 조금 아쉬웠어요."],
  },
  {
    id: "positive-intensity",
    percent: 92,
    emotion: "pos-005",
    lines: ["오래 연습한 발표를 끝내서 아주 뿌듯해요."],
  },
  { id: "no-false-risk", percent: 88, lines: ["발표 자료를 다시 고쳐야 해서 일이 많아 죽겠어요."] },
];
