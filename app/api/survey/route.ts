import { NextRequest } from "next/server";
import { readJson, json, failure } from "@/lib/server/http";
import { surveyRequestSchema } from "@/lib/survey";
import { surveyIdentity, sendSurvey, SurveyGate } from "@/lib/server/survey";
import { RedisStore } from "@/lib/server/limits";
import { AppError } from "@/lib/server/errors";
export async function POST(request: NextRequest) {
  try {
    const result = surveyRequestSchema.safeParse(await readJson(request, 6000));
    if (!result.success)
      throw new AppError(400, "SURVEY_INPUT", "세 문항의 응답과 선택 동의 여부를 확인해 주세요.");
    const p = result.data;
    const sid = await surveyIdentity(
      request.cookies.get("maeum_session")?.value,
      p.token,
      p.conversationId,
    );
    const cap = Number(process.env.SURVEY_DAY_LIMIT || 300);
    if (!Number.isInteger(cap) || cap < 1 || cap > 10000)
      throw new AppError(503, "SURVEY_SETUP", "설문 설정을 확인해야 해요.");
    await sendSurvey(
      sid,
      p.conversationId,
      p.requestId,
      p.answers,
      new SurveyGate(new RedisStore(), cap),
    );
    return json({ accepted: true });
  } catch (error) {
    return failure(error);
  }
}
