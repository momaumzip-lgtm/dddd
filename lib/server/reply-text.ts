// Structured output checks field boundaries, but a field can still contain model notes.
const outputInstructions =
  /\b(?:JSON\s+malformed|(?:output|return|emit)\s+(?:valid\s+)?JSON\s+only|schema\s+strict|output\s+question\s+string|question\s+(?:field|string)\s+(?:can|must|should)\b|use\s+continue\s*,?\s*sentences|omit\s+extraneous|need\s+natural\s+no\s+question|brief_reply)\b/i;
const internalFields =
  /assistant\s+to\s*=|[{"']\s*(?:sentences|diaryDraft|sourceQuote)["']\s*:|\}\s*\}\s*[a-z]/i;
const invisibleControls =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffc\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\u2045-\u2049\u060c]/;

// A mixed-script word or an instruction appended to a question is a generation artifact.
const modelArtifacts =
  /[가-힣]\p{Script=Cyrillic}|\p{Script=Cyrillic}[가-힣]|↵|\b(?:VEVENT|VCALENDAR|BEGIN:VEVENT|END:VEVENT)\b|[가-힣][a-z]{2,}[가-힣]|단일한\s*질문(?:은|을|만)|질문\s*(?:필드|스키마)에는|답변\s*필드에는/u;

export function hasOutputInstructions(text: string) {
  return (
    outputInstructions.test(text) ||
    internalFields.test(text) ||
    invisibleControls.test(text) ||
    modelArtifacts.test(text)
  );
}
