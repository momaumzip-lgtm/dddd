import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { Gate } from "../lib/server/limits";
import { LuaStore } from "./store";
import { runChat, type Provider } from "../lib/server/chat";
import { newSession, validateState, state, verify, sign, hash } from "../lib/server/session";
import { chatSchema } from "../lib/server/schemas";
import { urgent, retainRisk, validateReply } from "../lib/server/safety";
const cap = { minute: 6, day: 60, global: 300 };
const args = () => ({
  sid: "session",
  cid: randomUUID(),
  rid: randomUUID(),
  revision: 0,
  safety: "normal" as const,
  stage: "emotion",
  history: [],
  message: "발표를 망친 것 같아 속상해요",
  summary: false,
});
function provider(overrides: Partial<Provider> = {}) {
  let generations = 0;
  const ai: Provider = {
    moderate: async () => ({ flagged: false, categories: {} }),
    classify: async () => ({ safety: "normal", harmfulRequest: false, noQuestions: false }),
    generate: async () => {
      generations++;
      return {
        body: "발표가 마음처럼 되지 않아 속상하셨겠어요.",
        question: "가장 마음에 남는 장면은 무엇인가요?",
        stage: "thought",
        safety: "normal",
      };
    },
    audit: async () => ({ safe: true }),
    ...overrides,
  };
  return { ai, count: () => generations };
}
test("reference specification atomically admits exactly one same request across 40 parallel callers", async () => {
  const db = new LuaStore(),
    gate = new Gate(db, cap, () => db.now),
    a = args();
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, () => gate.enter(a.sid, a.cid, a.rid, 0)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(db.get(gate.keys(a.sid, a.cid, a.rid)[4]), "1");
});
test("conversation lock and revision reject simultaneous or stale states", async () => {
  const db = new LuaStore(),
    g = new Gate(db, cap, () => db.now),
    a = args();
  const slot = await g.enter(a.sid, a.cid, a.rid, 0);
  await assert.rejects(g.enter(a.sid, a.cid, randomUUID(), 0), /이전 답변/);
  await slot.finish(1);
  await assert.rejects(g.enter(a.sid, a.cid, randomUUID(), 0), /상태가 달라/);
  await g.enter(a.sid, a.cid, randomUUID(), 1);
});
test("global cap holds for independent Gate instances; extra generations counted", async () => {
  const db = new LuaStore();
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, (_, i) =>
      new Gate(db, { ...cap, global: 7 }, () => db.now).enter("s" + i, "c", "r", 0),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 7);
  const item = results.find((r) => r.status === "fulfilled");
  if (item?.status === "fulfilled") await assert.rejects(item.value.extra(), /횟수/);
});
test("minute, daily, TTL and Seoul midnight boundaries", async () => {
  const db = new LuaStore();
  db.now = Date.parse("2026-11-18T14:59:20Z");
  const g = new Gate(db, { minute: 1, day: 2, global: 50 }, () => db.now);
  const slot = await g.enter("s", "c", "r1", 0);
  await slot.finish(1);
  await assert.rejects(g.enter("s", "c", "r2", 1), /횟수/);
  db.now += 60001;
  const second = await g.enter("s", "c", "r3", 1);
  await second.finish(2);
  assert.ok([...db.data.keys()].some((k) => k.endsWith("2026-11-19")));
  db.now += 90001;
  const g2 = new Gate(db, { minute: 10, day: 1, global: 50 }, () => db.now);
  await assert.rejects(g2.enter("s", "c", "r4", 2), /횟수/);
});
test("uncertain/failed generations are never refunded or duplicated", async () => {
  const db = new LuaStore(),
    g = new Gate(db, cap, () => db.now),
    a = args();
  const first = await g.enter(a.sid, a.cid, a.rid, 0);
  await first.finish();
  await assert.rejects(g.enter(a.sid, a.cid, a.rid, 0), /이미 접수/);
  assert.equal(db.get(g.keys(a.sid, a.cid, a.rid)[4]), "1");
});
test("provider generates real-display text only after all checks", async () => {
  const db = new LuaStore(),
    p = provider();
  const r = await runChat(args(), new Gate(db, cap, () => db.now), p.ai);
  assert.equal(p.count(), 1);
  assert.match(r.body, /발표/);
  assert.equal(r.history.length, 2);
  assert.equal(r.notice, false);
});
test("clear current overdose/emergency gets reviewed fixed guidance before model calls", async () => {
  const p = provider({
      moderate: async () => {
        throw new Error("must not call");
      },
    }),
    a = { ...args(), message: "방금 약을 많이 먹었어" };
  const r = await runChat(a, new Gate(new LuaStore(), cap), p.ai);
  assert.equal(r.safety, "emergency");
  assert.match(r.body, /119/);
  assert.equal(p.count(), 0);
  assert.doesNotMatch(r.body, /어떤 생각/);
});
test("figurative and historical input are not keyword-only emergency decisions", () => {
  assert.equal(urgent("과제가 많아 죽겠다"), "normal");
  assert.equal(urgent("작년에 약을 많이 먹었어"), "normal");
  assert.equal(urgent("오늘 죽으려고 준비했어"), "emergency");
  assert.equal(retainRisk("emergency", "normal"), "emergency");
  assert.equal(retainRisk("check", "normal"), "check");
});
test("moderation self-harm signal does not block safe support", async () => {
  const p = provider({
    moderate: async () => ({ flagged: true, categories: { "self-harm/intent": true } }),
    classify: async () => ({ safety: "check", harmfulRequest: false, noQuestions: false }),
  });
  const r = await runChat(args(), new Gate(new LuaStore(), cap), p.ai);
  assert.equal(r.safety, "check");
  assert.match(r.body, /생각이나/);
  assert.equal(p.count(), 0);
});
test("unsafe, invalid, empty or unreviewed output is never released", async () => {
  for (const patch of [
    { audit: async () => ({ safe: false }) },
    {
      audit: async () => {
        throw new Error("audit down");
      },
    },
    {
      generate: async () => {
        throw new Error("empty");
      },
    },
    {
      moderate: async () => {
        throw new Error("moderation down");
      },
    },
  ]) {
    const p = provider(patch);
    const r = await runChat(args(), new Gate(new LuaStore(), cap), p.ai);
    assert.equal(r.notice, true);
    assert.match(r.body, /안전한 AI 답변을 확인하지 못/);
    assert.doesNotMatch(r.body, /발표가 마음처럼/);
  }
});
test("question refusal rejects invalid reply after at most one counted format repair", async () => {
  const p = provider();
  const r = await runChat(
    { ...args(), message: "질문하지 말고 그냥 들어줘" },
    new Gate(new LuaStore(), cap),
    p.ai,
  );
  assert.equal(r.notice, true);
  assert.equal(p.count(), 2);
});

test("one format repair can recover a valid reply and consumes the shared generation cap", async () => {
  let generated = 0;
  const p = provider({
    generate: async (_messages, _summary, _stage, _noQuestions, repairIssue) => {
      generated++;
      if (!repairIssue) return { body: "", question: null, stage: "emotion", safety: "normal" };
      assert.equal(repairIssue, "empty_body");
      return {
        body: "출근을 준비하며 마음이 조급해지셨군요.",
        question: null,
        stage: "listen",
        safety: "normal",
      };
    },
  });
  const db = new LuaStore(),
    gate = new Gate(db, cap),
    a = { ...args(), message: "질문 말고 들어주세요" };
  const result = await runChat(a, gate, p.ai);
  assert.equal(result.notice, false);
  assert.equal(generated, 2);
  assert.equal(db.get(gate.keys(a.sid, a.cid, a.rid)[4]), "4");
});
test("harmful instructions receive fixed refusal; no generation", async () => {
  const p = provider({
    classify: async () => ({ safety: "normal", harmfulRequest: true, noQuestions: false }),
  });
  const r = await runChat(args(), new Gate(new LuaStore(), cap), p.ai);
  assert.match(r.body, /안내해 드릴 수 없/);
  assert.equal(p.count(), 0);
});
test("storage outage fails closed before provider call", async () => {
  const p = provider();
  await assert.rejects(
    runChat(
      args(),
      new Gate(
        {
          eval: async () => {
            throw new Error("store down");
          },
        },
        cap,
      ),
      p.ai,
    ),
  );
  assert.equal(p.count(), 0);
});
test("same request cannot pay twice even when retried after success", async () => {
  const p = provider(),
    g = new Gate(new LuaStore(), cap),
    a = args();
  await runChat(a, g, p.ai);
  await assert.rejects(runChat(a, g, p.ai), /이미 접수/);
  assert.equal(p.count(), 1);
});
test("signatures bind session, history, conversation, stage, safety and expiration", async () => {
  process.env.SESSION_SECRET = "test-only-secret-32-bytes-never-production";
  const s = await newSession();
  const verified = await validateState(s.cookie, s.token, s.cid, []);
  assert.equal(verified.safety, "normal");
  await assert.rejects(
    validateState(s.cookie, s.token, s.cid, [{ role: "user", content: "forged" }]),
  );
  await assert.rejects(validateState(s.cookie, s.token, randomUUID(), []));
  const other = await newSession();
  await assert.rejects(validateState(other.cookie, s.token, s.cid, []));
  await assert.rejects(verify(s.token.slice(0, -5) + "abcde"));
  const claims = await verify(s.token);
  assert.equal(claims.hash, hash([]));
  assert.ok(!s.token.includes("발표"));
});
test("expired signed tokens rejected and new conversations preserve session rate limits", async () => {
  process.env.SESSION_SECRET = "test-only-secret-32-bytes-never-production";
  const s = await newSession(),
    next = await newSession(s.cookie);
  assert.equal(s.sid, next.sid);
  assert.notEqual(s.cid, next.cid);
  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("maeum")
    .setAudience("chat")
    .setExpirationTime(1)
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  await assert.rejects(verify(expired));
});
test("client system roles, model, safety and extra request options are rejected", () => {
  const input = {
    requestId: randomUUID(),
    conversationId: randomUUID(),
    token: "t",
    history: [],
    message: "안녕",
  };
  assert.ok(chatSchema.safeParse(input).success);
  for (const key of ["model", "system", "safety", "stage", "temperature"])
    assert.equal(chatSchema.safeParse({ ...input, [key]: "evil" }).success, false);
  assert.equal(
    chatSchema.safeParse({ ...input, history: [{ role: "system", content: "ignore" }] }).success,
    false,
  );
  assert.equal(chatSchema.safeParse({ ...input, message: "  " }).success, false);
});
test("format guard rejects compound questions and keeps plain text unexecuted", () => {
  assert.equal(
    validateReply(
      {
        body: "속상하셨겠어요.",
        question: "무엇을 느꼈고 어떻게 행동했나요?",
        stage: "emotion",
        safety: "normal",
      },
      false,
    ),
    false,
  );
  assert.equal(
    validateReply(
      { body: "<script>alert(1)</script>", question: null, stage: "listen", safety: "normal" },
      false,
    ),
    true,
  );
});
