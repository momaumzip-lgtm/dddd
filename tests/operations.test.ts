import { test } from "node:test";
import assert from "node:assert/strict";
import { operationsPolicy } from "../lib/server/operations";
test("non-API release gate requires real policy fields and explicit log confirmation", () => {
  const keys = [
    "OPERATOR_NAME",
    "DATA_PROCESSING_NOTICE",
    "SURVEY_RETENTION_NOTICE",
    "HOST_LOG_POLICY_CONFIRMED",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(operationsPolicy().ready, false);
    Object.assign(process.env, {
      OPERATOR_NAME: "테스트 운영자",
      DATA_PROCESSING_NOTICE: "테스트용 처리·보관 기준",
      SURVEY_RETENTION_NOTICE: "테스트용 삭제 기준",
      HOST_LOG_POLICY_CONFIRMED: "true",
    });
    assert.equal(operationsPolicy().ready, true);
    for (const key of keys) {
      const value = process.env[key];
      process.env[key] = "";
      assert.equal(operationsPolicy().ready, false, key);
      process.env[key] = value;
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
