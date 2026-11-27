import { hasOutputInstructions } from "../lib/server/reply-text";
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
test("duplicated period-ended questions leave only the final single question", () => {
  const normalized = normalizeReply(
    {
      ...reply,
      body: "시간을 맞추지 못하면 무능해 보일 것 같다고 느끼셨네요. 남은 일은 무엇인가요.",
      question:
        "오늘은 어디까지 마치셨고 남은 일은 무엇인가요. 그때 가장 바랐던 도움은 무엇인가요?",
    },
    false,
  );
  assert.equal(normalized.body, "시간을 맞추지 못하면 무능해 보일 것 같다고 느끼셨네요.");
  assert.equal(normalized.question, "그때 가장 바랐던 도움은 무엇인가요?");
  assert.equal(validateReply(normalized, false), true);
});

test("model formatting notes cannot be shown alongside a Korean question", () => {
  assert.equal(
    hasOutputInstructions(
      ":null: 25~70자 질문 하나 요구지만 null 불가 string으로 작성하십시오: 무엇이 조금 달라 보이나요?",
    ),
    true,
  );
  assert.equal(hasOutputInstructions("출력할 때 null 불가라고 했어요."), true);
  assert.equal(hasOutputInstructions("그 말을 듣고 난 뒤 지금은 무엇이 조금 달라 보여요?"), false);
});
