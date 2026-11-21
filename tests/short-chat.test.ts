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
} from "../lib/emotions";
import { freshProgress, responsePlan } from "../lib/conversation";
import { ReplyFields } from "../lib/server/stream-fields";
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
  const early = await runStreamingChat(
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
  assert.equal(early.progress.completed, false);
  assert.equal(early.surveyReady, false);
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
      exploring: false,
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
  const completion = modes.find(
    (branch: { properties: { mode: { const: string } } }) =>
      branch.properties.mode.const === "complete",
  );
  assert.deepEqual(Object.keys(completion.properties).slice(0, 3), ["mode", "safety", "sentences"]);
  assert.ok(completion.required.includes("sourceQuote"));
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
  const a = { ...args(), progress: { turns: 2, questions: 2, completed: false } };
  let emitted = "";
  await assert.rejects(
    runStreamingChat(a, new Gate(new LuaStore(), cap), p.ai, (t) => (emitted += t)),
    /질문 없는/,
  );
  assert.equal(emitted, "");
  assert.equal(a.progress.turns, 2);
});
test("SDK treats failed, incomplete, refusal and missing terminal streams as failures", async () => {
  const context = {
    emotion: selectionContext(emotion),
    forceComplete: true,
    listening: false,
    exploring: false,
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
  const low = selectionContext({ ...emotion, intensityBand: "0_20" }),
    high = selectionContext({ ...emotion, intensityBand: "80_100" }),
    joy = selectionContext({
      ...emotion,
      emotionId: emotionCatalog.find((e) => e.label === "기쁨")!.id,
      intensityBand: "80_100",
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
        exploring: false,
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
  assert.equal(responsePlan(progress, "chat", "더 살펴보고 싶어요", []).exploring, true);
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
  const initial = { ...emotion, intensityBand: "60_80" as const };
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
test("a later request to write can follow listening or a declined diary", () => {
  const history = [{ role: "user", content: "지금은 기록하고 싶지 않고 그냥 들어줘." }];
  assert.equal(responsePlan(freshProgress, "chat", "응", history).skipDiary, true);
  const next = responsePlan(freshProgress, "chat", "이제는 한 문장으로 기록하고 싶어요.", history);
  assert.equal(next.listening, false);
  assert.equal(next.skipDiary, false);
  assert.equal(next.forceComplete, true);
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
      /첫 답변/,
    );
  }
  const result = await runStreamingChat({ ...a, rid: id() }, gate, provider().ai, () => {});
  assert.equal(result.progress.completed, false);
  assert.equal(result.surveyReady, false);
  assert.equal(result.progress.questions, 1);
});
test("a compound question removed from an opening still leaves exactly one answerable question", async () => {
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
  const result = await runStreamingChat(args(), new Gate(new LuaStore(), cap), p.ai, () => {});
  assert.equal(result.progress.questions, 1);
  assert.match(result.body, /^그 말이 마음에 남았군요\..+\?$/);
  assert.doesNotMatch(result.body, /무엇을 기대/);
  assert.equal(result.surveyReady, false);
});
test("the opening SDK contract streams reflection before its required question and excludes closing modes", async () => {
  process.env.OPENAI_API_KEY = "offline-http-stream-test";
  const lines = ["그 말이 마음에 남았군요.", "그때 어떤 한마디가 듣고 싶었나요?"];
  for (const intensityBand of intensityBands) {
    const context = {
      emotion: selectionContext({ ...emotion, intensityBand: intensityBand.id }),
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
        const state = JSON.parse(request.instructions.split("검증된 현재 상태(JSON 데이터): ")[1]);
        assert.deepEqual(state.emotion, context.emotion);
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
test("a spontaneous diary can be edited while the next message uses the same open session", async () => {
  const gate = new Gate(new LuaStore(), cap),
    base = args(),
    p = provider();
  let first = await runStreamingChat(base, gate, p.ai, () => {});
  await gate.acknowledge(base.sid, base.cid, base.rid, first.revision);
  const second = {
    ...base,
    progress: first.progress,
    history: first.history,
    revision: first.revision,
    rid: id(),
    message: "일정을 미리 알려줬으면 했어요.",
  };
  const model = provider().ai;
  model.streamReply = async (_m, _c, emit) => {
    const sentence = "일정을 조정할 시간을 원하셨군요.";
    await emit(sentence, { mode: "complete", safety: "normal" });
    return {
      mode: "complete",
      safety: "normal",
      sentences: [sentence],
      diaryDraft: "나는 일정을 미리 알고 싶었다.",
      sourceQuote: "미리 알려줬으면",
    };
  };
  const offered = await runStreamingChat(second, gate, model, () => {});
  assert.ok(offered.diaryDraft);
  assert.ok(offered.body.endsWith(DIARY_INVITATION));
  assert.equal(offered.progress.completed, false);
  assert.equal(offered.surveyReady, false);
  await gate.acknowledge(base.sid, base.cid, second.rid, offered.revision);
  const next = await runStreamingChat(
    {
      ...second,
      history: offered.history,
      progress: offered.progress,
      revision: offered.revision,
      rid: id(),
      message: "친구가 아니라 동료였어요.",
    },
    gate,
    p.ai,
    () => {},
  );
  assert.equal(next.progress.turns, 3);
  assert.equal(next.progress.completed, false);
});
