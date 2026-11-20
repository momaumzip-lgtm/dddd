import "server-only";
import { z } from "zod";
import { hash, verify } from "./session";
import { AppError } from "./errors";
import type { Store } from "./limits";
import { SURVEY_VERSION, type SurveyAnswers, type SurveyConfig } from "../survey";
const formSettings = z.object({
  enabled: z.literal("true"),
  origin: z.url().refine((value) => new URL(value).protocol === "https:"),
  operator: z.string().trim().min(1),

  retention: z.string().trim().min(1),
});
function settings() {
  return formSettings.safeParse({
    enabled: process.env.NETLIFY_FORMS_ENABLED,
    origin: process.env.APP_URL,
    operator: process.env.OPERATOR_NAME,

    retention: process.env.SURVEY_RETENTION_NOTICE,
  });
}
export function surveyConfig(): SurveyConfig {
  return {
    ready: settings().success,
    recipient: process.env.OPERATOR_NAME || "운영 정보 확인 중",
    retention: process.env.SURVEY_RETENTION_NOTICE || "설문 보관·삭제 기준을 확인 중입니다.",
  };
}
export async function surveyIdentity(cookie: string | undefined, token: string, cid: string) {
  if (!cookie) throw new AppError(401, "SESSION", "대화를 새로 시작한 뒤 설문을 다시 열어 주세요.");
  const [s, p] = await Promise.all([verify(cookie), verify(token)]);
  if (s.kind !== "session" || p.kind !== "state" || s.sid !== p.sid || p.cid !== cid)
    throw new AppError(409, "STATE", "설문 상태를 확인할 수 없어요. 대화를 새로 시작해 주세요.");
  return s.sid as string;
}
// Metadata only: request/fingerprint, 2h delivery status/attempts; 25h daily counters. No answers.
// Netlify Forms has no idempotency API: reserve one outbound attempt before sending.
export const SURVEY_ADMIT = "survey_admit";
export const SURVEY_FINISH = "survey_finish";
export class SurveyGate {
  constructor(
    private store: Store,
    private cap = 300,
    private clock = () => Date.now(),
  ) {}
  async enter(sid: string, cid: string, rid: string, answers: SurveyAnswers) {
    const day = new Date(this.clock() + 9 * 3600000).toISOString().slice(0, 10);
    const base = `{maeum}:survey:${sid}:${cid}`;
    const keys = [
      base + ":claim",
      base + ":lock",
      base + ":done",
      `{maeum}:survey:day:${sid}:${day}`,
      `{maeum}:survey:global:${day}`,
      base + ":attempts",
    ];
    const claim = rid + ":" + hash(answers);
    const result = await this.store.eval(SURVEY_ADMIT, keys, [claim, String(this.cap)]);
    if (result === 6)
      throw new AppError(
        409,
        "SURVEY_UNCERTAIN",
        "이미 전송을 요청한 설문이에요. 중복 접수를 막기 위해 다시 보내지 않아요. 접수 여부는 운영자에게 문의해 주세요.",
      );
    if (result === 1)
      throw new AppError(
        429,
        "SURVEY_LIMIT",
        "설문 전송 가능 횟수에 도달했어요. 대화는 계속 이용하실 수 있어요.",
      );
    if (result === 3 || result === 4)
      throw new AppError(
        409,
        "SURVEY_CHANGED",
        "이 대화에서 이미 전송을 요청한 설문이 있어요. 같은 응답으로 다시 확인해 주세요.",
      );
    if (result === 5)
      throw new AppError(
        409,
        "SURVEY_BUSY",
        "설문을 전달 중이에요. 잠시 후 같은 응답으로 다시 확인해 주세요.",
      );
    return {
      alreadyAccepted: result === 2,
      finish: async (done: boolean) => {
        const code = await this.store.eval(
          SURVEY_FINISH,
          [keys[1], keys[2]],
          [claim, done ? "done" : "release"],
        );
        if (code !== 0)
          throw new AppError(
            503,
            "SURVEY_STATUS",
            "설문 접수 상태를 확인하지 못했어요. 같은 응답으로 다시 확인해 주세요.",
          );
      },
    };
  }
}
export function surveyForm(rid: string, answers: SurveyAnswers) {
  const form = new URLSearchParams({
    "form-name": "maumzip-experience",
    "bot-field": "",
    submissionId: rid,
    surveyVersion: SURVEY_VERSION,
    선택동의: "설문 저장 및 운영자 이메일 알림에 동의함",
    // Forms fields are strings. The canonical answer preserves null and numeric scores on export.
    answers: JSON.stringify(answers),
  });
  for (const [key, value] of Object.entries(answers))
    if (value !== null) form.set(key, String(value));
  return form;
}
export async function sendSurvey(
  sid: string,
  cid: string,
  rid: string,
  answers: SurveyAnswers,
  gate: SurveyGate,
  transport: typeof fetch = fetch,
) {
  const configured = settings();
  if (!configured.success)
    throw new AppError(
      503,
      "SURVEY_SETUP",
      "설문 접수를 준비 중이에요. 아직 응답이 전송되지 않았어요.",
    );
  const slot = await gate.enter(sid, cid, rid, answers);
  if (slot.alreadyAccepted) return;
  let accepted = false;
  try {
    const config = configured.data;
    const response = await transport(new URL("/netlify-forms.html", config.origin), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: surveyForm(rid, answers).toString(),
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    // The static success marker distinguishes a Forms response from a generic 200 page.
    if (!response.ok || !(await response.text()).includes("maumzip-forms-received-v1"))
      throw new Error();
    accepted = true;
    await slot.finish(true);
  } catch {
    // Never repeat an outbound request after a timeout: Forms may already have accepted it.
    if (!accepted) {
      try {
        await slot.finish(false);
      } catch {}
    }
    throw new AppError(
      503,
      "SURVEY_UNCERTAIN",
      "설문 접수를 확인하지 못했어요. 중복 접수를 막기 위해 자동으로 다시 보내지 않아요. 접수 여부는 운영자에게 문의해 주세요.",
    );
  }
}
