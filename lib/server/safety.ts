import type { Reply, Safety } from "./schemas";
export const safetyText = {
  emergency:
    "말씀해 주셔서 고마워요. 지금은 몸의 안전을 위해 한국에 계시면 바로 119에 연락하거나 곁의 사람에게 대신 요청해 주세요. 혼자 있지 말고 가까운 사람에게 지금 상황을 알려 주세요. 해외에 계시면 현지 긴급전화로 도움을 요청해 주세요.",
  violence:
    "지금은 안전이 먼저예요. 가능하면 위험한 사람이나 물건에서 거리를 두고 안전한 곳으로 이동해 주세요. 한국에서 경찰의 긴급 도움이 필요하면 112, 다치셨거나 응급 구조가 필요하면 119에 연락해 주세요. 해외에서는 현지 긴급전화를 이용해 주세요.",
  check:
    "많이 버거운 마음을 말씀해 주셨네요. 지금 자신이나 다른 사람을 다치게 할 생각이나 바로 실행할 계획이 있나요?",
  refusal:
    "그 행동의 구체적인 방법이나 약의 용량 변경은 안내해 드릴 수 없어요. 약에 관해서는 처방한 의료진이나 약사와 상의해 주세요. 지금 느끼는 어려움은 안전한 방향으로 함께 정리할 수 있어요.",
};
// High-confidence fast path only; contextual classification handles other phrasing and moderation signals.
export function urgent(text: string): Safety {
  const pattern =
    /(방금|지금|오늘).{0,24}(약.{0,12}(많이|과다|한꺼번에).{0,6}(먹었|삼켰)|(죽으려고|자살하려고).{0,12}(준비|실행)|피가.{0,8}(안 멈|멈추지))/gu;
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(Math.max(0, match.index - 24), match.index);
    const suffix = text.slice(match.index + match[0].length, match.index + match[0].length + 24);
    // Qualifiers apply to the matched statement, not an unrelated earlier sentence.
    if (
      /(예전|작년|지난해|과거).{0,10}$/.test(prefix) ||
      /(영화|소설|꿈)에서.{0,12}$/.test(prefix) ||
      /(라는|라고).{0,12}(대사|인용|문장)/.test(suffix)
    )
      continue;
    if (/약/.test(match[0]) && /안\s*(먹|삼)|먹지\s*않/.test(match[0])) continue;
    return "emergency";
  }
  return "normal";
}
export function retainRisk(previous: Safety, next: Safety, checkResolved = false): Safety {
  // A fresh medical emergency takes precedence over a previous routing category.
  if (next === "emergency") return "emergency";
  // Confirmed acute states stay latched; resolving an ambiguous check needs multiple signals below.
  if (previous === "emergency" || previous === "violence") return previous;
  if (previous === "check" && next === "normal" && !checkResolved) return "check";
  return next;
}
export function hasSafetyClarification(message: string) {
  return (
    message.length >= 20 &&
    /(지금|현재|이제|함께|곁에|있어|있습)/.test(message) &&
    /안전(한|하게|하다고|해|합니다|하고)/.test(message) &&
    /(생각|의도|계획).{0,14}(없|않)/.test(message)
  );
}
export function safetyReply(previous: Safety, current: Exclude<Safety, "normal">) {
  if (previous === "check" && current === "check")
    return "말씀을 듣고 있어요. 아직 현재의 안전을 확인하기 어려워 일반적인 탐색은 잠시 멈출게요. 가까운 믿을 수 있는 사람의 도움을 받아 주세요. 필요한 지원은 ‘도움 받기’에서 확인할 수 있어요.";
  return safetyText[current];
}
export const wantsNoQuestions = (text: string) =>
  /그냥\s*들어|질문.{0,8}(싫|하지\s*마|말고|원하지)|그만할|끝낼|모르겠/.test(text);
export function validateReply(reply: Reply, noQuestions: boolean) {
  const text = [reply.body, reply.question].filter(Boolean).join(" ");
  const sentences = text.split(/(?<=[.!?。？！])\s+|\n+/).filter(Boolean);
  if (
    sentences.length > 4 ||
    text.length > 800 ||
    /[?？]/.test(reply.body) ||
    (reply.question &&
      (!/[?？]$/.test(reply.question) || (reply.question.match(/[?？]/g) || []).length !== 1)) ||
    (noQuestions && reply.question)
  )
    return false;
  // Reject obvious compound prompts. A second contextual audit checks meaning, claims, and instructions.
  if (
    reply.question &&
    /그리고|또한|무엇.*어떻|어떤.*왜|나요.*나요|인지.*인지/.test(reply.question)
  )
    return false;
  return true;
}
