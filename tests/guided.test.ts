import { test } from "node:test";
import assert from "node:assert/strict";
import { freshProgress, type Progress } from "../lib/conversation";
import type { Message } from "../lib/config";
import { paceFor, unknownEmotion, type EmotionSelection } from "../lib/emotions";
import {
  controlText,
  type Observation,
  type ExplorationControl,
  type MindRecord,
} from "../lib/exploration";
import { runStreamingChat, type StreamingProvider } from "../lib/server/stream-chat";
import { Gate } from "../lib/server/limits";
import { AppError } from "../lib/server/errors";
import { LuaStore } from "./store";
import { guidedScenes } from "./fixtures/guided-scenes";

const blank: Observation = {
  newTopic: false,
  situation: "",
  emotions: [],
  estimatedIntensity: "unknown",
  thought: "",
  meaning: "",
  wish: "",
  need: "",
  needBasis: "",
  confirmedNeed: "",
  rejected: false,
  insight: "",
  reframe: "",
};
const cap = { minute: 60, day: 120, global: 600 };
function provider(): StreamingProvider {
  return {
    moderate: async () => ({ flagged: false, categories: {} }),
    moderateOutputs: async (texts) => texts.map(() => false),
    classify: async () => ({ safety: "normal", harmfulRequest: false, noQuestions: false }),
    checkAttribution: async () => ({ edits: [] }),
    reviewReadiness: async () => assert.fail("guided route must not use legacy readiness"),
    reviewDiary: async () => assert.fail("guided route must not use the legacy one-line diary"),
    reviewExploration: async () => blank,
    generateMindRecord: async (_messages, evidence) => ({
      situation: evidence.situation,
      emotions: evidence.expressedEmotions.join(" · "),
      meaning: evidence.meaning,
      needs: evidence.confirmedNeeds.map(({ meaning }) => meaning),
      discovery: evidence.insight,
      connection: "",
      care: [],
      message: "오늘 마음을 돌볼 시간을 냈다.",
    }),
    reviewMindRecord: async () => true,
    streamReply: async (_messages, context) => ({
      mode: "continue",
      safety: "normal",
      sentences: context.listening
        ? ["그 일이 마음에 남았군요."]
        : context.guided?.candidate
          ? [`‘${context.guided.candidate}’도 가까운 마음이었을까요?`]
          : [
              `${context.guided?.stage === "AUTOMATIC_THOUGHT" ? "그때 어떤 생각이 스쳤어요" : "그 장면에서 무엇이 제일 마음에 남았어요"}?`,
            ],
    }),
  };
}
const id = () => crypto.randomUUID();

for (const scene of guidedScenes) {
  test(`guided regression · ${scene.id}`, async () => {
    const ai = provider();
    const history: Message[] = scene.lines
      .slice(0, scene.control ? undefined : -1)
      .map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }));
    ai.reviewExploration = async () => ({
      ...blank,
      situation: scene.lines[0].slice(0, 155),
      newTopic: scene.id === "new-scene",
      ...(scene.id === "new-scene" ? { situation: scene.lines.at(-1)! } : {}),
      rejected: scene.id === "reject-guess",
    });
    const emotion: EmotionSelection = {
      ...unknownEmotion,
      emotionId: scene.emotion ?? "unknown",
      ...(scene.percent !== undefined ? { intensityPercent: scene.percent } : {}),
    };
    const result = await runStreamingChat(
      {
        sid: id(),
        cid: id(),
        rid: id(),
        revision: 0,
        safety: "normal",
        history,
        progress: { ...freshProgress, turns: history.length / 2 },
        emotion,
        action: scene.control === "record" || scene.control === "end" ? "summary" : "chat",
        control: scene.control,
        guided: true,
        message: scene.control ? controlText[scene.control] : scene.lines.at(-1)!,
      },
      new Gate(new LuaStore(), cap),
      ai,
      () => {},
    );
    assert.equal(result.surveyReady, scene.expected === "record");
    assert.equal(
      result.progress.completed,
      scene.expected === "record" || scene.expected === "without-record",
    );
    if (scene.expected === "safety") assert.notEqual(result.safety, "normal");
    else assert.equal(result.safety, "normal");
    if (scene.expected === "record") {
      assert.ok(result.explorationView?.finalRecord);
      assert.equal(result.explorationView?.surveyStatus, "available");
    }
    if (scene.percent !== undefined)
      assert.equal(result.explorationView?.emotionIntensity.reported, scene.percent);
    if (scene.id === "very-high")
      assert.match(result.explorationView?.nextQuestion ?? "", /지금.*이어가도 괜찮으세요/);
    if (scene.id === "positive-intensity")
      assert.doesNotMatch(result.explorationView?.nextQuestion ?? "", /지금.*이어가도 괜찮으세요/);
  });
}

test("the guided thread confirms grounded needs, offers a choice, and stays open past ten replies", async () => {
  const ai = provider();
  let observation = blank;
  let reviews = 0;
  let drafts = 0;
  ai.reviewExploration = async () => {
    reviews++;
    return observation;
  };
  const draftReply = ai.streamReply;
  ai.streamReply = (...args) => {
    drafts++;
    return draftReply(...args);
  };
  const gate = new Gate(new LuaStore(), cap);
  const sid = id(),
    cid = id();
  let revision = 0,
    progress: Progress = freshProgress,
    history: Message[] = [];
  const emotion: EmotionSelection = {
    ...unknownEmotion,
    emotionId: "neg-056",
    intensityBand: "medium",
  };
  async function turn(
    text: string,
    patch: Partial<Observation> = {},
    control?: ExplorationControl,
  ) {
    observation = { ...blank, ...patch };
    const rid = id();
    const output = await runStreamingChat(
      {
        sid,
        cid,
        rid,
        revision,
        progress,
        history,
        emotion,
        safety: "normal",
        guided: true,
        control,
        message: control ? controlText[control] : text,
        action: control === "record" || control === "end" ? "summary" : "chat",
      },
      gate,
      ai,
      () => {},
    );
    await gate.acknowledge(sid, cid, rid, output.revision);
    ({ revision, progress, history } = output);
    return output;
  }
  await turn("친구가 제 메시지를 읽고 답장을 안 해서 서운했어요.", {
    situation: "친구가 제 메시지를 읽고 답장을 안 해서",
    emotions: ["서운했어요"],
  });
  const thought = await turn("나를 무시한다고 생각했어요.", {
    thought: "나를 무시한다고 생각했어요.",
  });
  assert.equal(thought.explorationView?.conversationStage, "PERSONAL_MEANING");
  await turn("별로 중요한 사람이 아닌 것처럼 느껴졌어요.", {
    meaning: "중요한 사람이 아닌 것처럼 느껴졌어요.",
  });
  const proposal = await turn("바쁘면 나중에 답한다고 말해주길 바랐어요.", {
    wish: "나중에 답한다고 말해주길 바랐어요.",
    need: "관계에서 소중하게 여겨지고 싶은 마음",
    needBasis: "나중에 답한다고 말해주길 바랐어요.",
  });
  assert.equal(proposal.explorationView?.conversationStage, "NEED_VALIDATION");
  assert.ok(proposal.progress.exploration?.pending);
  const callsBeforeConfirmation = { reviews, drafts };
  const confirmed = await turn("네. 그게 맞아요.");
  assert.equal(confirmed.explorationView?.conversationStage, "REFRAMING");
  assert.equal(confirmed.explorationView?.offerRecord, true);
  assert.equal(confirmed.progress.questions, proposal.progress.questions);
  assert.equal(confirmed.explorationView?.nextQuestion, null);
  assert.equal(confirmed.progress.completed, false);
  assert.deepEqual({ reviews, drafts }, callsBeforeConfirmation);
  const perspective =
    "답이 늦으면 무시라고 생각했는데, 소중한 사람이라고 느끼고 싶어서 서운했구나.";
  const ready = await turn(perspective, { reframe: perspective, insight: perspective });
  assert.equal(ready.explorationView?.readyToComplete, true);
  assert.equal(ready.explorationView?.offerRecord, true);
  assert.equal(ready.progress.completed, false);
  const more = await turn("", {}, "more");
  assert.equal(more.explorationView?.offerRecord, false);
  for (const text of [
    "마음이 좀 편해졌어요.",
    "그래도 조금 서운함은 남아 있어요.",
    "다음엔 먼저 감정을 말해볼래요.",
    "그때와 지금 감정이 달라요.",
    "정리가 되는 것 같아요.",
  ])
    assert.equal((await turn(text)).progress.completed, false);
  assert.equal(progress.turns, 11);
  const reviewsBeforeRecord = reviews;
  const recorded = await turn("", {}, "record");
  assert.equal(reviews, reviewsBeforeRecord);
  assert.equal(recorded.explorationView?.completionReason, "explored");
  assert.deepEqual(recorded.explorationView?.finalRecord?.needs, [
    "관계에서 소중하게 여겨지고 싶은 마음",
  ]);
  assert.equal(recorded.explorationView?.conversationStage, "SURVEY");
  assert.equal(recorded.surveyReady, true);
});

test("the four numeric bands do not equate intensity with a crisis", () => {
  assert.deepEqual(
    [0, 30, 31, 60, 61, 80, 81, 100].map((value) => paceFor(value)),
    ["low", "low", "medium", "medium", "high", "high", "veryHigh", "veryHigh"],
  );
});

test("an ambiguous generated warning is checked against the user's words before being shown", async () => {
  const ai = provider();
  let routeCalls = 0;
  let generationCalls = 0;
  const originalStream = ai.streamReply;
  ai.classify = async () => {
    routeCalls++;
    return { safety: "normal", harmfulRequest: false, noQuestions: false };
  };
  ai.streamReply = async (messages, context, publish) => {
    generationCalls++;
    if (generationCalls === 1) return { mode: "safety", safety: "check", sentences: [] };
    assert.equal(context.guided?.ordinaryDistress, true);
    return originalStream(messages, context, publish);
  };
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      progress: freshProgress,
      history: [],
      emotion: { ...unknownEmotion, intensityPercent: 88 },
      action: "chat",
      guided: true,
      message: "발표 자료를 다시 고쳐야 해서 일이 많아 죽겠어요.",
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(routeCalls, 1);
  assert.equal(generationCalls, 2);
  assert.equal(result.safety, "normal");
  assert.equal(result.progress.completed, false);
  assert.ok(result.explorationView?.nextQuestion);
});

test("a paraphrase of the last future-care question is retried with a different focus", async () => {
  const ai = provider();
  let calls = 0;
  ai.streamReply = async () => ({
    mode: "continue",
    safety: "normal",
    sentences: [
      ++calls === 1
        ? "다음에 비슷한 상황에서 자신을 위해 해보고 싶은 작은 행동이 있나요?"
        : "그 마음을 알아차리고 지금 가장 달라 보이는 건 무엇인가요?",
    ],
  });
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: { ...freshProgress, turns: 1 },
      emotion: unknownEmotion,
      history: [
        { role: "user", content: "친구가 제 말을 끊었어요." },
        {
          role: "assistant",
          content: "다음에 비슷한 일이 생기면 자신을 어떻게 챙겨주고 싶으세요?",
        },
      ],
      message: "내가 말할 기회를 원했어요.",
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(calls, 2);
  assert.match(result.body, /달라 보이는/);
});

test("a record request can recover an explicit need from prior user turns", async () => {
  const ai = provider();
  const confirmedNeed = "내 말을 소중하게 들어주는 게 필요했어요.";
  ai.reviewExploration = async () => ({ ...blank, confirmedNeed });
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "summary",
      control: "record",
      progress: { ...freshProgress, turns: 1 },
      emotion: unknownEmotion,
      history: [
        { role: "user", content: confirmedNeed },
        { role: "assistant", content: "그 마음이 중요했군요." },
      ],
      message: controlText.record,
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(result.surveyReady, true);
  assert.deepEqual(result.explorationView?.finalRecord?.needs, [confirmedNeed]);
});

test("a strong disappointment starts with a lighter question than medium intensity", async () => {
  const ai = provider();
  ai.streamReply = async () => ({
    mode: "continue",
    safety: "normal",
    sentences: ["그 순간 친구의 행동이 어떤 뜻처럼 느껴지셨나요?"],
  });
  async function first(percent: number) {
    return runStreamingChat(
      {
        sid: id(),
        cid: id(),
        rid: id(),
        revision: 0,
        safety: "normal",
        guided: true,
        action: "chat",
        progress: freshProgress,
        history: [],
        message: "친구가 말을 중간에 끊었어요.",
        emotion: { ...unknownEmotion, emotionId: "neg-056", intensityPercent: percent },
      },
      new Gate(new LuaStore(), cap),
      ai,
      () => {},
    );
  }
  assert.match((await first(50)).body, /어떤 뜻/);
  assert.match((await first(80)).body, /어떻게 해줬으면/);
});

test("the opening defers evidence extraction while preserving the ordinary actor check", async () => {
  const ai = provider();
  let checked = false;
  ai.reviewExploration = async () => assert.fail("opening must not wait for extraction");
  ai.checkAttribution = async () => {
    checked = true;
    return { edits: [] };
  };
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: freshProgress,
      history: [],
      message: "제가 고른 책을 언니가 챙겨 갔어요.",
      emotion: { ...unknownEmotion, intensityPercent: 60 },
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(checked, true);
  assert.ok(result.explorationView?.nextQuestion);
});
test("an unflagged opening still asks a real question when its generation budget expires", async () => {
  const ai = provider();
  let deadline: number | undefined;
  ai.limitOpeningRequests = (value) => {
    deadline = value;
  };
  ai.streamReply = async () => {
    assert.ok(deadline && deadline > performance.now());
    throw new AppError(504, "AI_TIMEOUT", "opening budget expired");
  };
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: freshProgress,
      history: [],
      message: "친구가 말을 끊었어요.",
      emotion: { ...unknownEmotion, intensityPercent: 60 },
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(result.progress.completed, false);
  assert.equal(result.safety, "normal");
  assert.match(result.body, /말이 끊긴 뒤.*\?$/);
  assert.equal(result.explorationView?.nextQuestion, result.body);
});
test("very strong first messages offer a real pace choice only after an unflagged input screen", async () => {
  const ai = provider();
  const order: string[] = [];
  ai.moderate = async () => {
    order.push("screen");
    return { flagged: false, categories: {} };
  };
  ai.reviewExploration = async () => assert.fail("do not wait for extraction");
  ai.streamReply = async () => assert.fail("do not generate a second pace check");
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: freshProgress,
      history: [],
      message: "친구가 제 말을 끊어서 서운했어요.",
      emotion: { ...unknownEmotion, intensityPercent: 95 },
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => order.push("text"),
  );
  assert.deepEqual(order, ["screen", "text"]);
  assert.match(result.body, /이어가도 괜찮으세요/);
  assert.equal(result.progress.completed, false);
});
test("the next turn cannot paraphrase an earlier question even after a change of focus", async () => {
  const ai = provider();
  let attempts = 0;
  ai.reviewExploration = async () => ({
    ...blank,
    situation: "친구가 말을 끊었어요.",
    thought: "친구가 나를 무시하나 싶었어요.",
  });
  ai.streamReply = async (_messages, context) => {
    assert.ok(context.guided?.avoidFocus?.some((label) => label.includes("바랐던")));
    return {
      mode: "continue",
      safety: "normal",
      sentences: [
        ++attempts === 1
          ? "그때 친구가 어떤 태도를 보여줬다면 관심이 있다고 느꼈을까요?"
          : "그 생각이 들고 나서 실제로 어떻게 하셨어요?",
      ],
    };
  };
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: { ...freshProgress, turns: 2 },
      emotion: unknownEmotion,
      history: [
        { role: "user", content: "친구가 말을 끊었어요." },
        { role: "assistant", content: "친구가 어떤 태도로 들어주길 바라셨나요?" },
        { role: "user", content: "그건 잘 모르겠어요." },
        { role: "assistant", content: "친구가 말을 끊은 뒤 기분은 어땠어요?" },
      ],
      message: "친구가 나를 무시하나 싶었어요.",
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(attempts, 2);
  assert.match(result.explorationView?.nextQuestion || "", /실제로 어떻게/);
});

test("an unsure answer changes an interpretation question to a concrete action", async () => {
  const ai = provider();
  let attempts = 0;
  ai.streamReply = async () => ({
    mode: "continue",
    safety: "normal",
    sentences: [
      ++attempts === 1
        ? "그 행동이 나를 어떻게 대하는 것처럼 느껴졌나요?"
        : "그 뒤 친구에게 뭐라고 하셨어요?",
    ],
  });
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      control: "unsure",
      progress: { ...freshProgress, turns: 1 },
      emotion: unknownEmotion,
      history: [
        { role: "user", content: "친구가 제 말을 중간에 끊었어요." },
        { role: "assistant", content: "그 순간 친구의 행동이 어떤 뜻처럼 느껴졌나요?" },
      ],
      message: controlText.unsure,
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(attempts, 2);
  assert.equal(result.explorationView?.nextQuestion, "그 뒤 친구에게 뭐라고 하셨어요?");
});

for (const { name, earlier, paraphrase } of [
  {
    name: "a question about the user's actions cannot come back as a question about what they said",
    earlier: "그때 친구 앞에서 실제로 어떻게 반응하셨나요?",
    paraphrase: "그 생각이 든 뒤, 친구에게 이어서 무슨 말을 하셨나요?",
  },
  {
    name: "an opening about continuing a story cannot return as a question about continuing to speak",
    earlier: "말이 끊긴 뒤에도 하려던 이야기를 계속할 수 있었어요?",
    paraphrase: "그때 말씀을 계속 이어갈 수 있었나요?",
  },
]) {
  test(name, async () => {
    const ai = provider();
    let attempts = 0;
    ai.streamReply = async () => ({
      mode: "continue",
      safety: "normal",
      sentences: [++attempts === 1 ? paraphrase : "그때 친구에게 어떤 태도를 바라셨나요?"],
    });
    const result = await runStreamingChat(
      {
        sid: id(),
        cid: id(),
        rid: id(),
        revision: 0,
        safety: "normal",
        guided: true,
        action: "chat",
        control: "unsure",
        progress: { ...freshProgress, turns: 1 },
        emotion: unknownEmotion,
        history: [
          { role: "user", content: "친구가 제 말을 중간에 끊었어요." },
          { role: "assistant", content: earlier },
        ],
        message: controlText.unsure,
      },
      new Gate(new LuaStore(), cap),
      ai,
      () => {},
    );
    assert.equal(attempts, 2);
    assert.equal(result.explorationView?.nextQuestion, "그때 친구에게 어떤 태도를 바라셨나요?");
  });
}

test("a wish to be heard leads to the user's own reason and is asked once", async () => {
  const ai = provider();
  const history: Message[] = [
    { role: "user", content: "친구가 제 말을 중간에 끊었어요." },
    { role: "assistant", content: "그때 친구에게 어떤 행동을 바라셨나요?" },
  ];
  const wish = "답을 듣기보다 끝까지 들어주길 바랐어요.";
  const ownReason = "제 의견도 중요하게 여겨진다고 느꼈을 것 같아요.";
  const gate = new Gate(new LuaStore(), cap);
  const sid = id();
  const cid = id();
  ai.reviewExploration = async (messages) => ({
    ...blank,
    situation: history[0].content,
    wish,
    confirmedNeed: messages.at(-1)?.content === ownReason ? ownReason : "",
  });
  ai.streamReply = async () => assert.fail("the direct wish has a grounded question");
  const firstRid = id();
  const first = await runStreamingChat(
    {
      sid,
      cid,
      rid: firstRid,
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: { ...freshProgress, turns: 1 },
      emotion: unknownEmotion,
      history,
      message: wish,
    },
    gate,
    ai,
    () => {},
  );
  assert.equal(
    first.explorationView?.nextQuestion,
    "끝까지 들어줬다면 그때 마음이 어떻게 달라졌을 것 같아요?",
  );
  await gate.acknowledge(sid, cid, firstRid, first.revision);
  let attempts = 0;
  ai.streamReply = async () => ({
    mode: "continue",
    safety: "normal",
    sentences: [
      ++attempts === 1
        ? "말을 끝까지 할 기회가 있었다면, 그 순간 마음이 어떻게 달라졌을 것 같아요?"
        : "그 일을 돌아보니 지금 친구와의 대화에서 새롭게 보이는 점이 있나요?",
    ],
  });
  const next = await runStreamingChat(
    {
      sid,
      cid,
      rid: id(),
      revision: first.revision,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: first.progress,
      emotion: unknownEmotion,
      history: first.history,
      message: ownReason,
    },
    gate,
    ai,
    () => {},
  );
  assert.equal(attempts, 2);
  assert.match(next.explorationView?.nextQuestion || "", /새롭게 보이는 점/);
});

test("a reflection question about the other person's feelings is rejected before display", async () => {
  const ai = provider();
  let attempts = 0;
  ai.streamReply = async () => ({
    mode: "continue",
    safety: "normal",
    sentences: [
      ++attempts === 1
        ? "그렇게 들어주는 일이 친구에게 어떤 의미로 느껴졌을까요?"
        : "그 말을 들었다면 마음이 조금 편해졌을 것 같아요?",
    ],
  });
  const result = await runStreamingChat(
    {
      sid: id(),
      cid: id(),
      rid: id(),
      revision: 0,
      safety: "normal",
      guided: true,
      action: "chat",
      progress: { ...freshProgress, turns: 1 },
      emotion: unknownEmotion,
      history: [
        { role: "user", content: "친구가 제 말을 중간에 끊었어요." },
        { role: "assistant", content: "그때 친구에게 어떤 행동을 바라셨나요?" },
      ],
      message: "미안하다고 했으면 좋았겠어요.",
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(attempts, 2);
  assert.match(result.explorationView?.nextQuestion || "", /마음이 조금 편해졌을/);
});
