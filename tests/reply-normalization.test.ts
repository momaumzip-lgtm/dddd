import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReply, validateReply } from "../lib/server/safety";
import type { Reply } from "../lib/server/schemas";
const reply: Reply = {
  body: "마음이 조급하게 느껴지셨군요. 어떤 생각이 드나요, 지금은 들어주길 원하셨으니 들어도 될까요.",
  question: null,
  stage: "listen",
  safety: "normal",
};
test("period-ended Korean questions cannot bypass a request to listen", () => {
  assert.equal(validateReply(reply, true), false);
  const normalized = normalizeReply(reply, true);
  assert.equal(normalized.body, "마음이 조급하게 느껴지셨군요.");
  assert.equal(normalized.question, null);
  assert.equal(validateReply(normalized, true), true);
});
test("normalization keeps the single explicit question and never invents an empty reflection", () => {
  const normalized = normalizeReply({ ...reply, question: "그때 어떤 생각이 들었나요?" }, false);
  assert.equal(normalized.question, "그때 어떤 생각이 들었나요?");
  assert.equal(validateReply(normalized, false), true);
  assert.equal(
    validateReply(normalizeReply({ ...reply, body: "어떤 생각이 드나요." }, true), true),
    false,
  );
});
