// Structured output checks field boundaries, but a field can still contain model notes.
const outputInstructions =
  /\b(?:JSON\s+malformed|(?:output|return|emit)\s+(?:valid\s+)?JSON\s+only|schema\s+strict|output\s+question\s+string|question\s+(?:field|string)\s+(?:can|must|should)\b|use\s+continue\s*,?\s*sentences|omit\s+extraneous|need\s+natural\s+no\s+question|brief_reply)\b/i;
const internalFields =
  /assistant\s+to\s*=|[{"']\s*(?:sentences|diaryDraft|sourceQuote)["']\s*:|\}\s*\}\s*[a-z]/i;
const formatNotes =
  /:\s*(?:null|undefined|final|analysis)\s*:|\b(?:null|undefined)\s*(?:불가|허용|대신)|(?:질문|답변).{0,20}(?:string|boolean|schema).{0,12}(?:작성|필드|구조|출력)|(?:질문|답변).{0,16}(?:\d+\s*~\s*\d+\s*자|길이\s*제한).{0,16}(?:요구|작성|출력)/i;
const invisibleControls =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffc\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\u2045-\u2049\u060c]/;

// A mixed-script word or an instruction appended to a question is a generation artifact.
const modelArtifacts =
  /[가-힣]\p{Script=Cyrillic}|\p{Script=Cyrillic}[가-힣]|↵|\b(?:VEVENT|VCALENDAR|BEGIN:VEVENT|END:VEVENT)\b|[가-힣][a-z]{2,}[가-힣]|단일한\s*질문(?:은|을|만)|질문\s*(?:필드|스키마)에는|답변\s*필드에는/u;

export function hasOutputInstructions(text: string) {
  return (
    outputInstructions.test(text) ||
    internalFields.test(text) ||
    formatNotes.test(text) ||
    invisibleControls.test(text) ||
    modelArtifacts.test(text)
  );
}

export const sentenceBoundaries = new Intl.Segmenter("ko", { granularity: "sentence" });
export function selectSentences(
  text: string,
  allowQuestion: boolean,
  diarySummary: boolean,
  displayed: Set<string>,
) {
  const kept: string[] = [];
  let asked = false;
  for (const part of sentenceBoundaries.segment(text)) {
    const sentence = part.segment.trim();
    if (!sentence) continue;
    // The editor supplies its own invitation after the grounded summary.
    if (
      diarySummary &&
      /(?:다이어리|일기|기록|초안).{0,28}(?:남겨|적어|써|복사해|고쳐)\s*(?:보셔도|보세요|두세요|주세요)/.test(
        sentence,
      )
    )
      continue;
    const marks = sentence.match(/[?？؟﹖]/g)?.length ?? 0;
    const question =
      marks > 0 ||
      /(?:느낀|마음에 남은|떠오른|기억나는|힘들었던).{0,18}(?:순간|때|생각|일|말|것)(?:이|은)?\s*있었어요[.。]+$/.test(
        sentence,
      ) ||
      /(?:어떻게|뭐|무슨|어떤|어느|무엇).*(?:했어요|받았어요|들었어요|이?었어요|였어요|있었어요|싶었어요|바랐어요|원했어요|중요해요)요?[.。]*$/.test(
        sentence,
      ) ||
      /까요[,，]\s*아니면/.test(sentence) ||
      /(?:나요|인가요|한가요|떤가요|까요|습니까|어때요|싶으세요|바라세요|원하세요|주실래요|말씀해\s?주세요|말해\s?주세요|알려\s?주세요)[.。]*$/.test(
        sentence,
      );
    if (question) {
      if (
        !allowQuestion ||
        asked ||
        marks > 1 ||
        /그리고|또한|무엇.*어떻|어떤.*왜|인지.*인지/.test(sentence)
      )
        continue;
      asked = true;
    }
    const key = sentence.replace(/[.!?。！？]+$/, "").replace(/\s+/g, "");
    if (!displayed.has(key)) {
      displayed.add(key);
      kept.push(sentence);
    }
  }
  return { text: kept.join(" "), asked };
}
