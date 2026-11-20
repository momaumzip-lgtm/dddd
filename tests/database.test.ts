import { answersSchema } from "../lib/survey";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { ADMIT, EXTRA, FINISH, Gate, type Store } from "../lib/server/limits";
import { SURVEY_ADMIT, SURVEY_FINISH, SurveyGate } from "../lib/server/survey";
import { LuaStore } from "./store";

const migration = await readFile(
  new URL("../netlify/database/migrations/202611200001_request_gate.sql", import.meta.url),
  "utf8",
);
const cap = { minute: 6, day: 60, global: 7 };
async function fixture() {
  const db = await PGlite.create();
  await db.exec(migration);
  await db.exec(
    await readFile(
      new URL(
        "../netlify/database/migrations/202611200002_forms_single_attempt.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../netlify/database/migrations/202611210001_reply_receipt.sql", import.meta.url),
      "utf8",
    ),
  );
  const store: Store = {
    async eval(op, keys, args) {
      const { rows } = await db.query<{ code: number }>(
        "SELECT maumzip_gate($1, $2::text[], $3::text[]) AS code",
        [op, keys, args],
      );
      return rows[0].code;
    },
  };
  return { db, store };
}

test("production SQL migration admits one duplicate and enforces a shared global cap", async () => {
  const { db, store } = await fixture();
  try {
    const gate = new Gate(store, cap);
    const duplicate = await Promise.allSettled(
      Array.from({ length: 40 }, () => gate.enter("s", "c", "r", 0)),
    );
    assert.equal(duplicate.filter((r) => r.status === "fulfilled").length, 1);
    const independent = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => new Gate(store, cap).enter("s" + i, "c", "r", 0)),
    );
    assert.equal(independent.filter((r) => r.status === "fulfilled").length, 6);
  } finally {
    await db.close();
  }
});

test("production SQL matches independent admission specification for all operation branches", async () => {
  const { db, store } = await fixture();
  const reference = new LuaStore();
  try {
    const keys = ["request", "lock", "minute", "day", "global", "revision"];
    const compare = async (op: string, k: string[], a: string[]) => {
      assert.equal(await store.eval(op, k, a), await reference.eval(op, k, a));
      const { rows } = await db.query<{ key: string; value: string }>(
        "SELECT key, value FROM maumzip_gate_values ORDER BY key",
      );
      assert.deepEqual(
        Object.fromEntries(rows.map((r) => [r.key, r.value])),
        Object.fromEntries([...reference.data.keys()].sort().map((k) => [k, reference.get(k)])),
      );
    };
    const a = ["2", "3", "5", "0", "request"];
    await compare(ADMIT, keys, a);
    await compare(ADMIT, keys, a); // duplicate
    await compare(ADMIT, ["other", ...keys.slice(1)], a); // busy
    await compare(EXTRA, [keys[1], keys[4]], ["wrong", "5"]);
    await compare(EXTRA, [keys[1], keys[4]], ["request", "1"]); // global cap
    await compare(EXTRA, [keys[1], keys[4]], ["request", "5"]);
    await compare(FINISH, [keys[1], keys[5]], ["wrong", "1"]);
    await compare(FINISH, [keys[1], keys[5]], ["request", "1"]);
    await compare(ADMIT, ["next", ...keys.slice(1)], a); // stale
    await compare(ADMIT, ["next", ...keys.slice(1)], ["1", "3", "5", "1", "next"]); // minute cap
    await compare(ADMIT, ["next", ...keys.slice(1)], ["2", "3", "5", "1", "next"]);
    await compare(FINISH, [keys[1], keys[5]], ["next", ""]); // failed request retains usage

    const sk = ["claim", "survey-lock", "done", "survey-day", "survey-global", "attempts"];
    await compare(SURVEY_ADMIT, sk, ["fingerprint", "10"]);
    await compare(SURVEY_ADMIT, sk, ["changed", "10"]);
    await compare(SURVEY_ADMIT, sk, ["fingerprint", "10"]);
    await compare(SURVEY_FINISH, [sk[1], sk[2]], ["wrong", "done"]);
    await compare(SURVEY_FINISH, [sk[1], sk[2]], ["fingerprint", "release"]);
    await compare(SURVEY_ADMIT, sk, ["fingerprint", "10"]);
    await compare(SURVEY_FINISH, [sk[1], sk[2]], ["fingerprint", "done"]);
    await compare(SURVEY_ADMIT, sk, ["fingerprint", "10"]);
    await compare(SURVEY_ADMIT, sk, ["changed", "10"]);
  } finally {
    await db.close();
  }
});

test("SQL rejects unknown operations, rolls back partial writes and expires metadata before admission", async () => {
  const { db, store } = await fixture();
  try {
    const keys = ["request", "lock", "minute", "day", "global", "revision"];
    await assert.rejects(store.eval("injected", keys, []), /Unknown gate/);
    await assert.rejects(store.eval(ADMIT, keys, ["1"]), /Invalid gate/);
    await db.exec(
      "CREATE FUNCTION fail_gate_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = 'global' THEN RAISE EXCEPTION 'Write failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER gate_write_failure BEFORE INSERT ON maumzip_gate_values FOR EACH ROW EXECUTE FUNCTION fail_gate_write()",
    );
    await assert.rejects(store.eval(ADMIT, keys, ["2", "3", "5", "0", "request"]), /Write failed/);
    assert.equal((await db.query("SELECT * FROM maumzip_gate_values")).rows.length, 0);
    await db.exec("DROP TRIGGER gate_write_failure ON maumzip_gate_values");
    const gate = new Gate(store, cap);
    await gate.enter("s", "c", "r", 0);
    await db.exec(
      "UPDATE maumzip_gate_values SET expires_at = clock_timestamp() - interval '1 second'",
    );
    await gate.enter("s", "c", "r", 0);
    const survey = new SurveyGate(store, 1);
    const answers = answersSchema.parse({
      entryRoute: "online_link",
      improvementSuggestions: "합성 의견",
    });
    const slot = await survey.enter("s", "c", "r", answers);
    await slot.finish(true);
    assert.equal((await survey.enter("s", "c", "r", answers)).alreadyAccepted, true);
    await assert.rejects(survey.enter("s", "other", "r", answers), /전송 가능 횟수/);
    assert.equal(
      (await db.query("SELECT * FROM maumzip_gate_values WHERE value LIKE '%합성%'")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("SQL receipt staging, idempotent acknowledgement and stale receipt race preserve the chosen revision", async () => {
  const { db, store } = await fixture();
  try {
    const gate = new Gate(store, cap);
    const first = await gate.enter("receipt-s", "receipt-c", "r1", 0);
    await first.stage(1);
    const retry = await gate.enter("receipt-s", "receipt-c", "r2", 0);
    await retry.stage(1);
    await gate.acknowledge("receipt-s", "receipt-c", "r2", 1);
    await gate.acknowledge("receipt-s", "receipt-c", "r2", 1);
    await assert.rejects(gate.acknowledge("receipt-s", "receipt-c", "r1", 1), /상태가 달라/);
    const next = await gate.enter("receipt-s", "receipt-c", "r3", 1);
    await next.stage(2);
    await gate.acknowledge("receipt-s", "receipt-c", "r3", 2);
    const unknown = await gate.enter("other", "other", "r4", 0);
    await assert.rejects(gate.acknowledge("other", "other", "r4", 1));
    await unknown.finish();
  } finally {
    await db.close();
  }
});
