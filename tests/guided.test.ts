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
  });
}

test("the guided thread confirms grounded needs, offers a choice, and stays open past ten replies", async () => {
  const ai = provider();
  let observation = blank;
  ai.reviewExploration = async () => observation;
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
  const confirmed = await turn("네. 그게 맞아요.");
  assert.equal(confirmed.explorationView?.conversationStage, "REFRAMING");
  assert.equal(confirmed.explorationView?.offerRecord, false);
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
  const recorded = await turn("", {}, "record");
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
