import "server-only";
import { databaseConfigured } from "./database";
// Lowest listed text generation price checked 2026-11-20. Shutdown: 2026-12-11.
// No automatic migration or more expensive model fallback; review before that date.
export const DEFAULT_CHAT_MODEL = "gpt-5-nano";
export const chatModel = () => process.env.OPENAI_MODEL?.trim() || DEFAULT_CHAT_MODEL;
export function limits() {
  const num = (key: string, value: number, max: number) => {
    const n = Number(process.env[key] || value);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error("Invalid configuration");
    return n;
  };
  return {
    minute: num("SESSION_MINUTE_LIMIT", 6, 60),
    day: num("SESSION_DAY_LIMIT", 60, 1000),
    global: num("GLOBAL_DAY_LIMIT", 300, 10000),
    input: num("MAX_INPUT_CHARS", 1200, 4000),
    history: num("MAX_HISTORY_CHARS", 12000, 24000),
    output: num("MAX_OUTPUT_TOKENS", 1000, 4000),
  };
}
export function configured() {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() &&
    chatModel() &&
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32 &&
    process.env.APP_URL &&
    process.env.ALLOWED_ORIGIN &&
    databaseConfigured(),
  );
}
