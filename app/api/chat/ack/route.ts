import { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, json, failure } from "@/lib/server/http";
import { verify } from "@/lib/server/session";
import { Gate } from "@/lib/server/limits";
import { DatabaseStore } from "@/lib/server/database";
import { limits } from "@/lib/server/config";
import { AppError } from "@/lib/server/errors";
const schema = z
  .object({ conversationId: z.string().uuid(), token: z.string().max(4096) })
  .strict();
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await readJson(req, 6000));
    if (!parsed.success) throw new AppError(400, "INPUT", "접수 확인 형식을 확인해 주세요.");
    const p = parsed.data,
      cookie = req.cookies.get("maeum_session")?.value;
    if (!cookie)
      throw new AppError(
        401,
        "SESSION",
        "접수 확인을 위한 연결이 만료됐어요. 입력과 대화는 이 화면에 남아 있어요.",
      );
    const [s, t] = await Promise.all([verify(cookie), verify(p.token)]);
    if (
      s.kind !== "session" ||
      t.kind !== "state" ||
      s.sid !== t.sid ||
      t.cid !== p.conversationId ||
      !z.string().uuid().safeParse(t.ackRid).success ||
      !Number.isInteger(t.revision) ||
      Number(t.revision) < 1
    )
      throw new AppError(
        409,
        "STATE",
        "접수 상태를 확인하지 못했어요. 입력과 대화는 이 화면에 남아 있어요.",
      );
    await new Gate(new DatabaseStore(), limits()).acknowledge(
      String(s.sid),
      p.conversationId,
      String(t.ackRid),
      Number(t.revision),
    );
    return json({ accepted: true });
  } catch (error) {
    return failure(error);
  }
}
