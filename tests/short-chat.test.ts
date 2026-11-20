import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emotionCatalog,
  searchEmotions,
  unknownEmotion,
  emotionSelectionSchema,
  correctedSelection,
  selectionContext,
} from "../lib/emotions";
import { freshProgress, responsePlan } from "../lib/conversation";
import { ReplyFields } from "../lib/server/stream-fields";
import { readChatStream } from "../lib/browser/chat-stream";
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
  intensityBand: "60_80" as const,
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
test("bands and unknown are categorical; corrections reset intensity and respect latest speech", () => {
  for (const intensityBand of ["0_20", "20_40", "40_60", "60_80", "80_100", "unknown"])
    assert.ok(emotionSelectionSchema.safeParse({ ...emotion, intensityBand }).success);
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
test("three turns carry full ordered context and current emotion; signed completion is required to continue", async () => {
  const db = new LuaStore(),
    gate = new Gate(db, cap),
    p = provider();
  let a: any = args();
  for (let i = 0; i < 3; i++) {
    const chunks: string[] = [];
    const r = await runStreamingChat(a, gate, p.ai, (s) => chunks.push(s));
    assert.equal(r.progress.completed, i === 2);
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
      emotion: { ...emotion, intensityBand: "20_40", version: 2 },
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
  assert.equal(continued.history.length, 8);
  await assert.rejects(
    runStreamingChat({ ...args(), action: "continue" }, gate, p.ai, () => {}),
    /먼저 마무리/,
  );
});
test("early completion, do-not-know, listening and explicit ending never require another question", async () => {
  for (const message of ["정리해줘", "그만할래", "모르겠어", "그냥 들어줘", "조언은 싫어요"]) {
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
  const early = await runStreamingChat(
    args(),
    new Gate(new LuaStore(), cap),
    provider("complete").ai,
    () => {},
  );
  assert.equal(early.progress.completed, true);
  assert.equal(
    responsePlan({ turns: 1, questions: 1, completed: false }, "chat", "응", []).forceComplete,
    false,
  );
});
test("high emotion alone is never a crisis; actual low-intensity danger bypasses normal counters", async () => {
  const positive = {
    ...emotion,
    emotionId: emotionCatalog.find((e) => e.label === "기쁨")!.id,
    intensityBand: "80_100" as const,
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
      emotion: { ...emotion, intensityBand: "0_20" },
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
    emotion,
  };
  let visible = "";
  const result = await readChatStream(
    ndjson([{ type: "text", requestId, delta: text }, done]),
    requestId,
    (t) => (visible = t),
  );
  assert.equal(visible, text);
  assert.equal(result.completed, true);
  await assert.rejects(
    readChatStream(ndjson([{ type: "text", requestId, delta: text }]), requestId, () => {}),
    /끊겼/,
  );
  await assert.rejects(
    readChatStream(
      ndjson([{ type: "error", requestId, error: "시험용 429" }]),
      requestId,
      () => {},
    ),
    /429/,
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
      ...Array.from(JSON.stringify(object)).map((delta) => ({
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
      remainingQuestions: 2,
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
  assert.equal(calls[0].reasoning.effort, "minimal");
  assert.ok(!calls[0].instructions.includes("긍정 감정: 57"));
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
test("third-turn question is blocked and the old history and signed progress remain retryable", async () => {
  const p = provider();
  p.ai.streamReply = async (_i, _c, publish) => {
    await publish("왜 그런가요?", { mode: "complete", safety: "normal" });
    return { mode: "complete", safety: "normal", sentences: ["왜 그런가요?"] };
  };
  const a = { ...args(), progress: { turns: 2, questions: 2, completed: false } };
  let emitted = "";
  await assert.rejects(
    runStreamingChat(a, new Gate(new LuaStore(), cap), p.ai, (t) => (emitted += t)),
    /질문 없는/,
  );
  assert.equal(emitted, "");
  assert.equal(a.progress.turns, 2);
});
