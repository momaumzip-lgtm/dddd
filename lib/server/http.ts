import { NextResponse } from "next/server";
import { AppError } from "./errors";
export const headers = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return json({ error: error.message, code: error.code }, error.status);
  return json(
    {
      error: "일시적인 오류가 생겼어요. 입력은 그대로 두고 다시 시도해 주세요.",
      code: "UNAVAILABLE",
    },
    503,
  );
}
export async function readJson(req: Request, maxBytes = 60000) {
  const expected = process.env.ALLOWED_ORIGIN || process.env.APP_URL;
  const url = new URL(req.url);
  const dev =
    process.env.NODE_ENV !== "production" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (!expected && !dev) throw new AppError(503, "SETUP", "운영 설정을 준비 중이에요.");
  const origin = req.headers.get("origin");
  const localOrigin =
    dev && [`http://127.0.0.1:${url.port}`, `http://localhost:${url.port}`].includes(origin || "");
  if (origin !== expected && !(dev && !expected && localOrigin))
    throw new AppError(403, "ORIGIN", "허용되지 않은 요청이에요.");
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new AppError(415, "TYPE", "요청 형식을 확인해 주세요.");
  const reader = req.body?.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  if (!reader) throw new AppError(400, "BODY", "입력 내용을 확인해 주세요.");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(413, "SIZE", "입력이 너무 길어요.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(400, "JSON", "요청 형식을 확인해 주세요.");
  }
}
