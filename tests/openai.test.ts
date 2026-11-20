import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AI } from "../lib/server/openai";
import { runChat } from "../lib/server/chat";
import { Gate } from "../lib/server/limits";
import { AppError } from "../lib/server/errors";
import { LuaStore } from "./store";
process.env.OPENAI_API_KEY = "offline-http-transport-test-key";
const cap = { minute: 20, day: 60, global: 300 };
const args = () => ({
  sid: "offline-sdk",
  cid: randomUUID(),
  rid: randomUUID(),
  revision: 0,
  safety: "normal" as const,
  stage: "emotion",
  history: [],
  message: "오늘 발표가 마음처럼 되지 않았어요",
  summary: false,
});
const route = {
  safety: "normal",
  harmfulRequest: false,
  noQuestions: false,
  safetyResolved: false,
};
const reply = {
  body: "발표가 마음처럼 되지 않아 속상하셨겠어요.",
  question: "가장 마음에 남는 장면은 무엇인가요?",
  stage: "thought",
  safety: "normal",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const envelope = (body: unknown, patch: Record<string, unknown> = {}) => ({
  id: "resp_offline",
  object: "response",
  status: "completed",
  error: null,
  incomplete_details: null,
  output: [
    {
      id: "msg_offline",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify(body), annotations: [] }],
    },
  ],
  ...patch,
});
function fixture() {
  const calls: { path: string; body: Record<string, any> }[] = [];
  const transport: typeof fetch = async (input, init) => {
    assert.ok(init?.signal);
    const path = new URL(String(input)).pathname,
      body = JSON.parse(String(init?.body));
    calls.push({ path, body });
    if (path.endsWith("moderations"))
      return json({ results: [{ flagged: false, categories: { "self-harm/intent": false } }] });
    const name = body.text.format.name;
    const listening = body.input.at(-1)?.content.includes("질문");
    return json(
      envelope(
        name === "routing"
          ? route
          : name === "coach_reply"
            ? { ...reply, ...(listening ? { question: null, stage: "listen" } : {}) }
            : { verdict: "allow" },
      ),
    );
  };
  return { calls, transport };
}

test("summary generation and review use user statements without treating previous AI guesses as facts", async () => {
  const calls: Record<string, any>[] = [];
  const transport: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return json(
      envelope(
        body.text.format.name === "diary_excerpt"
          ? {
              situation: "발표가 마음처럼 되지 않아",
              feeling: "속상해요.",
              thought: null,
              need: null,
            }
          : { verdict: "allow" },
      ),
    );
  };
  const ai = new AI("gpt-5-nano", 1000, { fetch: transport });
  const input = [
    { role: "user" as const, content: "발표가 마음처럼 되지 않아 속상해요." },
    { role: "assistant" as const, content: "휴식이 필요하셨군요. 가족의 도움이 있었나요?" },
    { role: "user" as const, content: "제가 말한 내용만 정리해 주세요." },
  ];
  const summary = await ai.generate(input, true, "diary", true);
  await ai.audit(input, summary.body, true);
  assert.deepEqual(
    calls[0].input,
    input.filter((m) => m.role === "user"),
  );
  assert.deepEqual(calls[1].input, [
    ...calls[0].input,
    { role: "assistant", content: summary.body },
  ]);
  assert.equal(JSON.stringify(calls.map((c) => c.input)).includes("가족"), false);
  const hallucinated: typeof fetch = async () =>
    json(envelope({ situation: null, feeling: "속상해요.", thought: null, need: "가족의 도움" }));
  const partial = await new AI("gpt-5-nano", 1000, { fetch: hallucinated }).generate(
    input,
    true,
    "diary",
    true,
  );
  assert.doesNotMatch(partial.body, /가족/);
  assert.match(partial.body, /필요했던 도움: ___/);
  assert.match(partial.body, /속상해요/);
});
test("real OpenAI SDK runs input moderation, routing, generation, output moderation and audit in order", async () => {
  const f = fixture(),
    a = args(),
    db = new LuaStore();
  const gate = new Gate(db, cap);
  const result = await runChat(a, gate, new AI(" gpt-5-nano ", 1000, { fetch: f.transport }));
  assert.equal(result.notice, false);
  assert.match(result.body, /발표/);
  assert.deepEqual(
    f.calls.map((c) => (c.path.endsWith("moderations") ? "moderation" : c.body.text.format.name)),
    ["moderation", "routing", "coach_reply", "moderation", "output_review"],
  );
  for (const call of f.calls.filter((c) => c.path.endsWith("responses"))) {
    assert.equal(call.body.model, "gpt-5-nano");
    assert.equal(call.body.store, false);
    assert.equal(call.body.service_tier, "default");
    assert.deepEqual(call.body.reasoning, { effort: "minimal" });
    assert.equal(call.body.text.format.strict, true);
    assert.equal(call.body.max_output_tokens, 1000);
    assert.equal(call.body.input[0].role, "user");
    assert.equal(call.body.input[0].content, a.message);
    assert.equal(call.body.stream, undefined);
  }
  const next = {
    ...a,
    rid: randomUUID(),
    revision: result.revision,
    safety: result.safety,
    stage: result.stage,
    history: result.history,
    message: "질문은 하지 말고 잠깐 들어주세요",
  };
  const continued = await runChat(next, gate, new AI("gpt-5-nano", 1000, { fetch: f.transport }));
  const generation = f.calls.filter((c) => c.body.text?.format.name === "coach_reply").at(-1)!;
  assert.deepEqual(generation.body.input, [
    ...result.history,
    { role: "user", content: next.message },
  ]);
  assert.match(generation.body.instructions, /현재 단계: thought/);
  assert.match(generation.body.instructions, /질문 금지: true/);
  assert.equal(continued.history.length, 4);
  assert.equal(continued.revision, 2);
  assert.equal(continued.notice, false);
  assert.equal(continued.stage, "listen");
  assert.doesNotMatch(continued.body, /\?/);
});
test("SDK rejection, truncated output, malformed JSON and invalid typed fields never become a displayed reply", async () => {
  for (const response of [
    envelope(reply, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    envelope(reply, {
      output: [
        {
          id: "msg_refusal",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "test refusal" }],
        },
      ],
    }),
    envelope({ ...reply, safety: "invented-state" }),
    envelope(reply, {
      output: [
        {
          id: "msg_bad",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "{truncated", annotations: [] }],
        },
      ],
    }),
  ]) {
    const f = fixture();
    const transport: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body));
      return body.text?.format.name === "coach_reply" ? json(response) : f.transport(input, init);
    };
    const result = await runChat(
      args(),
      new Gate(new LuaStore(), cap),
      new AI("gpt-5-nano", 1000, { fetch: transport }),
    );
    assert.equal(result.notice, true);
    assert.doesNotMatch(result.body, /발표가 마음처럼/);
  }
});
test("malformed moderation and rejected, unknown or contradictory audit verdicts fail closed", async () => {
  for (const mode of ["moderation", "audit", "rejected", "unknown", "contradictory"]) {
    const f = fixture();
    const transport: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (mode === "moderation" && String(input).endsWith("moderations"))
        return json({ results: [{ categories: {} }] });
      if (mode === "audit" && body.text?.format.name === "output_review")
        return json(envelope({ safe: "true" }));
      if (mode === "rejected" && body.text?.format.name === "output_review")
        return json(envelope({ verdict: "harm_instructions" }));
      if (mode === "unknown" && body.text?.format.name === "output_review")
        return json(envelope({ verdict: "unknown" }));
      if (mode === "contradictory" && body.text?.format.name === "output_review")
        return json(envelope({ verdict: "allow", safe: false }));
      return f.transport(input, init);
    };
    const result = await runChat(
      args(),
      new Gate(new LuaStore(), cap),
      new AI("gpt-5-nano", 1000, { fetch: transport }),
    );
    assert.equal(result.notice, true);
    assert.doesNotMatch(result.body, /발표가 마음처럼/);
  }
});
test("provider 401, model 400, rate limit 429, exhausted quota and server failure are distinct and never auto-retried", async () => {
  for (const [status, code, expected] of [
    [401, "invalid_api_key", "KEY"],
    [400, "unsupported_model", "MODEL"],
    [429, "rate_limit_exceeded", "PROVIDER_LIMIT"],
    [429, "insufficient_quota", "QUOTA"],
    [503, "server_error", "AI_UNAVAILABLE"],
  ] as const) {
    let calls = 0;
    const db = new LuaStore(),
      a = args(),
      gate = new Gate(db, cap);
    const transport: typeof fetch = async () => {
      calls++;
      return json({ error: { message: "offline provider failure", type: code, code } }, status);
    };
    await assert.rejects(
      runChat(a, gate, new AI("gpt-5-nano", 1000, { fetch: transport })),
      (e) => e instanceof AppError && e.code === expected,
    );
    assert.equal(calls, 1);
    assert.equal(db.get(gate.keys(a.sid, a.cid, a.rid)[5]), undefined);
    await gate.enter(a.sid, a.cid, randomUUID(), 0);
  }
});
test("cancellation blocks new paid calls and releases the turn without advancing the history", async () => {
  const control = new AbortController();
  let calls = 0;
  const db = new LuaStore(),
    a = args(),
    gate = new Gate(db, cap);
  control.abort();
  const ai = new AI("gpt-5-nano", 1000, {
    signal: control.signal,
    fetch: async () => {
      calls++;
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(
    runChat(a, gate, ai),
    (e) => e instanceof AppError && e.code === "CANCELLED",
  );
  assert.equal(calls, 0);
  assert.equal(db.get(gate.keys(a.sid, a.cid, a.rid)[5]), undefined);
  await gate.enter(a.sid, a.cid, randomUUID(), 0);
});
test("request deadline covers a stalled response body, not just response headers", async () => {
  const control = new AbortController();
  let aborted = false;
  const a = args(),
    db = new LuaStore(),
    gate = new Gate(db, cap);
  const transport: typeof fetch = async (_input, init) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
    });
    return new Response(
      new ReadableStream({
        start() {
          queueMicrotask(() => control.abort(new DOMException("deadline", "TimeoutError")));
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  await assert.rejects(
    runChat(a, gate, new AI("gpt-5-nano", 1000, { fetch: transport, signal: control.signal })),
    (e) => e instanceof AppError && e.code === "AI_TIMEOUT",
  );
  assert.equal(aborted, true);
  assert.equal(db.get(gate.keys(a.sid, a.cid, a.rid)[5]), undefined);
  await gate.enter(a.sid, a.cid, randomUUID(), 0);
});
