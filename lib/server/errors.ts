export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fallback =
  "지금은 안전한 AI 답변을 확인하지 못했어요. 잠시 쉬었다가 다시 시도해 주세요. 급한 도움이 필요하면 ‘도움 받기’를 열어 주세요.";

export function explainProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (status === 401 || status === 403)
    return new AppError(
      503,
      "KEY",
      "AI 연결 설정을 확인해야 해요. 도움 받기는 계속 이용할 수 있어요.",
    );
  if (status === 400 || status === 404)
    return new AppError(
      503,
      "MODEL",
      "선택한 AI 설정을 확인해야 해요. 이전 대화와 입력은 이 화면에 남아 있어요.",
    );
  if (status === 429 && code === "insufficient_quota")
    return new AppError(
      503,
      "QUOTA",
      "AI 이용 한도를 확인해야 해요. 도움 받기는 계속 이용할 수 있어요.",
    );
  if (status === 429)
    return new AppError(
      429,
      "PROVIDER_LIMIT",
      "AI 서비스가 잠시 혼잡해요. 잠시 후 다시 시도해 주세요.",
    );
  return new AppError(
    503,
    "AI_UNAVAILABLE",
    "답변 연결에 문제가 생겼어요. 입력과 이전 대화는 이 화면에 남아 있어요. 다시 요청할 수 있어요.",
  );
}
