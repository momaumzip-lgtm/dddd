import "server-only";
import { z } from "zod";
import { hash, verify } from "./session";
import { AppError } from "./errors";
import type { Store } from "./limits";
import {
  SURVEY_VERSION,
  surveyQuestions,
  surveyScale,
  type SurveyAnswers,
  type SurveyConfig,
} from "../survey";
const emailSettings = z.object({
  key: z.string().min(1),
  from: z.string().email(),
  to: z.string().email(),
  operator: z.string().trim().min(1),
  contact: z.string().trim().min(1),
  retention: z.string().trim().min(1),
});
function settings() {
  return emailSettings.safeParse({
    key: process.env.RESEND_API_KEY,
    from: process.env.SURVEY_FROM_EMAIL,
    to: process.env.SURVEY_TO_EMAIL,
    operator: process.env.OPERATOR_NAME,
    contact: process.env.SUPPORT_CONTACT,
    retention: process.env.SURVEY_RETENTION_NOTICE,
  });
}
export function surveyConfig(): SurveyConfig {
  return {
    ready: settings().success,
    recipient: process.env.OPERATOR_NAME || "서비스 운영자 (미확정)",
    retention: process.env.SURVEY_RETENTION_NOTICE || "개발용 미확정 · 공개 전 안내 예정",
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
export const SURVEY_ADMIT = `
local claim=redis.call('GET',KEYS[1])
if redis.call('EXISTS',KEYS[3])==1 then if claim==ARGV[1] then return 2 else return 3 end end
if claim and claim~=ARGV[1] then return 4 end
if redis.call('EXISTS',KEYS[2])==1 then return 5 end
if tonumber(redis.call('GET',KEYS[6]) or '0')>=3 then return 6 end
if not claim then
 if tonumber(redis.call('GET',KEYS[4]) or '0')>=3 or tonumber(redis.call('GET',KEYS[5]) or '0')>=tonumber(ARGV[2]) then return 1 end
 redis.call('SET',KEYS[1],ARGV[1],'EX',7200)
 for i=4,5 do redis.call('INCR',KEYS[i]);redis.call('EXPIRE',KEYS[i],90000) end
end
redis.call('INCR',KEYS[6]);redis.call('EXPIRE',KEYS[6],7200)
redis.call('SET',KEYS[2],ARGV[1],'EX',30)
return 0`;
export const SURVEY_FINISH = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 5 end
if ARGV[2]=='done' then redis.call('SET',KEYS[2],'1','EX',7200) end
redis.call('DEL',KEYS[1]);return 0`;
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
    if (result === 1 || result === 6)
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
export function surveyEmail(answers: SurveyAnswers) {
  return [
    `사용 경험 설문 (${SURVEY_VERSION})`,
    "이용자가 별도 동의 후 제출한 설문입니다. 채팅 원문·일기·이용자 연락처는 첨부하지 않습니다.",
    ...surveyQuestions.map(
      (q) => `${q.label}\n${answers[q.key]} / 5 — ${surveyScale[answers[q.key] - 1]}`,
    ),
    `자유 의견\n${answers.comment || "(작성하지 않음)"}`,
  ].join("\n\n");
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
      "설문 이메일 전달을 준비 중이에요. 아직 응답이 전송되지 않았어요.",
    );
  const slot = await gate.enter(sid, cid, rid, answers);
  if (slot.alreadyAccepted) return;
  let accepted = false;
  try {
    const config = configured.data;
    const response = await transport("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `survey/${sid}/${cid}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject: "새 사용 경험 설문 응답",
        text: surveyEmail(answers),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const result = z.object({ id: z.string().min(1) }).safeParse(await response.json());
    if (!response.ok || !result.success) throw new Error();
    accepted = true;
    await slot.finish(true);
  } catch {
    // Timeout may follow provider acceptance. Same payload + same provider key make an explicit retry safe.
    if (!accepted) {
      try {
        await slot.finish(false);
      } catch {}
    }
    throw new AppError(
      503,
      "SURVEY_UNCERTAIN",
      "설문 접수를 확인하지 못했어요. 입력은 유지돼요. 같은 응답으로 다시 확인해 주세요.",
    );
  }
}
