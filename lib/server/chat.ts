import type { Message } from "../config";
import type { Safety, Reply } from "./schemas";
import { fallback, AppError } from "./errors";
import {
  urgent,
  retainRisk,
  wantsNoQuestions,
  validateReply,
  safetyText,
  hasSafetyClarification,
  safetyReply,
} from "./safety";
import { MAX_HISTORY_MESSAGES } from "./schemas";
import type { Gate } from "./limits";
export interface Provider {
  moderate(text: string): Promise<{ flagged: boolean; categories: unknown }>;
  classify(
    messages: Message[],
    signals: unknown,
    previous: Safety,
  ): Promise<{
    safety: Safety;
    harmfulRequest: boolean;
    noQuestions: boolean;
    safetyResolved?: boolean;
  }>;
  generate(
    messages: Message[],
    summary: boolean,
    stage: string,
    noQuestions: boolean,
  ): Promise<Reply>;
  audit(messages: Message[], candidate: string): Promise<{ safe: boolean }>;
}
export async function runChat(
  args: {
    sid: string;
    cid: string;
    rid: string;
    revision: number;
    safety: Safety;
    stage: string;
    history: Message[];
    message: string;
    summary: boolean;
  },
  gate: Gate,
  ai: Provider,
) {
  const slot = await gate.enter(args.sid, args.cid, args.rid, args.revision);
  const messages: Message[] = [...args.history, { role: "user", content: args.message }];
  let safety = args.safety,
    stage = args.stage,
    body = "",
    phase = "input_moderation",
    notice = false,
    committed = false;
  try {
    safety = retainRisk(safety, urgent(args.message));
    if (safety === "emergency" || safety === "violence") body = safetyText[safety];
    else {
      try {
        const inputCheck = await ai.moderate(messages.map((m) => m.content).join("\n"));
        phase = "routing";
        const route = await ai.classify(messages, inputCheck.categories, safety);
        safety = retainRisk(
          safety,
          route.safety,
          route.safetyResolved === true && hasSafetyClarification(args.message),
        );
        if (safety !== "normal") body = safetyReply(args.safety, safety);
        else if (route.harmfulRequest) body = safetyText.refusal;
        else {
          const noQuestions = route.noQuestions || wantsNoQuestions(args.message) || args.summary;
          await slot.extra();
          phase = "generation";
          const reply = await ai.generate(messages, args.summary, stage, noQuestions);
          safety = retainRisk(safety, reply.safety);
          if (safety !== "normal") body = safetyText[safety];
          else if (!validateReply(reply, noQuestions)) {
            console.warn("ai_check_rejected", { phase: "reply_format" });
            body = fallback;
            notice = true;
          } else {
            const candidate = [reply.body, reply.question].filter(Boolean).join(" ");
            phase = "output_moderation";
            const outputCheck = await ai.moderate(candidate);
            await slot.extra();
            phase = "output_review";
            const audit = await ai.audit(messages, candidate);
            if (outputCheck.flagged || !audit.safe) {
              console.warn("ai_check_rejected", { phase: "output_review" });
              body = fallback;
              notice = true;
            } else {
              body = candidate;
              stage = reply.stage;
            }
          }
        }
      } catch (error) {
        // Operational diagnostics only. Never log prompts, replies, request objects or SDK errors.
        console.warn("ai_request_failed", {
          phase,
          code: error instanceof AppError ? error.code : "PROVIDER_RESPONSE",
        });
        if (
          error instanceof AppError &&
          ["AI_TIMEOUT", "AI_CONNECTION", "CANCELLED"].includes(error.code)
        )
          throw error;
        if (error instanceof AppError && [429, 409].includes(error.status)) throw error;
        const status =
          typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
        if (status === 401 || status === 403)
          throw new AppError(
            503,
            "KEY",
            "AI 연결 설정을 확인해야 해요. 도움 받기는 계속 이용할 수 있어요.",
          );
        if (status === 404 || status === 400)
          throw new AppError(
            503,
            "MODEL",
            "선택한 AI 설정을 확인해야 해요. 도움 받기는 계속 이용할 수 있어요.",
          );
        const code =
          typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (status === 429 && code === "insufficient_quota")
          throw new AppError(
            503,
            "QUOTA",
            "AI 이용 설정을 확인해야 해요. 도움 받기와 일기 틀은 계속 이용할 수 있어요.",
          );
        if (status === 429)
          throw new AppError(
            429,
            "PROVIDER_LIMIT",
            "AI 서비스가 잠시 혼잡해요. 입력은 보존돼요. 잠시 후 다시 시도해 주세요.",
          );
        if (status === 408)
          throw new AppError(
            504,
            "AI_TIMEOUT",
            "답변 확인 시간이 초과됐어요. 입력은 그대로 두고 잠시 후 다시 시도해 주세요.",
          );
        if (status >= 500 && !(error instanceof AppError))
          throw new AppError(
            503,
            "AI_UNAVAILABLE",
            "AI 서비스가 잠시 응답하지 않아요. 입력은 그대로 두고 잠시 후 다시 시도해 주세요.",
          );
        // Never return an unreviewed candidate, including on audit/moderation failure.
        body = fallback;
        notice = true;
      }
    }
    const next = [...messages, { role: "assistant" as const, content: body }];
    await slot.finish(args.revision + 1);
    committed = true;
    return {
      body,
      history: next,
      safety,
      stage,
      notice,
      revision: args.revision + 1,
      conversationLimit: next.length >= MAX_HISTORY_MESSAGES,
    };
  } finally {
    if (!committed) {
      try {
        await slot.finish();
      } catch {
        /* lock expires; never bypass the shared store */
      }
    }
  }
}
