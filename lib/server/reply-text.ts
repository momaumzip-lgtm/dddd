// Structured output checks field boundaries, but a field can still contain model notes.
const outputInstructions =
  /\b(?:JSON\s+malformed|(?:output|return|emit)\s+(?:valid\s+)?JSON\s+only|schema\s+strict|output\s+question\s+string|question\s+(?:field|string)\s+(?:can|must|should)\b|use\s+continue\s*,?\s*sentences|omit\s+extraneous|need\s+natural\s+no\s+question|brief_reply)\b/i;
const internalFields =
  /assistant\s+to\s*=|[{"']\s*(?:sentences|diaryDraft|sourceQuote)["']\s*:|\}\s*\}\s*[a-z]/i;
const invisibleControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffc]/;

export function hasOutputInstructions(text: string) {
  return outputInstructions.test(text) || internalFields.test(text) || invisibleControls.test(text);
}
