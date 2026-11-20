import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { SURVEY_VERSION, surveyRequestSchema } from "../lib/survey";
import { SurveyGate, sendSurvey, surveyIdentity, surveyConfig } from "../lib/server/survey";
import { newSession } from "../lib/server/session";
import { POST } from "../app/api/survey/route";
import { LuaStore } from "./store";
const answers = { helpfulness: 4, ease: 5, reuse: 3, comment: "합성 의견 <img src=x>" };
beforeEach(() => {
  Object.assign(process.env, {
    SESSION_SECRET: "test-only-secret-at-least-32-characters",
    NETLIFY_FORMS_ENABLED: "true",
    OPERATOR_NAME: "테스트 운영자",
    SUPPORT_CONTACT: "support@example.test",
    SURVEY_RETENTION_NOTICE: "테스트용 보관 기준",
    APP_URL: "https://review.example.test",
    ALLOWED_ORIGIN: "https://review.example.test",
  });
});
const delivered: typeof fetch = async () =>
  new Response("<main data-receipt=maumzip-forms-received-v1></main>", { status: 200 });
test("survey schema requires separate consent, three valid ratings and rejects chat/recipient injection", () => {
  const base = {
    requestId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    token: "t",
    version: SURVEY_VERSION,
    consent: true,
    answers,
  };
  assert.ok(surveyRequestSchema.safeParse(base).success);
  for (const bad of [
    { ...base, consent: false },
    { ...base, history: [] },
    { ...base, to: "other@example.test" },
    { ...base, answers: { ...answers, comment: "a".repeat(501) } },
    { ...base, answers: { ...answers, ease: 1.5 } },
    { ...base, answers: { ...answers, diary: "private" } },
  ])
    assert.equal(surveyRequestSchema.safeParse(bad).success, false);
});
test("survey signed identity binds cookie and conversation without accepting chat content", async () => {
  const s = await newSession(),
    other = await newSession();
  assert.equal(await surveyIdentity(s.cookie, s.token, s.cid), s.sid);
  await assert.rejects(surveyIdentity(other.cookie, s.token, s.cid));
  await assert.rejects(surveyIdentity(s.cookie, s.token, crypto.randomUUID()));
});
test("Netlify payload contains only consented survey fields without chat, cookie or secrets", async () => {
  const transport: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://review.example.test/netlify-forms.html");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("form-name"), "maumzip-experience");
    assert.equal(body.get("자유의견"), answers.comment);
    assert.equal(body.get("접수번호"), "r");
    assert.ok(body.get("도움정도")!.startsWith("4 / 5"));
    assert.deepEqual(
      [...body.keys()].sort(),
      [
        "form-name",
        "bot-field",
        "접수번호",
        "설문버전",
        "선택동의",
        "도움정도",
        "사용편의",
        "재이용의향",
        "자유의견",
      ].sort(),
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
    assert.equal(headers.get("Cookie"), null);
    assert.equal(headers.get("Authorization"), null);
    return delivered(url, init);
  };
  await sendSurvey("s", "c", "r", answers, new SurveyGate(new LuaStore()), transport);
});

test("parallel submissions and a completed retry cannot send multiple emails", async () => {
  const db = new LuaStore();
  let count = 0;
  const transport: typeof fetch = async (...a) => {
    count++;
    return delivered(...a);
  };
  const gate = new SurveyGate(db);
  const all = await Promise.allSettled(
    Array.from({ length: 20 }, () => sendSurvey("s", "c", "r", answers, gate, transport)),
  );
  assert.equal(all.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(count, 1);
  await sendSurvey("s", "c", "r", answers, gate, transport);
  assert.equal(count, 1);
  await assert.rejects(sendSurvey("s", "c", "different", answers, gate, transport));
  assert.ok(![...db.data.values()].some((v) => v.value.includes("합성 의견")));
});
test("uncertain Netlify acceptance never resends after a timeout, even when the lock expires", async () => {
  const db = new LuaStore(),
    gate = new SurveyGate(db);
  let count = 0;
  const transport: typeof fetch = async () => {
    count++;
    throw new Error("response lost");
  };
  await assert.rejects(sendSurvey("s", "c", "r", answers, gate, transport), /확인하지 못/);
  db.now += 31000;
  await assert.rejects(sendSurvey("s", "c", "r", answers, gate, transport), /다시 보내지/);
  await assert.rejects(sendSurvey("s", "c", "other", answers, gate, transport), /이미 전송/);
  assert.equal(count, 1);
});

test("survey shared global cap is separate from paid AI quota", async () => {
  const db = new LuaStore(),
    gate = new SurveyGate(db, 2);
  for (let i = 0; i < 2; i++) await sendSurvey("s" + i, "c", "r", answers, gate, delivered);
  await assert.rejects(sendSurvey("s3", "c", "r", answers, gate, delivered), /횟수/);
  assert.ok([...db.data.keys()].every((k) => k.includes(":survey:")));
});

test("generic HTML or failed Forms responses are never reported as accepted", async () => {
  for (const response of [
    new Response("generic page"),
    new Response("maumzip-forms-received-v1", { status: 404 }),
  ]) {
    await assert.rejects(
      sendSurvey("s", "c", "r", answers, new SurveyGate(new LuaStore()), async () => response),
      /확인하지 못/,
    );
  }
});

test("storage outage fails closed and missing configuration never masquerades as submission", async () => {
  let calls = 0;
  const transport: typeof fetch = async (...a) => {
    calls++;
    return delivered(...a);
  };
  await assert.rejects(
    sendSurvey(
      "s",
      "c",
      "r",
      answers,
      new SurveyGate({
        eval: async () => {
          throw new Error("store unavailable");
        },
      }),
      transport,
    ),
  );
  assert.equal(calls, 0);
  delete process.env.NETLIFY_FORMS_ENABLED;
  assert.equal(surveyConfig().ready, false);
  const db = new LuaStore();
  await assert.rejects(
    sendSurvey("s", "c", "r", answers, new SurveyGate(db), transport),
    /아직 응답이 전송되지/,
  );
  assert.equal(db.data.size, 0);
  assert.equal(calls, 0);
});
test("survey route enforces Origin, consent and honest setup response", async () => {
  delete process.env.NETLIFY_FORMS_ENABLED;
  const s = await newSession();
  const body = {
    conversationId: s.cid,
    token: s.token,
    requestId: crypto.randomUUID(),
    version: SURVEY_VERSION,
    consent: true,
    answers,
  };
  const request = (data: unknown, origin = "https://review.example.test") =>
    new NextRequest("https://review.example.test/api/survey", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: `maeum_session=${s.cookie}`,
      },
      body: JSON.stringify(data),
    });
  assert.equal((await POST(request({ ...body, consent: false }))).status, 400);
  assert.equal((await POST(request(body, "https://evil.example.test"))).status, 403);
  const result = await POST(request(body));
  assert.equal(result.status, 503);
  assert.equal(((await result.json()) as { code: string }).code, "SURVEY_SETUP");
});
