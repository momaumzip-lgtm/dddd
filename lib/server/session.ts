import { SignJWT, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import type { Message } from "../config";
import type { Safety } from "./schemas";
import { progressSchema, freshProgress, type Progress } from "../conversation";
import { AppError } from "./errors";
const secret = () => {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new AppError(
      503,
      "SETUP",
      "대화 설정을 준비 중이에요. 도움 받기는 계속 이용할 수 있어요.",
    );
  return new TextEncoder().encode(process.env.SESSION_SECRET);
};
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function sign(payload: Record<string, unknown>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("maeum")
    .setAudience("chat")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret());
}
export async function verify(token: string) {
  try {
    return (
      await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: "maeum", audience: "chat" })
    ).payload;
  } catch {
    throw new AppError(
      409,
      "SESSION",
      "대화 상태가 만료되었거나 달라졌어요. 새 대화를 시작해 주세요.",
    );
  }
}
export async function newSession(oldCookie?: string) {
  let sid = randomUUID() as string;
  if (oldCookie) {
    try {
      const p = await verify(oldCookie);
      if (p.kind === "session" && typeof p.sid === "string") sid = p.sid;
    } catch {}
  }
  const cid = randomUUID();
  return {
    sid,
    cid,
    cookie: await sign({ kind: "session", sid }),
    token: await state(sid, cid, [], "normal", "emotion", 0),
  };
}
export const state = (
  sid: string,
  cid: string,
  history: Message[],
  safety: Safety,
  stage: string,
  revision: number,
  progress: Progress = freshProgress,
  ackRid?: string,
) =>
  sign({
    kind: "state",
    sid,
    cid,
    hash: hash(history),
    safety,
    stage,
    revision,
    progress,
    ...(ackRid ? { ackRid } : {}),
  });
export async function validateState(
  cookie: string | undefined,
  token: string,
  cid: string,
  history: Message[],
) {
  if (!cookie) throw new AppError(401, "SESSION", "대화를 새로 시작해 주세요.");
  const [session, p] = await Promise.all([verify(cookie), verify(token)]);
  if (
    session.kind !== "session" ||
    p.kind !== "state" ||
    p.sid !== session.sid ||
    p.cid !== cid ||
    p.hash !== hash(history) ||
    !["normal", "check", "emergency", "violence"].includes(String(p.safety)) ||
    !Number.isInteger(p.revision)
  )
    throw new AppError(409, "STATE", "대화 상태를 확인할 수 없어요. 새 대화를 시작해 주세요.");
  return {
    sid: session.sid as string,
    safety: p.safety as Safety,
    stage: String(p.stage),
    revision: p.revision as number,
    progress: progressSchema.parse(p.progress || freshProgress),
    ackRid: typeof p.ackRid === "string" ? p.ackRid : undefined,
  };
}
