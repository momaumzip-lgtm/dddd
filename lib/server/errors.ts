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
