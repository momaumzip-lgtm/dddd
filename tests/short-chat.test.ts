import { BRIEF_PROMPT, REFLECTION_GOALS } from "../lib/server/prompts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  intensityBands,
  emotionCatalog,
  searchEmotions,
  unknownEmotion,
  emotionSelectionSchema,
  correctedSelection,
  selectionContext,
  selectionForClient,
} from "../lib/emotions";
import { freshProgress, responsePlan } from "../lib/conversation";
import { ReplyFields } from "../lib/server/stream-fields";
import { preserveAttribution } from "../lib/server/attribution";
import { readChatStream, chatErrorMessage, failedChatRequest } from "../lib/browser/chat-stream";
import {
  runStreamingChat,
  type StreamingProvider,
  type StreamContext,
} from "../lib/server/stream-chat";
import { AI } from "../lib/server/openai";
import { Gate } from "../lib/server/limits";
import { LuaStore } from "./store";
import { state, newSession, validateState } from "../lib/server/session";
const id = () => crypto.randomUUID();
const cap = { minute: 60, day: 100, global: 300 };
const emotion = {
  ...unknownEmotion,
  emotionId: emotionCatalog.find((e) => e.label === "불안함")!.id,
  intensityBand: "high" as const,
  version: 1,
};
const args = () => ({
  sid: id(),
  cid: id(),
  rid: id(),
  revision: 0,
  safety: "normal" as const,
  progress: freshProgress,
  history: [],
  message: "상사가 보고서를 고치라고 해서 걱정돼요.",
  action: "chat",
  emotion,
});
function provider(mode = "continue"): {
  ai: StreamingProvider;
  calls: { input: any; context: StreamContext }[];
} {
  const calls: { input: any; context: StreamContext }[] = [];
  return {
    calls,
    ai: {
      reviewExploration: async () => assert.fail("legacy client must not call guided review"),
      generateMindRecord: async () =>
        assert.fail("legacy client must not generate a guided record"),
      reviewMindRecord: async () => assert.fail("legacy client must not review a guided record"),
      reviewReadiness: async () => ({
        wish: "",
        meaning: "",
        confirmedMeaning: "",
        reaction: "",
        insight: "",
        next: "continue",
      }),
      reviewDiary: async () => "grounded",
      checkAttribution: async () => ({ edits: [] }),
      moderateOutputs: async (texts) => texts.map(() => false),
      moderate: async () => ({ flagged: false, categories: {} }),
      classify: async () => {
        throw Error("ordinary turns must not invoke routing");
      },
      streamReply: async (input, context, publish) => {
        calls.push({ input, context });
        const actual = context.forceComplete ? "complete" : mode;
        const result = {
          mode: actual as "continue" | "complete",
          safety: "normal" as const,
          sentences:
            actual === "complete"
              ? [
                  "고쳐야 할 부분이 구체적으로 정해져 있네요.",
                  "지금은 표 순서부터 바꿔보셔도 좋아요.",
                ]
              : ["수정 요청을 받고 걱정되셨군요.", "어느 부분을 고치라고 했나요?"],
        };
        for (const s of result.sentences)
          await publish(s, { mode: result.mode, safety: result.safety });
        return result;
      },
    },
  };
}
test("catalog preserves all 125 unique IDs, exact categories, aliases and all search paths", () => {
  assert.equal(emotionCatalog.length, 125);
  assert.equal(new Set(emotionCatalog.map((e) => e.id)).size, 125);
  assert.equal(emotionCatalog.filter((e) => e.category === "positive").length, 57);
  assert.equal(emotionCatalog.filter((e) => e.category === "negative").length, 68);
  for (const e of emotionCatalog) {
    assert.ok(searchEmotions(e.label).includes(e));
    assert.ok(emotionSelectionSchema.safeParse({ ...emotion, emotionId: e.id }).success);
  }
  for (const [alias, label] of [
    ["초초", "초조함"],
    ["겸연쩎음", "겸연쩍음"],
    ["정겨운", "정겨움"],
    ["성가신", "성가심"],
    ["무시당한느낌", "무시당한 느낌"],
  ])
    assert.ok(searchEmotions(alias, "positive").some((e) => e.label === label));
  for (const label of ["도덕적 분별심", "피해의식", "어지러움", "구역감"])
    assert.ok(searchEmotions(label).some((e) => e.label === label));
  assert.equal(searchEmotions("존재하지않는단어").length, 0);
  assert.equal(
    emotionSelectionSchema.safeParse({ ...emotion, emotionId: "injected" }).success,
    false,
  );
});
test("switching away from a custom emotion discards its text in incoming selections", () => {
  const previous = { ...unknownEmotion, customLabel: "내가 직접 적은 마음" };
  for (const emotionId of ["unknown", emotionCatalog[0].id]) {
    assert.equal(emotionSelectionSchema.parse({ ...previous, emotionId }).customLabel, "");
  }
  assert.equal(
    emotionSelectionSchema.parse({ ...previous, emotionId: "custom" }).customLabel,
    previous.customLabel,
  );
});

test("bands and unknown are categorical; corrections reset intensity and respect latest speech", () => {
  for (const [input, expected] of Object.entries({
    low: "low",
    medium: "medium",
    high: "high",
    unknown: "unknown",
    "0_20": "low",
    "20_40": "low",
    "40_60": "medium",
    "60_80": "high",
    "80_100": "high",
  }))
    assert.equal(
      emotionSelectionSchema.parse({ ...emotion, intensityBand: input }).intensityBand,
      expected,
    );
  assert.equal(emotionSelectionSchema.safeParse({ ...emotion, intensityBand: 50 }).success, false);
  assert.equal(
    correctedSelection(emotion, "화난 게 아니라 서운한 것 같아. 바쁜 건 알아.").intensityBand,
    "unknown",
  );
  assert.equal(
    selectionContext(correctedSelection(emotion, "화난 게 아니라 서운한 것 같아. 바쁜 건 알아."))
      .emotion,
    "서운함",
  );
});
test("responses match the scale used by an open tab and preserve a corrected emotion", () => {
  const oldBand = "60_80";
  const parsed = emotionSelectionSchema.parse({ ...emotion, intensityBand: oldBand });
  assert.equal(parsed.intensityBand, "high");
  assert.equal(selectionForClient(parsed, oldBand).intensityBand, oldBand);
  assert.equal(selectionForClient(parsed, "high").intensityBand, "high");
  assert.equal(selectionForClient(unknownEmotion, oldBand).intensityBand, "unknown");
});

test("four turns carry full ordered context and current emotion; signed completion is required to continue", async () => {
  const db = new LuaStore(),
    gate = new Gate(db, cap),
    p = provider();
  let a: any = args();
  for (let i = 0; i < 4; i++) {
    const chunks: string[] = [];
    if (i === 3) a.message = "지금 끝내자";
    const r = await runStreamingChat(a, gate, p.ai, (s) => chunks.push(s));
    await gate.acknowledge(a.sid, a.cid, a.rid, r.revision);
    assert.equal(r.progress.completed, i === 3);
    assert.equal(r.progress.turns, i + 1);
    assert.equal(chunks.join(""), r.body);
    assert.equal(p.calls[i].input.length, 2 * i + 1);
    assert.deepEqual(p.calls[i].context.emotion, selectionContext(a.emotion));
    a = {
      ...a,
      rid: id(),
      revision: r.revision,
      history: r.history,
      progress: r.progress,
      message: i === 0 ? "表の順番です。" : "修正順を知りたいです。",
      emotion: { ...emotion, intensityBand: "low", version: 2 },
    };
  }
  await assert.rejects(
    runStreamingChat({ ...a, action: "chat" }, gate, p.ai, () => {}),
    /이어/,
  );
  const continued = await runStreamingChat(
    { ...a, action: "continue", rid: id() },
    gate,
    p.ai,
    () => {},
  );
  assert.equal(continued.progress.turns, 1);
  assert.equal(continued.history.length, 10);
  await assert.rejects(
    runStreamingChat({ ...args(), action: "continue" }, gate, p.ai, () => {}),
    /먼저 마무리/,
  );
});
test("only an explicit ending closes the conversation; an offered synthesis keeps it open", async () => {
  for (const message of ["정리해줘", "그만할래", "지금 끝내자"]) {
    const p = provider(),
      r = await runStreamingChat(
        { ...args(), message },
        new Gate(new LuaStore(), cap),
        p.ai,
        () => {},
      );
    assert.equal(r.progress.completed, true);
    assert.ok(!r.body.includes("?"));
  }
  const early = runStreamingChat(
    {
      ...args(),
      progress: { turns: 1, questions: 1, completed: false },
      history: [
        { role: "user", content: "전에도 같은 말을 들었어요." },
        { role: "assistant", content: "어떤 말을 바랐나요?" },
      ],
    },
    new Gate(new LuaStore(), cap),
    provider("complete").ai,
    () => {},
  );
  await assert.rejects(early, /대화를 이어갈 답변/);
  assert.equal(
    responsePlan({ turns: 1, questions: 1, completed: false }, "chat", "응", []).forceComplete,
    false,
  );
});
test("high emotion alone is never a crisis; actual low-intensity danger bypasses normal counters", async () => {
  const positive = {
    ...emotion,
    emotionId: emotionCatalog.find((e) => e.label === "기쁨")!.id,
    intensityBand: "high" as const,
  };
  const r = await runStreamingChat(
    { ...args(), emotion: positive, message: "시험에 붙었어요." },
    new Gate(new LuaStore(), cap),
    provider().ai,
    () => {},
  );
  assert.equal(r.safety, "normal");
  const emergency = await runStreamingChat(
    {
      ...args(),
      emotion: { ...emotion, intensityBand: "low" },
      message: "지금 약을 한꺼번에 많이 먹었어요.",
    },
    new Gate(new LuaStore(), cap),
    provider().ai,
    () => {},
  );
  assert.equal(emergency.safety, "emergency");
  assert.equal(emergency.progress.turns, 0);
  assert.equal(emergency.progress.completed, false);
});
test("fragmented JSON fields handle escaped quotes, Korean, emoji and enforce header before display", () => {
  const object = {
    mode: "complete",
    safety: "normal",
    sentences: ['“마음”이라는 말과 \\" 인용이에요.', "기쁨 🙂 함께해요."],
  };
  const fields = new ReplyFields();
  let texts: string[] = [];
  for (const c of JSON.stringify(object)) texts.push(...fields.push(c));
  assert.deepEqual(texts, object.sentences);
  assert.deepEqual(new ReplyFields().push(JSON.stringify({ reply: object })), object.sentences);
  assert.equal(fields.mode, "complete");
  assert.throws(() => new ReplyFields().push('{"sentences":["나쁜 순서"]}'));
});
function ndjson(events: unknown[], truncate = false) {
  const wire = events.map((e) => JSON.stringify(e) + "\n").join("");
  const bytes = new TextEncoder().encode(wire);
  return new Response(
    new ReadableStream({
      start(c) {
        for (const b of bytes) c.enqueue(new Uint8Array([b]));
        if (!truncate) c.close();
        else c.error(new Error("disconnected"));
      },
    }),
  );
}
test("browser requires a matching terminal event; UTF8 split bytes and HTTP-200 errors recover honestly", async () => {
  const requestId = id(),
    text = "한글과 이모지 🙂";
  const done = {
    type: "done",
    requestId,
    conversationId: id(),
    text,
    token: "signed",
    notice: false,
    help: false,
    completed: true,
    turns: 1,
    questions: 0,
    emotion: {
      ...emotion,
      items: [
        { ...emotion, version: undefined, intensityBand: "high", intensityPercent: 90 },
        {
          emotionId: "custom",
          customLabel: "기쁘면서도 불안해요",
          intensityBand: "medium",
          intensityPercent: 60,
        },
      ],
    },
  };
  let visible = "";
  const result = await readChatStream(
    ndjson([{ type: "text", requestId, delta: text }, done]),
    requestId,
    (t) => (visible = t),
  );
  assert.equal(visible, text);
  assert.equal(result.completed, true);
  assert.equal(result.emotion.items?.[1]?.customLabel, "기쁘면서도 불안해요");
  assert.equal(result.emotion.items?.[1]?.intensityPercent, 60);
  await assert.rejects(
    readChatStream(ndjson([{ type: "text", requestId, delta: text }]), requestId, () => {}),
    /끊겼/,
  );
  await assert.rejects(
    readChatStream(
      ndjson([
        { type: "error", requestId, error: "AI 서비스가 잠시 혼잡해요.", code: "PROVIDER_LIMIT" },
      ]),
      requestId,
      () => {},
    ),
    { code: "PROVIDER_LIMIT", message: "AI 서비스가 잠시 혼잡해요." },
  );
  await assert.rejects(
    readChatStream(ndjson([{ ...done, requestId: id() }]), requestId, () => {}),
    /다른 요청/,
  );
});
test("interrupted provider releases the same revision, never advances history, and blocks duplicate paid requests", async () => {
  const db = new LuaStore(),
    gate = new Gate(db, cap),
    a = args(),
    p = provider();
  p.ai.streamReply = async (_i, _c, publish) => {
    await publish("받은 일부 문장이에요.", { mode: "continue", safety: "normal" });
    throw Error("stream ended without completed");
  };
  await assert.rejects(runStreamingChat(a, gate, p.ai, () => {}));
  await assert.rejects(
    runStreamingChat(a, gate, p.ai, () => {}),
    /이미 접수/,
  );
  const retry = await runStreamingChat({ ...a, rid: id() }, gate, provider().ai, () => {});
  assert.equal(retry.revision, 1);
});
test("production SDK streams actual text fields before completion without routing or an audit call", async () => {
  process.env.OPENAI_API_KEY = "offline-http-stream-test";
  const calls: any[] = [];
  const object = {
    mode: "continue",
    safety: "normal",
    sentences: ["보고서의 어떤 부분을 고칠지 궁금하셨군요.", "수정할 부분은 무엇인가요?"],
  };
  const transport: typeof fetch = async (url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    const events = [
      ...Array.from(JSON.stringify({ reply: object })).map((delta) => ({
        type: "response.output_text.delta",
        delta,
      })),
      {
        type: "response.completed",
        response: {
          status: "completed",
          error: null,
          incomplete_details: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      },
    ];
    return new Response(
      events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("") +
        "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const ai = new AI("gpt-5-nano", 1000, { fetch: transport });
  const chunks: string[] = [];
  const out = await ai.streamReply(
    [{ role: "user", content: "상사가 보고서를 고치래요." }],
    {
      emotion: selectionContext(emotion),
      forceComplete: false,
      listening: false,
      followupQuestion: false,
      turn: 1,
      previousSafety: "normal",
    },
    async (t) => {
      chunks.push(t);
    },
  );
  assert.deepEqual(out.sentences, chunks);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream, true);
  assert.equal(calls[0].store, false);
  assert.equal(calls[0].reasoning.effort, "low");
  assert.ok(!calls[0].instructions.includes("긍정 감정: 57"));
  const modes = calls[0].text.format.schema.properties.reply.anyOf;
  assert.deepEqual(
    modes.map(
      (branch: { properties: { mode: { const: string } } }) => branch.properties.mode.const,
    ),
    ["safety", "refusal", "continue"],
  );
  const custom = "사용자가 직접 지은 감정";
  await ai.streamReply(
    [{ role: "user", content: "오늘 이야기" }],
    {
      emotion: selectionContext({ ...emotion, emotionId: "custom", customLabel: custom }),
      forceComplete: false,
      listening: false,
      turn: 1,
      previousSafety: "normal",
    },
    async () => {},
  );
  assert.equal(calls[1].instructions.includes(custom), false);
  assert.ok(calls[1].input[0].content.includes(custom));
  assert.deepEqual(calls[1].input.at(-1), { role: "user", content: "오늘 이야기" });
});
test("signed progress is bound to session and cannot be replaced with a client turn counter", async () => {
  process.env.SESSION_SECRET = "test-only-secret-at-least-32-characters";
  const s = await newSession();
  const token = await state(s.sid, s.cid, [], "normal", "end", 1, {
    turns: 3,
    questions: 2,
    completed: true,
  });
  assert.equal((await validateState(s.cookie, token, s.cid, [])).progress.completed, true);
  await assert.rejects(validateState((await newSession()).cookie, token, s.cid, []));
});
import { explainProviderError } from "../lib/server/errors";
test("stream errors distinguish auth, exhausted quota, temporary rate limits and server outages", () => {
  assert.equal(explainProviderError({ status: 401 }).code, "KEY");
  assert.equal(explainProviderError({ status: 400 }).code, "MODEL");
  assert.equal(explainProviderError({ status: 429, code: "insufficient_quota" }).code, "QUOTA");
  assert.equal(explainProviderError({ status: 429 }).code, "PROVIDER_LIMIT");
  assert.equal(explainProviderError({ status: 503 }).code, "AI_UNAVAILABLE");
});
test("already committed user-message ID cannot count or append twice under a new request ID", async () => {
  const gate = new Gate(new LuaStore(), cap),
    messageId = id(),
    a = { ...args(), messageId },
    p = provider();
  const r = await runStreamingChat(a, gate, p.ai, () => {});
  await assert.rejects(
    runStreamingChat(
      { ...a, rid: id(), revision: r.revision, history: r.history, progress: r.progress },
      gate,
      p.ai,
      () => {},
    ),
    /이미 반영/,
  );
  assert.equal(p.calls.length, 1);
});
test("question inside a closing summary is blocked and the old history and signed progress remain retryable", async () => {
  const p = provider();
  p.ai.streamReply = async (_i, _c, publish) => {
    await publish("왜 그런가요?", { mode: "complete", safety: "normal" });
    return { mode: "complete", safety: "normal", sentences: ["왜 그런가요?"] };
  };
  const a = {
    ...args(),
    action: "summary",
    progress: { turns: 2, questions: 2, completed: false },
  };
  let emitted = "";
  await assert.rejects(
    runStreamingChat(a, new Gate(new LuaStore(), cap), p.ai, (t) => (emitted += t)),
    /질문 없는/,
  );
  assert.equal(emitted, "");
  assert.equal(a.progress.turns, 2);
});
for (const invalid of ["unsupported quote", "wrong speaker"] as const)
  test(`manual summary retries a ${invalid} before showing text`, async () => {
    const p = provider();
    let attempts = 0;
    p.ai.streamReply = async (_messages, context, publish) => {
      assert.equal(context.manualSummary, true);
      const first = ++attempts === 1;
      assert.equal(
        context.repairSummarySpeaker,
        !first && invalid === "wrong speaker" ? true : undefined,
      );
      const result = {
        mode: "complete" as const,
        safety: "normal" as const,
        sentences: [
          first
            ? invalid === "wrong speaker"
              ? "친구가 제가 준비한 이야기를 끝까지 들으려 하지 않았군요."
              : "처음 정리한 문장은 보여주면 안 돼요."
            : "친구가 이야기를 끝까지 듣지 않아서 서운하셨군요.",
        ],
        diaryDraft: "친구가 내 이야기를 끝까지 듣지 않아서 서운했다.",
        sourceQuote:
          first && invalid === "unsupported quote"
            ? "지금까지 이야기한 내용으로 정리해 주세요."
            : "좀 서운했어요",
      };
      await publish(result.sentences[0], { mode: result.mode, safety: result.safety });
      return result;
    };
    const request = {
      ...args(),
      action: "summary",
      message: "지금까지 이야기한 내용으로 정리해 주세요.",
      history: [
        { role: "user" as const, content: "친구가 이야기를 끝까지 안 들어서 좀 서운했어요." },
      ],
      progress: { turns: 1, questions: 1, completed: false },
    };
    let emitted = "";
    const result = await runStreamingChat(request, new Gate(new LuaStore(), cap), p.ai, (text) => {
      emitted += text;
    });
    assert.equal(attempts, 2);
    assert.match(emitted, /서운하셨군요/);
    assert.doesNotMatch(emitted, /처음 정리한 문장|제가 준비한/);
    assert.ok(result.diaryDraft);
    assert.equal(result.surveyReady, true);
  });
for (const repeatedSpeakerError of [false, true])
  test(`a typed correction keeps the diary when the summary ${repeatedSpeakerError ? "still needs a fallback" : "is repaired"}`, async () => {
    const { ai } = provider();
    let attempts = 0;
    const draft = "모임 사진은 내가 찍었고, 동생이 이메일로 보냈다.";
    ai.streamReply = async (_messages, context, emit) => {
      const first = ++attempts === 1;
      assert.equal(context.recordCorrection, true);
      assert.equal(context.repairSummarySpeaker, first ? undefined : true);
      const sentence =
        first || repeatedSpeakerError
          ? "제가 모임 사진을 찍었고, 동생이 그 사진을 이메일로 보냈군요."
          : "제가 앞서 잘못 이해했어요. 사진은 직접 찍으셨고, 동생이 이메일로 보냈군요.";
      const header = { mode: "complete" as const, safety: "normal" as const };
      await emit(sentence, header);
      return {
        ...header,
        sentences: [sentence],
        sourceQuote: "다이어리에 적어 주세요.",
        diaryDraft: draft,
      };
    };
    const result = await runStreamingChat(
      {
        ...args(),
        history: [
          { role: "user", content: "동생이 모임 사진을 찍었어요." },
          { role: "assistant", content: "동생이 사진을 찍었군요." },
        ],
        progress: { ...freshProgress, turns: 1, questions: 1 },
        message:
          "반대로 말했어요. 사진은 제가 찍었고 동생이 이메일로 보냈어요. 다이어리에 적어 주세요.",
      },
      new Gate(new LuaStore(), cap),
      ai,
      () => {},
    );
    assert.equal(attempts, 2);
    assert.equal(result.diaryDraft, draft);
    assert.doesNotMatch(result.body, /제가 모임 사진을 찍었고/);
    if (repeatedSpeakerError) assert.match(result.body, /말씀하신 내용으로 한 줄을 정리했어요/);
  });
test("conversation omits disguised extra questions and regenerates a premature diary", async () => {
  const p = provider();
  let attempts = 0;
  p.ai.streamReply = async (_messages, _context, emit) => {
    const sentences =
      ++attempts === 1
        ? ["오늘 다이어리에는 말을 끝까지 들어주는 게 중요하다고 남겨볼까요?"]
        : ["어떤 말을 하려던 순간이었어요.", "친구에게 어떤 말을 이어서 하고 싶었어요?"];
    const header = { mode: "continue" as const, safety: "normal" as const };
    for (const sentence of sentences) await emit(sentence, header);
    return { ...header, sentences };
  };
  const result = await runStreamingChat(
    { ...args(), message: "친구가 제 말을 끊었어요." },
    new Gate(new LuaStore(), cap),
    p.ai,
    () => {},
  );
  assert.equal(attempts, 2);
  assert.equal(result.body, "친구에게 어떤 말을 이어서 하고 싶었어요?");
  assert.equal(result.surveyReady, false);
});
test("a repeated premature diary does not break an ordinary followup", async () => {
  const { ai } = provider();
  let attempts = 0;
  ai.streamReply = async (_messages, context, emit) => {
    assert.equal(context.forceComplete, false);
    assert.equal(context.retryConversation, ++attempts === 2 ? true : undefined);
    const sentence = "오늘 다이어리에는 ‘준비한 마음을 존중받고 싶었구나’라고 남겨볼까요?";
    const header = { mode: "continue" as const, safety: "normal" as const };
    await emit(sentence, header);
    return { ...header, sentences: [sentence] };
  };
  const result = await runStreamingChat(
    {
      ...args(),
      history: [
        { role: "user", content: "친구가 축사를 부탁한 기억이 없대요." },
        { role: "assistant", content: "그때 어떤 말이 듣고 싶었어요?" },
      ],
      progress: { ...freshProgress, turns: 1, questions: 1 },
      message: "친구를 위해 들인 시간과 진심을 가볍게 여기지 않는 게 중요했어요.",
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(attempts, 2);
  assert.equal(result.progress.completed, false);
  assert.equal(result.diaryDraft, null);
  assert.doesNotMatch(result.body, /다이어리|존중받고 싶었구나/);
});
test("an action the user wants to take is not presented as decided", async () => {
  const p = provider();
  let attempts = 0;
  p.ai.streamReply = async (_messages, _context, emit) => {
    const sentence =
      ++attempts === 1
        ? "사진을 보여주기로 하신 건 어떤 점이 마음에 걸려서예요?"
        : "사진을 보여주고 싶은 마음이 드셨군요. 어떤 사진을 먼저 보여주고 싶으세요?";
    const header = { mode: "continue" as const, safety: "normal" as const };
    await emit(sentence, header);
    return { ...header, sentences: [sentence] };
  };
  const result = await runStreamingChat(
    { ...args(), message: "사진을 먼저 보여주고 싶어요." },
    new Gate(new LuaStore(), cap),
    p.ai,
    () => {},
  );
  assert.equal(attempts, 2);
  assert.doesNotMatch(result.body, /보여주기로/);
  assert.match(result.body, /어떤 사진/);
});
test("SDK treats failed, incomplete, refusal and missing terminal streams as failures", async () => {
  const context = {
    emotion: selectionContext(emotion),
    forceComplete: true,
    listening: false,
    followupQuestion: false,
    turn: 3,
    previousSafety: "normal" as const,
  };
  for (const terminal of [
    null,
    { type: "response.failed", response: { status: "failed" } },
    { type: "response.incomplete", response: { status: "incomplete" } },
    { type: "error", code: "server_error", message: "offline failure" },
    { type: "response.refusal.delta", delta: "refused" },
  ]) {
    const payload = JSON.stringify({
      mode: "complete",
      safety: "normal",
      sentences: ["시험용 문장이에요."],
    });
    const events = [
      { type: "response.output_text.delta", delta: payload },
      ...(terminal ? [terminal] : []),
    ];
    const ai = new AI("gpt-6-luna", 1000, {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.reasoning.effort, "none");
        assert.equal(body.stream, true);
        return new Response(
          events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    await assert.rejects(
      ai.streamReply([{ role: "user", content: "정리해줘." }], context, async () => {}),
    );
  }
});
test("latest request for practical help overrides an earlier listening preference", () => {
  const plan = responsePlan(
    { turns: 1, questions: 0, completed: false },
    "continue",
    "이제 수정 순서를 알려줘.",
    [{ role: "user", content: "그냥 들어줘." }],
  );
  assert.equal(plan.listening, false);
  assert.equal(plan.forceComplete, false);
  assert.equal(
    responsePlan(freshProgress, "chat", "그만큼 좋은 날이었어요.", []).forceComplete,
    false,
  );
});
test("intensity guidance changes with category and never converts unknown to a numerical score", () => {
  const low = selectionContext({ ...emotion, intensityBand: "low" }),
    high = selectionContext({ ...emotion, intensityBand: "high" }),
    joy = selectionContext({
      ...emotion,
      emotionId: emotionCatalog.find((e) => e.label === "기쁨")!.id,
      intensityBand: "high",
    });
  assert.notEqual(low.responseGuidance, high.responseGuidance);
  assert.notEqual(high.responseGuidance, joy.responseGuidance);
  assert.equal(selectionContext(unknownEmotion).intensityBand, "unknown");
});
test("lost final packet and lost acknowledgement recover using metadata without a second counted turn", async () => {
  const db = new LuaStore(),
    gate = new Gate(db, cap),
    a = args(),
    p = provider();
  const lost = await runStreamingChat(a, gate, p.ai, () => {});
  // The final packet never reached the browser: its old revision can explicitly retry.
  const retryArgs = { ...a, rid: id() };
  const retry = await runStreamingChat(retryArgs, gate, p.ai, () => {});
  assert.equal(retry.progress.turns, 1);
  assert.equal(retry.history.length, 2);
  await gate.acknowledge(a.sid, a.cid, retryArgs.rid, retry.revision);
  await gate.acknowledge(a.sid, a.cid, retryArgs.rid, retry.revision); // acknowledgement response lost: idempotent
  await assert.rejects(gate.acknowledge(a.sid, a.cid, a.rid, lost.revision), /상태가 달라/);
  const next = await runStreamingChat(
    {
      ...a,
      rid: id(),
      revision: retry.revision,
      history: retry.history,
      progress: retry.progress,
      message: "표 순서만 바꾸래요.",
    },
    gate,
    p.ai,
    () => {},
  );
  assert.equal(next.progress.turns, 2);
  assert.ok([...db.data.values()].every((v) => !v.value.includes("수정 요청")));
});
import { DIARY_INVITATION } from "../lib/conversation";
test("explicit summary offers the survey and only invites copying when a draft exists", async () => {
  const r = await runStreamingChat(
    { ...args(), action: "summary", message: "정리해 주세요." },
    new Gate(new LuaStore(), cap),
    provider("complete").ai,
    () => {},
  );
  assert.equal(r.progress.completed, true);
  assert.equal(r.surveyReady, true);
  assert.ok(!r.body.includes(DIARY_INVITATION));
  assert.equal(r.diaryDraft, null);
  const safety = await runStreamingChat(
    { ...args(), message: "지금 약을 과다로 먹었어요." },
    new Gate(new LuaStore(), cap),
    provider().ai,
    () => {},
  );
  assert.equal(safety.surveyReady, false);
  assert.ok(!safety.body.includes(DIARY_INVITATION));
});
import { NextRequest } from "next/server";
import { POST as acknowledgePost } from "../app/api/chat/ack/route";
test("receipt endpoint rejects missing identity, another session, invalid fields and wrong Origin", async () => {
  process.env.SESSION_SECRET = "test-only-secret-at-least-32-characters";
  process.env.APP_URL = process.env.ALLOWED_ORIGIN = "https://review.example.test";
  const s = await newSession(),
    other = await newSession();
  const token = await state(
    s.sid,
    s.cid,
    [],
    "normal",
    "end",
    1,
    { turns: 1, questions: 0, completed: true },
    id(),
  );
  const call = (body: unknown, cookie?: string, origin = "https://review.example.test") =>
    acknowledgePost(
      new NextRequest("https://review.example.test/api/chat/ack", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: "maeum_session=" + cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const body = { conversationId: s.cid, token };
  assert.equal((await call(body)).status, 401);
  assert.equal((await call(body, other.cookie)).status, 409);
  assert.equal((await call(body, s.cookie, "https://evil.example.test")).status, 403);
  assert.equal((await call({ ...body, conversationId: "invalid" }, s.cookie)).status, 400);
});
test("production response schema accepts a one-line completion and rejects a multi-line completion", async () => {
  process.env.OPENAI_API_KEY = "offline-http-stream-test";
  const summary = ["핵심 생각을 정리했어요."];
  const record = "나는 노력도 알아주길 바랐다.";
  for (const { sentences, diaryDraft, message, valid } of [
    { sentences: summary, diaryDraft: record, message: "정리해 주세요.", valid: true },
    {
      sentences: [...summary, "추가 문장이에요."],
      diaryDraft: record,
      message: "정리해 주세요.",
      valid: false,
    },
    {
      sentences: summary,
      diaryDraft: "1.5km를 내 속도로 걸었다.",
      message: "한 문장으로 기록해 주세요.",
      valid: true,
    },
    {
      sentences: summary,
      diaryDraft: record + " 조금 서운했다.",
      message: "한 문장으로 기록해 주세요.",
      valid: false,
    },
    {
      sentences: summary,
      diaryDraft: record + " 조금 서운했다.",
      message: "정리해 주세요.",
      valid: true,
    },
    {
      sentences: summary,
      diaryDraft: record + " 조금 서운했다. 그게 내 마음이다.",
      message: "정리해 주세요.",
      valid: false,
    },
    {
      sentences: summary,
      diaryDraft: "나는 걸었다.내 속도가 좋았다.",
      message: "한 문장으로 기록해 주세요.",
      valid: false,
    },
    {
      sentences: summary,
      diaryDraft: "후배가 나갔다.Recognition 받고 싶었던 건 아니다.",
      message: "한 문장으로 기록해 주세요.",
      valid: false,
    },
  ]) {
    const wire = JSON.stringify({
      reply: {
        mode: "complete",
        safety: "normal",
        sentences,
        diaryDraft,
        sourceQuote: "노력도 알아주길",
      },
    });
    const ai = new AI("gpt-6-luna", 1000, {
      fetch: async () =>
        new Response(
          [
            { type: "response.output_text.delta", delta: wire },
            {
              type: "response.completed",
              response: { status: "completed", error: null, incomplete_details: null },
            },
          ]
            .map((e) => "data: " + JSON.stringify(e) + "\n\n")
            .join("") + "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    });
    const result = ai.streamReply(
      [{ role: "user", content: message }],
      {
        emotion: selectionContext(emotion),
        forceComplete: true,
        listening: false,
        followupQuestion: false,
        turn: 3,
        previousSafety: "normal",
      },
      async () => {},
    );
    if (valid) assert.equal((await result).sentences.length, 1);
    else await assert.rejects(result);
  }
});

test("listening, uncertainty, continued exploration and diary preference do not impose a turn limit", () => {
  const progress = { turns: 4, questions: 4, completed: false };
  for (const text of ["그냥 들어줘", "잘 모르겠어", "더 살펴보고 싶어요", "기록은 안 할래"])
    assert.equal(responsePlan(progress, "chat", text, []).forceComplete, false);
  assert.equal(responsePlan(progress, "chat", "더 살펴보고 싶어요", []).followupQuestion, true);
  assert.equal(
    responsePlan(progress, "chat", "지금 끝내자", [{ role: "user", content: "기록은 안 할래" }])
      .skipDiary,
    true,
  );
});
test("only supported draft text reaches the completed receipt", async () => {
  const message = "오래 준비한 걸 알아주길 바랐어. 바로 기록해줘.";
  for (const quote of ["오래 준비한 걸", "없는 말"]) {
    const p = provider("complete");
    const draft = "나는 오래 준비한 걸 알아주길 바랐다.";
    p.ai.streamReply = async (_m, _c, publish) => {
      const reply = {
        mode: "complete" as const,
        safety: "normal" as const,
        sentences: ["준비한 시간도 알아주는 말을 바랐군요."],
        diaryDraft: draft,
        sourceQuote: quote,
      };
      await publish(reply.sentences[0], { mode: reply.mode, safety: reply.safety });
      return reply;
    };
    const result = runStreamingChat(
      { ...args(), message },
      new Gate(new LuaStore(), cap),
      p.ai,
      () => {},
    );
    if (quote === "없는 말") await assert.rejects(result, /표현을 확인/);
    else assert.equal((await result).diaryDraft, draft);
  }
});
test("declining a diary closes without a writing invitation and still allows the survey", async () => {
  const p = provider();
  p.ai.streamReply = async (_m, _c, publish) => {
    const r = {
      mode: "close" as const,
      safety: "normal" as const,
      sentences: ["이야기는 여기에서 마칠게요."],
    };
    await publish(r.sentences[0], { mode: r.mode, safety: r.safety });
    return r;
  };
  const r = await runStreamingChat(
    { ...args(), message: "기록은 안 할래. 이제 끝내자." },
    new Gate(new LuaStore(), cap),
    p.ai,
    () => {},
  );
  assert.equal(r.surveyReady, true);
  assert.equal(r.diaryDraft, null);
  assert.ok(!r.body.includes(DIARY_INVITATION));
});

test("an extra question cannot discard an already useful reflection or trigger paid regeneration", async () => {
  const p = provider();
  p.ai.streamReply = async (_m, _c, publish) => {
    const r = {
      mode: "continue" as const,
      safety: "normal" as const,
      sentences: ["친구의 답을 기다렸군요.", "어떤 말을 바랐나요? 왜 그렇게 생각하셨나요?"],
    };
    for (const t of r.sentences) await publish(t, { mode: r.mode, safety: r.safety });
    return r;
  };
  const r = await runStreamingChat(args(), new Gate(new LuaStore(), cap), p.ai, () => {});
  assert.ok(r.body.includes("친구의 답을 기다렸군요."));
  assert.ok(!r.body.includes("왜 그렇게"));
  assert.equal(r.progress.questions, 1);
  assert.equal(r.progress.completed, false);
});

test("event contrasts preserve the selection; an explicit comparison updates only the named emotion", () => {
  const initial = { ...emotion, intensityBand: "high" as const };
  assert.deepEqual(
    correctedSelection(initial, "채택 여부가 아니라 말을 끊은 상황에서 서운함이 남았어요."),
    initial,
  );
  const fixed = correctedSelection(
    initial,
    "채택 안 된 게 문제가 아니라 말을 끊었어요. 짜증보다는 서운함에 가까워요.",
  );
  assert.equal(fixed.emotionId, "neg-056");
  assert.equal(fixed.intensityBand, "unknown");
  assert.deepEqual(correctedSelection(fixed, "화가 아니라 서운해"), fixed);
});
test("a short negative answer pauses the question without ending the conversation", () => {
  const history = [
    { role: "user", content: "친구들이 결혼 이야기만 해서 외로웠어." },
    { role: "assistant", content: "그 자리에서 하고 싶었던 이야기가 있었어요?" },
  ];
  const progress = { ...freshProgress, turns: 1, questions: 1 };
  for (const text of ["없어", "딱히 없어요.", "그런 적은 없었어요"]) {
    const plan = responsePlan(progress, "chat", text, history);
    assert.equal(plan.listening, true);
    assert.equal(plan.followupQuestion, false);
    assert.equal(plan.forceComplete, false);
  }
  assert.equal(
    responsePlan(progress, "chat", "없어. 그래도 친구가 먼저 말을 걸어줬어.", history)
      .followupQuestion,
    true,
  );
});

test("output-format notes in a valid reply never reach the stream or signed history", async () => {
  const history = [
    { role: "user" as const, content: "친구들이 결혼 이야기만 해서 외로웠어." },
    { role: "assistant" as const, content: "그 자리에서 하고 싶었던 이야기가 있었어요?" },
  ];
  const clean = "하고 싶었던 이야기가 따로 있던 건 아니군요.";
  const leaked =
    "친구들이 결혼 이야기만 나눠서 소외되셨군요. :2}}ablytyped------JSON malformed question. Need natural no question. Output question string can empty. Maybe schema strict. Use continue, sentences one, question empty. Omit extraneous. Z?";
  for (const recovers of [true, false]) {
    const p = provider();
    const visible: string[] = [];
    let calls = 0;
    p.ai.streamReply = async (_messages, context, emit) => {
      assert.equal(context.listening, true);
      assert.equal(context.followupQuestion, false);
      const sentence = ++calls === 2 && recovers ? clean : leaked;
      await emit(sentence, { mode: "continue", safety: "normal" });
      return { mode: "continue", safety: "normal", sentences: [sentence] };
    };
    const result = runStreamingChat(
      {
        ...args(),
        message: "없어",
        history,
        progress: { ...freshProgress, turns: 1, questions: 1 },
      },
      new Gate(new LuaStore(), cap),
      p.ai,
      (text) => visible.push(text),
    );
    if (recovers) {
      const turn = await result;
      assert.deepEqual(visible, [clean]);
      assert.equal(turn.history.at(-1)?.content, clean);
      assert.equal(turn.progress.questions, 1);
      assert.equal(turn.progress.completed, false);
      assert.equal(turn.surveyReady, false);
    } else {
      await assert.rejects(result, /입력은 그대로/);
      assert.deepEqual(visible, []);
    }
    assert.equal(calls, 2);
  }
});

test("internal markers and nonstandard punctuation cannot escape a valid reply field", async () => {
  const p = provider();
  const visible: string[] = [];
  let calls = 0;
  p.ai.streamReply = async (_messages, _context, emit) => {
    calls++;
    const artifacts = [
      "어떤 장면이 마음에 남았나요⁇‌⁆⁇‌⁆ 까요?",
      "이 일에서 오래 기억하고 싶은 순간은 어떤 장면인가요↵:VEVENT]  vvvvv 까요?",
    ];
    const sentences = ["친구가 다시 읽어 달라고 해서 반가우셨겠어요.", artifacts[calls - 1]];
    for (const sentence of sentences) await emit(sentence, { mode: "continue", safety: "normal" });
    return { mode: "continue", safety: "normal", sentences };
  };
  await assert.rejects(
    runStreamingChat(args(), new Gate(new LuaStore(), cap), p.ai, (text) => visible.push(text)),
    /입력은 그대로/,
  );
  assert.deepEqual(visible, []);
  assert.equal(calls, 2);
});
test("a rejected attribution repair retries before showing any reply", async () => {
  const p = provider();
  let reviews = 0;
  p.ai.checkAttribution = async () => ({
    edits:
      ++reviews === 1
        ? [{ field: 0, before: "틀린 위치", after: "직접", evidence: "제가 고른" }]
        : [],
  });
  const visible: string[] = [];
  await runStreamingChat(
    { ...args(), message: "제가 고른 그림책을 아이가 다시 읽어 달라고 했어요." },
    new Gate(new LuaStore(), cap),
    p.ai,
    (text) => visible.push(text),
  );
  assert.equal(reviews, 2);
  assert.equal(p.calls.length, 2);
  assert.equal(visible.length, 2);
});
test("a positive opening keeps the speaker's action out of the chatbot's first person", async () => {
  const p = provider();
  let calls = 0;
  const visible: string[] = [];
  p.ai.streamReply = async (_messages, _context, emit) => {
    const sentences = [
      ++calls === 1 ? "제가 혼자 만드신 가방이군요." : "혼자 만드신 가방을 언니가 들고 가셨군요.",
      "어떤 점이 특히 반가웠어요?",
    ];
    for (const sentence of sentences) await emit(sentence, { mode: "continue", safety: "normal" });
    return { mode: "continue", safety: "normal", sentences };
  };
  const selected = { ...emotion, emotionId: "pos-014" };
  await runStreamingChat(
    { ...args(), emotion: selected, message: "제가 만든 가방을 언니가 들고 갔어요." },
    new Gate(new LuaStore(), cap),
    p.ai,
    (text) => visible.push(text),
  );
  assert.equal(calls, 2);
  assert.doesNotMatch(visible.join(""), /제가/);
});
test("a followup exposes only the dedicated question when a draft repeats it with a period", async () => {
  const p = provider();
  p.ai.streamReply = async (_messages, _context, emit) => {
    const sentences = [
      "전시 사진을 한 번 보여주고 싶으셨군요. 어떤 사진을 먼저 보여주고 싶으세요. 좋았던 게 뭐였어요요. 어떤 점에서 중요해요. 전시 사진을 한 번 보여주고 싶으셨군요。",
      "어떤 사진을 먼저 보여주고 싶으세요?",
    ];
    for (const sentence of sentences) await emit(sentence, { mode: "continue", safety: "normal" });
    return { mode: "continue", safety: "normal", sentences };
  };
  const turn = await runStreamingChat(
    {
      ...args(),
      message: "사진을 먼저 보여주고 싶어요.",
      history: [
        { role: "user", content: "아무도 전시에 못 왔어요." },
        { role: "assistant", content: "어떤 일이 마음에 남았나요?" },
      ],
      progress: { ...freshProgress, turns: 1, questions: 1 },
    },
    new Gate(new LuaStore(), cap),
    p.ai,
    () => {},
  );
  assert.equal(
    turn.body,
    "전시 사진을 한 번 보여주고 싶으셨군요. 어떤 사진을 먼저 보여주고 싶으세요?",
  );
});
test("a later request to write can follow listening or a declined diary", () => {
  const history = [{ role: "user", content: "지금은 기록하고 싶지 않고 그냥 들어줘." }];
  assert.equal(responsePlan(freshProgress, "chat", "응", history).skipDiary, true);
  const next = responsePlan(freshProgress, "chat", "이제는 한 문장으로 기록하고 싶어요.", history);
  assert.equal(next.listening, false);
  assert.equal(next.skipDiary, false);
  assert.equal(next.forceComplete, true);
});

test("only the reviewed action reaches the conversation, including its streamed text and history", async () => {
  const p = provider().ai;
  const a = { ...args(), message: "내가 고른 그림책을 아이가 다시 읽어 달랬어요." };
  const sentences = ["함께 고른 책을 또 읽자니 기쁘셨겠어요.", "어느 대목이 기억에 남았나요?"];
  p.streamReply = async (_messages, _context, emit) => {
    const reply = { mode: "continue" as const, safety: "normal" as const, sentences };
    for (const sentence of sentences)
      await emit(sentence, { mode: reply.mode, safety: reply.safety });
    return reply;
  };
  const visible: string[] = [];
  const checked: string[] = [];
  p.moderateOutputs = async (texts) => {
    assert.deepEqual(texts, [sentences[0], sentences.join(" ")]);
    return texts.map(() => false);
  };
  p.moderate = async (text) => {
    checked.push(text);
    return { flagged: false, categories: {} };
  };
  let checks = 0;
  p.checkAttribution = async (source, fields) => {
    checks++;
    assert.deepEqual(source, [a.message]);
    assert.deepEqual(visible, []);
    return {
      edits: fields[0].includes("함께 고른")
        ? [{ field: 0, before: "함께 고른", after: "직접 고르신", evidence: "내가 고른 그림책" }]
        : [],
    };
  };
  const result = await runStreamingChat(a, new Gate(new LuaStore(), cap), p, (d) =>
    visible.push(d),
  );
  assert.equal(checks, 2);
  assert.equal(visible.join(""), result.body);
  assert.match(result.body, /직접 고르신/);
  assert.doesNotMatch(JSON.stringify(result.history), /함께 고른/);
  assert.ok(checked.includes("직접 고르신 책을 또 읽자니 기쁘셨겠어요."));
  assert.ok(checked.includes(result.body));
});

test("a diary edit requires evidence from the user and a successful second review", async () => {
  const input = [
    { role: "assistant" as const, content: "둘이 찍었네요." },
    { role: "user" as const, content: "제가 찍고 친구가 골랐어요." },
  ];
  const reply = {
    mode: "complete" as const,
    safety: "normal" as const,
    sentences: ["사진을 남기셨군요."],
    diaryDraft: "우리가 찍은 사진을 친구가 골랐다.",
  };
  const edit = { field: 1, before: "우리가 찍은", after: "내가 찍은", evidence: "제가 찍고" };
  const ok = await preserveAttribution(input, reply, async (_s, fs) => ({
    edits: fs[1].includes("우리가") ? [edit] : [],
  }));
  assert.equal(ok.diaryDraft, "내가 찍은 사진을 친구가 골랐다.");
  await assert.rejects(
    preserveAttribution(input, reply, async () => ({
      edits: [{ ...edit, evidence: "둘이 찍었네요" }],
    })),
    /누가 한 일/,
  );
  await assert.rejects(
    preserveAttribution(input, reply, async () => ({ edits: [edit] })),
    /누가 한 일/,
  );
});

test("a brief expression of disappointment can stand alone without closing or silencing the next turn", async () => {
  const history = [
    { role: "user" as const, content: "모임이 취소됐어요." },
    { role: "assistant" as const, content: "무엇이 마음에 남았나요?" },
  ];
  const a = {
    ...args(),
    history,
    progress: { ...freshProgress, turns: 1 },
    message: "그냥 좀 서운했어요.",
  };
  const result = await runStreamingChat(a, new Gate(new LuaStore(), cap), provider().ai, () => {});
  assert.doesNotMatch(result.body, /[?？]/);
  assert.equal(result.diaryDraft, null);
  assert.equal(result.progress.completed, false);
  assert.equal(responsePlan(freshProgress, "chat", "조금 섭섭하네요.", []).openingQuestion, false);
  for (const message of ["서운했어요. 왜 그랬는지 알고 싶어요.", "서운하더라고요. 질문해 주세요."])
    assert.equal(responsePlan(result.progress, "chat", message, result.history).listening, false);
});

test("an uncertain answer pauses questions for this turn and leaves room for an explicit request", async () => {
  const history = [
    { role: "user" as const, content: "발표가 끝났는데 마음이 이상해요." },
    { role: "assistant" as const, content: "어떤 장면이 남았나요?" },
  ];
  const progress = { ...freshProgress, turns: 1, questions: 1 };
  const a = { ...args(), history, progress, message: "모르겠어요. 딱히 뭐라고 말하기 어려워요." };
  const p = provider();
  const result = await runStreamingChat(a, new Gate(new LuaStore(), cap), p.ai, () => {});
  assert.equal(p.calls[0].context.listening, true);
  assert.equal(result.body.includes("?"), false);
  assert.equal(result.surveyReady, false);
  assert.equal(
    responsePlan(result.progress, "chat", "한번 생각해 보고 싶어요.", result.history).listening,
    false,
  );
  assert.equal(
    responsePlan(progress, "chat", "모르겠어요. 어떻게 말하면 좋을까요?", history).listening,
    false,
  );
  assert.equal(
    responsePlan(progress, "chat", "잘 모르겠어요. 바로 기록해줘.", history).forceComplete,
    true,
  );
});

test("ordinary first disclosures need a question, including advice-only and diary-only refusals", async () => {
  for (const message of [
    "그냥 별로예요.",
    "다들 그냥 들어가서 저만 밖에 남았어요.",
    "조언은 싫어요.",
    "기록은 안 할래요.",
    "오래 준비한 시간을 알아주길 바랐는데 친구 답이 짧아 서운했어요.",
  ]) {
    assert.equal(responsePlan(freshProgress, "chat", message, []).openingQuestion, true);
  }
  for (const message of [
    "그냥 들어주세요.",
    "질문하지 말고 들어줘.",
    "질문 없이 듣고 싶어요.",
    "오늘은 여기까지 할게요.",
    "지금 바로 기록해줘.",
    "한 문장으로 적고 싶어요.",
    "문자 한 줄만 써 주세요.",
  ]) {
    assert.equal(responsePlan(freshProgress, "chat", message, []).openingQuestion, false, message);
  }
  const gate = new Gate(new LuaStore(), cap),
    a = args();
  for (const mode of ["complete", "close"]) {
    await assert.rejects(
      runStreamingChat({ ...a, rid: id() }, gate, provider(mode).ai, () =>
        assert.fail("premature closing text"),
      ),
      /대화를 이어갈 답변/,
    );
  }
  const result = await runStreamingChat({ ...a, rid: id() }, gate, provider().ai, () => {});
  assert.equal(result.progress.completed, false);
  assert.equal(result.surveyReady, false);
  assert.equal(result.progress.questions, 1);
});
test("a malformed opening is retryable without inventing a generic question", async () => {
  const p = provider();
  p.ai.streamReply = async (_i, _c, emit) => {
    const reply = {
      mode: "continue" as const,
      safety: "normal" as const,
      sentences: ["그 말이 마음에 남았군요.", "무엇을 기대했고 어떻게 느끼셨나요?"],
    };
    for (const text of reply.sentences)
      await emit(text, { mode: reply.mode, safety: reply.safety });
    return reply;
  };
  await assert.rejects(
    runStreamingChat(args(), new Gate(new LuaStore(), cap), p.ai, () => {}),
    /다음 질문/,
  );
});
test("the opening SDK contract streams reflection before its required question and excludes closing modes", async () => {
  process.env.OPENAI_API_KEY = "offline-http-stream-test";
  const lines = ["그 말이 마음에 남았군요.", "어떤 한마디가 듣고 싶었나요?"];
  const selections = [
    ...intensityBands.map(({ id }) => ({ ...emotion, intensityBand: id })),
    { ...emotion, emotionId: "pos-014" },
  ];
  for (const selection of selections) {
    const context = {
      emotion: selectionContext(selection),
      openingQuestion: true,
      forceComplete: false,
      listening: false,
      turn: 1,
      previousSafety: "normal" as const,
    };
    const ai = new AI("gpt-6-luna", 1000, {
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        const branches = request.text.format.schema.properties.reply.anyOf;
        assert.deepEqual(
          branches.map((b: any) => b.properties.mode.const),
          ["safety", "refusal", "continue"],
        );
        assert.ok(branches.at(-1).required.includes("question"));
        if (context.emotion.category === "positive") {
          const questionPattern = new RegExp(branches.at(-1).properties.question.pattern);
          assert.ok(questionPattern.test("어떤 순간이 가장 좋았나요?"));
          assert.equal(questionPattern.test("그 순간 어떤 마음이 들？"), false);
        }
        const state = JSON.parse(request.instructions.split("검증된 현재 상태(JSON 데이터): ")[1]);
        const { responseGuidance: _guidance, ...selectedEmotion } = context.emotion;
        assert.deepEqual(state.emotion, selectedEmotion);
        assert.ok(
          request.instructions.startsWith(
            BRIEF_PROMPT + "\n\n" + REFLECTION_GOALS + "\n\n[앱 연동 규칙]",
          ),
        );
        const wire = JSON.stringify({
          reply: { mode: "continue", safety: "normal", sentences: [lines[0]], question: lines[1] },
        });
        const events = [
          ...Array.from(wire, (delta) => ({ type: "response.output_text.delta", delta })),
          {
            type: "response.completed",
            response: { status: "completed", error: null, incomplete_details: null },
          },
        ];
        return new Response(
          events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    const shown: string[] = [];
    const reply = await ai.streamReply(
      [{ role: "user", content: "친구의 답장이 짧았어요." }],
      context,
      async (text) => {
        shown.push(text);
      },
    );
    assert.deepEqual(shown, lines);
    assert.deepEqual(reply.sentences, shown);
  }
});

test("connection, timeout, validation and upstream errors give readable recovery messages", async () => {
  assert.match(chatErrorMessage(new TypeError("Failed to fetch")), /연결이 잠시 끊겼/);
  assert.match(chatErrorMessage(new DOMException("timed out", "TimeoutError")), /시간이 길어/);
  for (const [status, pattern] of [
    [429, /요청이 잠시/],
    [400, /입력 내용/],
    [503, /대화 연결/],
  ] as const) {
    const err = await failedChatRequest(new Response("Bad gateway", { status }));
    assert.match(chatErrorMessage(err), pattern);
  }
  assert.doesNotMatch(
    chatErrorMessage(new SyntaxError("Unexpected token")),
    /Unexpected|SyntaxError/,
  );
});
test("ordinary replies keep the conversation open through a wish, an insight and another turn", async () => {
  const gate = new Gate(new LuaStore(), cap),
    base = args(),
    p = provider();
  let state = { ...base, history: [] as { role: "assistant" | "user"; content: string }[] };
  for (const message of [
    "회의에서 제 말을 끊어서 서운했어요.",
    "다음에는 집에 가서 일기를 쓰고 싶어요.",
    "하루를 돌아보면 제가 뭘 원했는지 좀 알 것 같아요.",
    "아직 하나 더 생각나는 게 있어요.",
  ]) {
    const request = { ...state, message, rid: id() };
    await assert.rejects(
      runStreamingChat(request, gate, provider("complete").ai, () =>
        assert.fail("unrequested ending"),
      ),
      /대화를 이어갈 답변/,
    );
    request.rid = id();
    const reply = await runStreamingChat(request, gate, p.ai, () => {});
    assert.equal(reply.progress.completed, false);
    assert.equal(reply.surveyReady, false);
    assert.equal(reply.diaryDraft, null);
    assert.equal(reply.progress.questions, state.progress.questions + 1);
    await gate.acknowledge(base.sid, base.cid, request.rid, reply.revision);
    state = {
      ...state,
      history: reply.history,
      progress: reply.progress,
      revision: reply.revision,
    };
  }
  const finish = await runStreamingChat(
    { ...state, message: "지금 정리해 주세요.", rid: id() },
    gate,
    p.ai,
    () => {},
  );
  assert.equal(finish.progress.completed, true);
  assert.equal(finish.surveyReady, true);
});

test("asking what our question means rephrases it without starting a diary", () => {
  const history = [
    { role: "user", content: "집에 온 뒤 친구가 불편했다고 했어요." },
    { role: "assistant", content: "친구에게 어떤 반응을 바랐나요?" },
  ];
  const progress = { ...freshProgress, turns: 4, questions: 4 };
  for (const message of [
    "무슨 반응?",
    "어떤 반응을 말하는 거예요",
    "그게 무슨 뜻이에요?",
    "다시 물어봐 주세요",
    "그날 나는 몰랐다고 답했어. 근데 무슨 반응이냐는 말은 무슨 뜻이야?",
    "무슨 대답을 기대했냐는 게 무슨 뜻이에요?",
  ]) {
    const plan = responsePlan(progress, "chat", message, history);
    assert.equal(plan.clarifyQuestion, true, message);
    assert.equal(plan.followupQuestion, true);
    assert.equal(plan.mayReflect, false);
  }
  for (const message of [
    "무슨 반응인지 친구한테 물어봤어요.",
    "어떻게 반응해야 돼?",
    "무슨 뜻인지 이제 알겠어요.",
  ]) {
    assert.equal(responsePlan(progress, "chat", message, history).clarifyQuestion, false);
  }
  assert.equal(responsePlan(freshProgress, "chat", "무슨 반응?", []).clarifyQuestion, false);
});
test("clarifying an expectation introduced by the assistant does not ask for the same wish again", async () => {
  const history = [
    { role: "user" as const, content: "친구가 집에 온 뒤에 불편했다고 했어요." },
    { role: "assistant" as const, content: "친구에게 어떤 반응을 기대했나요?" },
  ];
  const { ai } = provider();
  ai.reviewReadiness = async () => assert.fail("clarification must not start a diary review");
  ai.streamReply = async (_messages, _context, emit) => {
    const sentences = ["제가 어렵게 물었네요.", "친구가 무슨 말을 해주길 바랐나요?"];
    for (const s of sentences) await emit(s, { mode: "continue", safety: "normal" });
    return { mode: "continue", safety: "normal", sentences };
  };
  const response = await runStreamingChat(
    { ...args(), history, message: "무슨 반응?", progress: { ...freshProgress, turns: 3 } },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.match(response.body, /대화가 더 이어졌어요\?/);
  assert.equal(response.progress.completed, false);
  assert.equal(response.diaryDraft, null);
  assert.equal(
    responsePlan(freshProgress, "chat", "무슨 반응?", [
      { role: "user", content: "저는 사과를 바랐어요." },
      history[1],
    ]).assumedReply,
    false,
  );
});
test("a work story rejects questions about progress while requests for practical help can be answered", async () => {
  const p = provider();
  const visible: string[] = [];
  let attempts = 0;
  p.ai.streamReply = async (_messages, context, emit) => {
    assert.equal(context.openingQuestion, true);
    const sentences = [
      "일이 몰린 하루가 버거우셨겠어요.",
      ++attempts === 1
        ? "프로젝트를 어디까지 끝내야 하나요?"
        : "일하다 유난히 버겁다고 느낀 순간이 있었어요?",
    ];
    for (const sentence of sentences) await emit(sentence, { mode: "continue", safety: "normal" });
    return { mode: "continue", safety: "normal", sentences };
  };
  const result = await runStreamingChat(
    { ...args(), message: "회사 프로젝트가 바빠서 힘들었어." },
    new Gate(new LuaStore(), cap),
    p.ai,
    (text) => visible.push(text),
  );
  assert.equal(attempts, 2);
  assert.equal(result.progress.completed, false);
  assert.doesNotMatch(visible.join(""), /어디까지/);
  const request = responsePlan(freshProgress, "chat", "프로젝트 일정을 짜 주세요.", []);
  assert.equal(request.asksForPracticalHelp, true);
  assert.equal(request.workReflection, false);
  assert.equal(request.openingQuestion, false);
});

test("a worry about a work mistake is a thought to check, with no automatic close", async () => {
  const p = provider();
  const message = "제가 하나라도 놓치면 다 꼬일 것 같아서 퇴근하고도 메시지를 확인했어요.";
  p.ai.reviewReadiness = async () => ({
    wish: "",
    meaning: "",
    confirmedMeaning: "",
    reaction: message,
    insight: message,
    next: "diary",
  });
  await runStreamingChat(
    {
      ...args(),
      progress: { ...freshProgress, turns: 2, questions: 2 },
      history: [
        { role: "user", content: "회사 프로젝트 때문에 힘들었어요." },
        { role: "assistant", content: "언제 마음이 급해졌어요?" },
        { role: "user", content: "요청이 한꺼번에 왔을 때요." },
        { role: "assistant", content: "어떤 생각이 스쳤어요?" },
      ],
      message,
    },
    new Gate(new LuaStore(), cap),
    p.ai,
    () => {},
  );
  assert.equal(p.calls[0].context.reflectionStep, "fact");
  assert.equal(p.calls[0].context.forceComplete, false);
});
test("an explicit personal insight can finish without a separately stated wish", async () => {
  const p = provider();
  p.ai.reviewReadiness = async () => ({
    wish: "",
    meaning: "",
    confirmedMeaning: "",
    reaction: "일이 많아서만이 아니라 혼자 책임져야 한다는 생각 때문에 더 힘들었구나.",
    insight: "일이 많아서만이 아니라 혼자 책임져야 한다는 생각 때문에 더 힘들었구나.",
    next: "diary",
  });
  p.ai.streamReply = async (_messages, context, emit) => {
    assert.equal(context.forceComplete, true);
    const sentence = "혼자 책임져야 한다는 생각이 힘을 더 들게 했다는 걸 알아차리셨군요.";
    await emit(sentence, { mode: "complete", safety: "normal" });
    return {
      mode: "complete",
      safety: "normal",
      sentences: [sentence],
      sourceQuote: "혼자 책임져야 한다는 생각 때문에",
      diaryDraft: "퇴근 후에도 업무 메시지를 확인했구나.",
    };
  };
  const result = await runStreamingChat(
    {
      ...args(),
      progress: { ...freshProgress, turns: 2, questions: 2 },
      history: [
        { role: "user", content: "회사 프로젝트가 바빠서 힘들었어." },
        { role: "assistant", content: "일을 하다 유난히 힘든 순간이 있었어요?" },
        { role: "user", content: "제가 놓치면 다 꼬일 것 같았어요." },
        { role: "assistant", content: "실제로 혼자 맡아야 했던 건가요?" },
      ],
      message: "일이 많아서만이 아니라 혼자 책임져야 한다는 생각 때문에 더 힘들었구나.",
    },
    new Gate(new LuaStore(), cap),
    p.ai,
    () => {},
  );
  assert.equal(result.progress.completed, true);
  assert.equal(result.surveyReady, true);
  assert.equal(
    result.diaryDraft,
    "일이 많아서만이 아니라 혼자 책임져야 한다는 생각 때문에 더 힘들었구나.",
  );
});
test("automatic diary waits for grounded meaning and uses the response when available", async () => {
  const history = [
    { role: "user" as const, content: "끝까지 들어줬으면 했어." },
    { role: "assistant" as const, content: "말을 끊으면 어떤 기분이 들었어요?" },
    { role: "user" as const, content: "무시당한 기분이 드니까." },
    { role: "assistant" as const, content: "그럴 때는 말을 이어가나요?" },
  ];
  for (const grounded of [false, true]) {
    const { ai } = provider();
    const reaction = grounded ? "멈추게 돼" : "소리를 질러";
    ai.reviewReadiness = async () => ({
      wish: "끝까지 들어줬으면",
      meaning: grounded ? "무시당한 기분" : "",
      confirmedMeaning: "",
      reaction: grounded ? "어떻게 반응하세요?에 대한 답: " + reaction : reaction,
      insight: "",
      next: "diary",
    });
    const ordinary = ai.streamReply;
    ai.streamReply = async (messages, context, emit) => {
      if (!context.forceComplete) return ordinary(messages, context, emit);
      const sentence = "말을 끊기면 무시당한 기분에 멈추게 되시는군요.";
      await emit(sentence, { mode: "complete", safety: "normal" });
      return {
        mode: "complete",
        safety: "normal",
        sentences: [sentence],
        sourceQuote: "멈추게 돼",
        diaryDraft:
          "말이 끊기면 무시당한 느낌에 멈추게 되고, 내 말을 끝까지 들어주는 게 중요하구나.",
      };
    };
    const reply = await runStreamingChat(
      {
        ...args(),
        history,
        message: "멈추게 돼",
        progress: { ...freshProgress, turns: 2, questions: 2 },
      },
      new Gate(new LuaStore(), cap),
      ai,
      () => {},
    );
    assert.equal(reply.progress.completed, grounded);
    assert.equal(reply.surveyReady, grounded);
    assert.equal(Boolean(reply.diaryDraft), grounded);
  }
});
test("an affirmed deeper meaning is recorded and a surface-only draft is regenerated", async () => {
  const history = [
    { role: "user" as const, content: "친구가 사과했으면 했어요. 축사를 쓰려고 고민했거든요." },
    {
      role: "assistant" as const,
      content: "친구를 위해 들인 시간과 진심을 소중하게 대해주길 바랐던 걸까요?",
    },
  ];
  const { ai } = provider();
  ai.reviewReadiness = async () => ({
    wish: "사과했으면",
    meaning: "",
    confirmedMeaning: "들인 시간과 진심을 소중하게 대해주길",
    reaction: "",
    insight: "",
    next: "diary",
  });
  const shallow = "친구가 사과했으면 좋았겠구나.";
  const discovery =
    "사과를 바란 건 축사를 준비하며 들인 내 진심을 소중하게 대해주길 바랐기 때문이구나.";
  ai.checkAttribution = async (_statements, fields, diaryIndex) => {
    assert.equal(diaryIndex, null);
    assert.equal(fields.length, 1);
    return { edits: [] };
  };
  ai.reviewDiary = async (_segment, evidence, draft) => {
    assert.equal(evidence.confirmedMeaning, "들인 시간과 진심을 소중하게 대해주길");
    return draft === shallow ? "surface" : "grounded";
  };
  ai.streamReply = async (_messages, context, emit) => {
    const heard = context.diaryFeedback === "surface";
    const sentence = heard ? "축사에 마음을 쏟으셨군요." : "사과를 바랐다고 하셨군요.";
    assert.equal(context.forceComplete, true);
    await emit(sentence, { mode: "complete", safety: "normal" });
    return {
      mode: "complete",
      safety: "normal",
      sentences: [sentence],
      sourceQuote: "사과했으면",
      diaryDraft: heard ? discovery : shallow,
    };
  };
  const result = await runStreamingChat(
    {
      ...args(),
      history,
      message: "응. 내가 마음 쓴 것까지 별일 아닌 것처럼 넘어가서 서운했어요.",
      progress: { ...freshProgress, turns: 1, questions: 1 },
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.doesNotMatch(result.body, /사과를 바랐다고 하셨군요/);
  assert.equal(result.diaryDraft, discovery);
  assert.equal(result.surveyReady, true);
});
test("a typed diary request uses previously confirmed meaning and removes only the request", async () => {
  const history = [
    { role: "user" as const, content: "친구가 사과했으면 했어요." },
    {
      role: "assistant" as const,
      content: "사과를 들으면 서운한 일을 편하게 꺼낼 수 있다는 안심이 들었을까요?",
    },
    { role: "user" as const, content: "네. 그게 맞아요. 아직 조금 더 말하고 싶어요." },
    { role: "assistant" as const, content: "더 이야기하셔도 괜찮아요." },
  ];
  const { ai } = provider();
  ai.reviewReadiness = async (input) => {
    assert.deepEqual(input, history);
    return {
      wish: "사과했으면",
      meaning: "",
      confirmedMeaning: "",
      reaction: "",
      insight: "",
      next: "meaning",
    };
  };
  const discovery =
    "사과를 바랐던 건 서운한 일을 편하게 말할 수 있다는 안심이 필요했기 때문이구나.";
  ai.streamReply = async (_messages, context, emit) => {
    assert.equal(context.forceComplete, true);
    assert.equal(context.diaryEvidence?.confirmedMeaning, history[1].content);
    const sentence = "친구의 사과를 바라셨군요.";
    await emit(sentence, { mode: "complete", safety: "normal" });
    return {
      mode: "complete",
      safety: "normal",
      sentences: [sentence],
      sourceQuote: "사과했으면",
      diaryDraft: discovery,
    };
  };
  const progress = { ...freshProgress, turns: 2, questions: 1 };
  assert.equal(
    responsePlan(
      progress,
      "chat",
      "그 마음을 편하게 말하고 싶었어요. 다이어리에 한 줄로 적어줘.",
      history,
    ).recordStory,
    "그 마음을 편하게 말하고 싶었어요.",
  );
  assert.equal(
    responsePlan(progress, "chat", "내일 다이어리 한 줄로 써 주세요.", history).recordStory,
    null,
  );
  const result = await runStreamingChat(
    { ...args(), history, message: "다이어리 한 줄로 써 주세요.", progress },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(result.diaryDraft, discovery);
  assert.equal(result.surveyReady, true);
});
test("a proposed meaning does not become a diary entry after rejection or uncertainty", async () => {
  for (const message of [
    "아니요. 그 뜻은 아니에요.",
    "응, 그렇진 않아요.",
    "네, 그런 뜻은 아니었어요.",
    "재밌었을 것 같아요.",
  ]) {
    const { ai } = provider();
    ai.reviewReadiness = async () => ({
      wish: "같이 놀고 싶었어요",
      meaning: "",
      confirmedMeaning: "함께하고 싶은 소중한 사람이라는 느낌",
      reaction: "",
      insight: "",
      next: "diary",
    });
    ai.reviewDiary = async () => assert.fail("unconfirmed meaning must not produce a diary");
    const result = await runStreamingChat(
      {
        ...args(),
        history: [
          { role: "user", content: "친구와 같이 놀고 싶었어요." },
          { role: "assistant", content: "같이 놀면 뭐가 달랐을 것 같아요?" },
          { role: "user", content: "재밌었을 것 같아요." },
          { role: "assistant", content: "함께하고 싶은 소중한 사람이라는 느낌이 필요했을까요?" },
        ],
        message,
        progress: { ...freshProgress, turns: 2, questions: 2 },
      },
      new Gate(new LuaStore(), cap),
      ai,
      () => {},
    );
    assert.equal(result.diaryDraft, null);
    assert.equal(result.surveyReady, false);
  }
});
test("a short feeling does not invite an extra answer when the model omits the question mark", async () => {
  const { ai } = provider();
  ai.streamReply = async (_messages, context, emit) => {
    assert.equal(context.listening, true);
    const header = { mode: "continue" as const, safety: "normal" as const };
    const sentences = [
      "약속이 취소돼서 조금 서운하셨군요.",
      "그때 친구에게 어떤 말이나 행동을 바랐어요",
    ];
    for (const sentence of sentences) await emit(sentence, header);
    return { ...header, sentences };
  };
  const result = await runStreamingChat(
    {
      ...args(),
      history: [
        { role: "user", content: "친구와의 약속이 취소됐어요." },
        { role: "assistant", content: "어떤 점이 마음에 남았어요?" },
      ],
      progress: { ...freshProgress, turns: 1, questions: 1 },
      message: "그냥 좀 서운했어요.",
    },
    new Gate(new LuaStore(), cap),
    ai,
    () => {},
  );
  assert.equal(result.body, "약속이 취소돼서 조금 서운하셨군요.");
  assert.equal(result.progress.questions, 1);
});
test("immediate endings and ordinary reluctance are separate intentions", () => {
  for (const value of [
    "바로 끝내줘",
    "오늘은 이만 마무리해 주세요.",
    "지금 일기를 써 줄래요?",
    "이유는 아직 모르겠고 오늘은 여기까지 할래요",
    "대화를 끝내 주세요.",
  ])
    assert.equal(responsePlan(freshProgress, "chat", value, []).forceComplete, true);
  for (const value of [
    "끝내고 싶지 않아요",
    "조언은 싫어요",
    "기록은 거절할게요",
    "일기를 쓰고 싶어요.",
    "다음에 기록해 주세요.",
    "지금은 그냥 집에 가고 싶어요.",
    "더 이야기하고 싶어요",
  ])
    assert.equal(responsePlan(freshProgress, "chat", value, []).forceComplete, false);
});

test("a question ending in a period in the first reflection does not repeat the dedicated question", async () => {
  const p = provider().ai;
  p.streamReply = async (_input, _context, emit) => {
    const reply = {
      mode: "continue" as const,
      safety: "normal" as const,
      sentences: [
        "그 말을 직접 들으셨군요. 지금 바라는 대우는 무엇인가요.",
        "지금 바라는 대우는 무엇인가요?",
      ],
    };
    for (const text of reply.sentences)
      await emit(text, { mode: reply.mode, safety: reply.safety });
    return reply;
  };
  const r = await runStreamingChat(args(), new Gate(new LuaStore(), cap), p, () => {});
  assert.equal(r.body, "그 말을 직접 들으셨군요. 지금 바라는 대우는 무엇인가요?");
});
