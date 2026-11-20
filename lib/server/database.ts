import "server-only";
import { getConnectionString, getDatabase } from "@netlify/database";
import { ADMIT, EXTRA, FINISH, type Store } from "./limits";
import { SURVEY_ADMIT, SURVEY_FINISH } from "./survey";
import { AppError } from "./errors";

export function databaseConfigured() {
  try {
    return Boolean(getConnectionString());
  } catch {
    return false;
  }
}

const operations = new Map([
  [ADMIT, "admit"],
  [EXTRA, "extra"],
  [FINISH, "finish"],
  [SURVEY_ADMIT, "survey_admit"],
  [SURVEY_FINISH, "survey_finish"],
]);
let database: ReturnType<typeof getDatabase> | undefined;

// Netlify provisions credentials in the server runtime; no additional Redis account or token.
export class DatabaseStore implements Store {
  async eval(script: string, keys: string[], args: string[]) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = operations.get(script);
      if (!operation) throw new Error("Unknown operation");
      const query = (database ??= getDatabase()).sql<{ code: number }>`
        SELECT maumzip_gate(${operation}, ${keys}::text[], ${args}::text[]) AS code
      `;
      const rows = await Promise.race([
        Promise.resolve(query),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Store deadline")), 5000);
        }),
      ]);
      if (!Number.isInteger(rows[0]?.code)) throw new Error("Invalid store response");
      return rows[0].code;
    } catch {
      // A timed out reservation may still commit. Never retry it or call the provider on uncertainty.
      throw new AppError(
        503,
        "STORE",
        "사용량을 확인하지 못했어요. 입력은 보존돼요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
