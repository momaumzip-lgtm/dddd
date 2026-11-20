import { NextRequest } from "next/server";
import { newSession } from "@/lib/server/session";
import { json, failure, readJson } from "@/lib/server/http";
export async function POST(req: NextRequest) {
  try {
    const value = await readJson(req, 1024);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length)
      return json({ error: "요청 형식을 확인해 주세요." }, 400);
    const s = await newSession(req.cookies.get("maeum_session")?.value);
    const response = json({ conversationId: s.cid, token: s.token });
    response.cookies.set("maeum_session", s.cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 7200,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
