import type { Message } from "../config";
import { ZodError } from "zod";
import type { responsePlan } from "../conversation";
import {
  emotionCatalog,
  emotionLabel,
  emotionItems,
  itemLabel,
  selectionContext,
  unknownEmotion,
  type EmotionSelection,
} from "../emotions";
import {
  isControlText,
  type ConversationStage,
  type EvidencePointer,
  type Exploration,
  type ExplorationControl,
  type ExplorationView,
  type MindRecord,
  type Observation,
} from "../exploration";
import { preserveAttribution } from "./attribution";
import { AppError } from "./errors";
import { hasOutputInstructions, selectSentences, sentenceBoundaries } from "./reply-text";
import { retainRisk, safetyReply, safetyText } from "./safety";
import type { Safety } from "./schemas";
import type { StreamingProvider, StreamReply } from "./stream-chat";

export const explorationDirections: Record<ConversationStage, string> = {
  CONTEXT_EXPLORATION: "오늘 마음에 남은 실제 장면 한 가지부터 물어봅니다.",
  EMOTION_IDENTIFICATION:
    "그 장면에서 어떤 느낌이 들었는지 구체적으로 묻습니다. 이미 밝힌 감정은 반복해 묻지 않습니다. 하나로 고르기 어렵다면 복합 감정을 허용합니다.",
  AUTOMATIC_THOUGHT:
    "그때 순간적으로 떠오른 생각 하나를 이미 말한 장면에 붙여 묻습니다. 실제 사실과 그때 그렇게 느낀 해석을 구분합니다.",
  PERSONAL_MEANING:
    "방금 말한 생각이나 장면이 자신에게 왜 유난히 마음에 남았는지, 그 차이를 알 수 있는 구체적 한 가지를 묻습니다.",
  UNDERLYING_NEED:
    "상대가 어떤 말을 하거나 어떻게 행동해줬다면 달랐을지 살피거나, 이미 밝힌 바람 밑에 무엇이 중요했는지 한 가지 더 좁힙니다.",
  NEED_VALIDATION:
    "제공된 잠정적인 욕구 한 가지만 검토합니다. 핵심 표현을 그대로 넣고 짧게 맞는지 여쭙습니다. 그 표현이 가까운지는 사용자가 결정합니다.",
  REFRAMING:
    "확인한 욕구를 존중하면서 그때 스친 해석과 실제로 확인한 사실이 어떻게 달랐는지, 혹은 그때의 나에게 어떤 부담이 있었는지 살핍니다. 억지로 좋은 의미를 덧붙이지 않습니다.",
  REFLECTION:
    "확인된 마음과 본인의 반응을 한 번 연결해, 그것을 알게 된 지금 달라 보이는 한 가지 또는 자신을 챙길 작은 방법을 묻습니다. 기록 권유는 화면에서 제공합니다.",
  RECORD_GENERATION: "확인된 내용으로 요청한 기록을 만듭니다.",
  SURVEY: "설문 선택은 화면에서 표시합니다.",
  COMPLETED: "현재 대화의 마무리를 표시합니다.",
};

const pacingDirections: Record<ReturnType<typeof selectionContext>["pace"], string> = {
  low: "담백하게 받아주고 이미 나온 장면과 관련된 구체적인 질문 하나를 바로 합니다. 감정을 크게 해석하지 않습니다.",
  medium: "마음에 남은 말을 한 가지 짚고 중요한 이유에 가까워지는 쉬운 질문을 합니다.",
  high: "사용자가 직접 표현한 큰 감정에 짧고 따뜻하게 반응합니다. 원인 설명을 요구하지 않고 같은 장면에서 한두 마디로 답할 만한 질문을 합니다.",
  veryHigh:
    "강한 감정에 따뜻하게 반응하고 한두 마디만 해도 된다는 선택권을 줍니다. 상태나 계속 이야기할 수 있는지 묻는다면 그것만 질문합니다. 강한 기쁨에는 그 기쁨의 장면 안에서 묻습니다.",
  unknown: "강도를 추정해 말하지 않고 실제로 꺼낸 이야기에 맞춰 질문합니다.",
};

const compact = (text: string) => text.replace(/[\s.?!？！。,…'’‘“”]/g, "");
const futureCareQuestion = (text: string) =>
  /비슷한|다음(?:에|번)|앞으로/.test(text) &&
  /어떻게|무엇|뭘|뭐/.test(text) &&
  /챙기|해\s*(?:보[고는]|볼|줄|주고)|돌보|하고 싶|작은\s*(?:행동|일)/.test(text);
const questionFocus = (text: string) => {
  const phrase = compact(text);
  if (/생각.{0,8}(?:떠올|스쳤|들었)|(?:떠오른|스친).{0,8}생각/.test(phrase)) return "thought";
  if (/뭐라고.{0,5}했|어떻게.{0,8}(?:행동|하셨어요)|실제로.{0,5}(?:하셨|했어)/.test(phrase))
    return "reaction";
  if (/바랐|원했|듣고싶|해줬으면/.test(phrase)) return "wish";
  if (/느낌|어떤마음|어떤감정/.test(phrase)) return "feeling";
  return null;
};
const lastQuestion = (text: string) =>
  [...sentenceBoundaries.segment(text)]
    .map(({ segment }) => segment.trim())
    .filter((sentence) => /[?？]$/.test(sentence))
    .at(-1) || "";
const directNo =
  /^(?:아니(?:요|에요|예요|야)?|아뇨)(?:[\s.,，!]|$)|그(?:런)?\s*(?:뜻|의미|해석|느낌).{0,6}아니|그렇(?:진|지)\s*않|그것보다는|그보다는/;
const directYes = /^(?:네|응|예|맞아(?:요)?|맞습니다|그렇죠|그게 맞아요)(?:[\s.,，!]|$)/;
const uncertain = /^(?:(?:아직|잘|그냥|정확히)\s*)?모르겠(?:어요|어|습니다)[.!\s]*$/;
const continueRequest =
  /(?:조금|좀|계속|더|아직).{0,18}(?:이야기|얘기|살펴|생각해|말하고)|정리.{0,5}(?:말고|싶지|아직)/;

export type GuidedEvidence = ReturnType<typeof evidenceFor>;
export type GuidedPrompt = {
  stage: ConversationStage;
  evidence: GuidedEvidence;
  candidate: string;
  control?: ExplorationControl;
  intensity: ReturnType<typeof selectionContext>["pace"];
  intensityGuidance: string;
  ordinaryDistress?: boolean;
  clarifying?: boolean;
  gentleFollowup?: boolean;
  openingPace?: boolean;
  paceCheck?: boolean;
};
type Allowance = { extra(): Promise<void> };
type Plan = ReturnType<typeof responsePlan>;

function quote(messages: Message[], ref?: EvidencePointer) {
  return ref ? messages[ref[0]]?.content.slice(ref[1], ref[1] + ref[2]) || "" : "";
}
function refFor(messages: Message[], text: string, from: number): EvidencePointer | undefined {
  const value = text.trim();
  if (!value || value.length > 160 || isControlText(value)) return;
  for (let i = messages.length - 1; i >= from; i--) {
    const message = messages[i];
    if (message.role !== "user" || isControlText(message.content)) continue;
    const offset = message.content.indexOf(value);
    if (offset >= 0) return [i, offset, value.length];
  }
}
function evidenceFor(state: Exploration, messages: Message[], emotion: EmotionSelection) {
  return {
    situation: quote(messages, state.situation),
    initialEmotion: emotionCatalog.find(({ id }) => id === state.initialEmotionId)?.label || "",
    selectedEmotion:
      emotion.emotionId === "unknown" ||
      (state.start > 0 && !state.initialEmotionId && state.selectionVersion === emotion.version)
        ? ""
        : emotionLabel(emotion),
    selectedEmotions:
      state.start === 0 || state.selectionVersion !== emotion.version || state.initialEmotionId
        ? emotionItems(emotion)
            .filter((item) => item.emotionId !== "unknown")
            .map((item) => ({
              label: itemLabel(item),
              intensity: item.intensityPercent ?? item.intensityBand,
            }))
        : [],
    expressedEmotions: (state.emotions || []).map((ref) => quote(messages, ref)).filter(Boolean),
    thought: quote(messages, state.thought),
    meaning: quote(messages, state.meaning),
    wish: quote(messages, state.wish),
    confirmedNeeds: (state.confirmed || [])
      .map(({ quote: ref, answer }) => ({
        meaning: quote(messages, ref),
        answer: quote(messages, answer),
      }))
      .filter(({ meaning }) => meaning),
    rejected: (state.rejected || []).map((ref) => quote(messages, ref)).filter(Boolean),
    insight: quote(messages, state.insight),
    reframe: quote(messages, state.reframe),
  };
}
function nextStage(
  state: Exploration,
  evidence: GuidedEvidence,
  candidate: string,
): ConversationStage {
  if (!evidence.situation) return "CONTEXT_EXPLORATION";
  if (
    !evidence.selectedEmotion &&
    !evidence.expressedEmotions.length &&
    !state.skipped?.includes("EMOTION_IDENTIFICATION")
  )
    return "EMOTION_IDENTIFICATION";
  if (!evidence.thought && !evidence.meaning && !state.skipped?.includes("AUTOMATIC_THOUGHT"))
    return "AUTOMATIC_THOUGHT";
  if (!evidence.meaning && !state.skipped?.includes("PERSONAL_MEANING")) return "PERSONAL_MEANING";
  if (!evidence.confirmedNeeds.length) return candidate ? "NEED_VALIDATION" : "UNDERLYING_NEED";
  return evidence.reframe || evidence.insight || state.skipped?.includes("REFRAMING")
    ? "REFLECTION"
    : "REFRAMING";
}
function isReady(evidence: GuidedEvidence) {
  return Boolean(
    evidence.situation &&
    (evidence.selectedEmotion || evidence.expressedEmotions.length) &&
    evidence.meaning &&
    evidence.confirmedNeeds.length &&
    (evidence.insight || evidence.reframe),
  );
}
function viewFor(
  state: Exploration,
  evidence: GuidedEvidence,
  emotion: EmotionSelection,
  turns: number,
  question: string | null,
  record: MindRecord | null,
  completionReason: ExplorationView["completionReason"],
): ExplorationView {
  const explored: ConversationStage[] = [];
  if (evidence.situation) explored.push("CONTEXT_EXPLORATION");
  if (evidence.selectedEmotion || evidence.expressedEmotions.length)
    explored.push("EMOTION_IDENTIFICATION");
  if (evidence.thought) explored.push("AUTOMATIC_THOUGHT");
  if (evidence.meaning) explored.push("PERSONAL_MEANING");
  if (evidence.wish || state.pending) explored.push("UNDERLYING_NEED");
  if (evidence.confirmedNeeds.length) explored.push("NEED_VALIDATION");
  if (evidence.reframe) explored.push("REFRAMING");
  if (evidence.insight) explored.push("REFLECTION");
  if (record) explored.push("RECORD_GENERATION");
  const ready = isReady(evidence);
  return {
    conversationStage: state.stage,
    userTurnCount: turns,
    readyToComplete: ready,
    offerRecord: ready && !state.deferred && !completionReason,
    exploredTopics: explored,
    detectedEmotions: evidence.expressedEmotions,
    emotionIntensity: {
      reported:
        state.start === 0 || evidence.selectedEmotion ? (emotion.intensityPercent ?? null) : null,
      estimated: state.estimatedIntensity ?? "unknown",
    },
    nextQuestion: question,
    userRequestedCompletion: Boolean(completionReason),
    completionReason,
    finalRecord: record,
    surveyStatus: record ? "available" : "unavailable",
  };
}
const recordFields = (record: MindRecord) =>
  [
    record.situation,
    record.emotions,
    record.meaning,
    ...record.needs,
    record.connection,
    record.discovery,
    ...record.care,
    record.message,
  ].filter(Boolean);
const clinicalOutput =
  /(?:당신은|사용자는).{0,24}(?:우울증|정신질환|장애)(?:입니다|이에요)|(?:복용량|용량).{0,12}(?:늘리|줄이|증량|중단)/;
const validText = (text: string) =>
  /[가-힣]/.test(text) && !hasOutputInstructions(text) && !clinicalOutput.test(text);
const repairable = (error: unknown) =>
  error instanceof SyntaxError ||
  error instanceof ZodError ||
  (error instanceof AppError &&
    ["FORMAT", "STREAM_FORMAT", "EMPTY", "ATTRIBUTION"].includes(error.code));

export async function runGuidedTurn({
  ai,
  slot,
  history,
  latest,
  plan,
  emotion,
  previous,
  control,
  restart,
  turns,
}: {
  ai: StreamingProvider;
  slot: Allowance;
  history: Message[];
  latest: string;
  plan: Plan;
  emotion: EmotionSelection;
  previous?: Exploration;
  control?: ExplorationControl;
  restart: boolean;
  turns: number;
}) {
  const messages: Message[] = [...history, { role: "user", content: latest }];
  const index = history.length;
  let state: Exploration =
    previous && !restart
      ? { ...previous }
      : {
          stage: "CONTEXT_EXPLORATION",
          start: restart ? index : 0,
          initialEmotionId: restart ? undefined : emotion.emotionId,
          selectionVersion: emotion.version,
        };
  if (state.start > 0 && !state.initialEmotionId && state.selectionVersion !== emotion.version) {
    state.initialEmotionId = emotion.emotionId;
    state.selectionVersion = emotion.version;
  }
  const currentText = plan.recordStory ?? (isControlText(latest) ? "" : latest);
  // Keep a short verbatim window. Older confirmed evidence is supplied as exact excerpts.
  let recent = [
    ...history.slice(Math.max(state.start, index - 12)),
    ...(currentText ? [{ role: "user" as const, content: currentText }] : []),
  ];
  const evidenceMessages = [...history, { role: "user" as const, content: currentText }];
  const before = evidenceFor(state, messages, emotion);
  const wantsRecord = plan.forceComplete || control === "record" || control === "end";
  const movesOn = control === "skip" || control === "unsure";
  const budgetExhausted = (error: unknown) =>
    error instanceof AppError && error.code === "CHAT_BUDGET";
  const lightlyDisappointed =
    plan.briefDisappointment && /그냥|조금|좀|살짝|약간/.test(currentText);
  const gentleFollowup =
    plan.briefDisappointment && !lightlyDisappointed && Boolean(history.length);
  const needsNoQuestions =
    plan.listening && !movesOn && !gentleFollowup && control !== "more" && control !== "explore";
  const declinesRecord =
    wantsRecord &&
    ((plan.declinesDiary && control !== "record") ||
      /(?:기록|일기|다이어리).{0,14}(?:하지\s*말|안\s*(?:쓸|할)|싫|필요\s*없|남기고\s*싶지)/.test(
        latest,
      ));
  const previousQuestion = state.pending;
  let observation: Observation | undefined;
  if (currentText && !declinesRecord && (wantsRecord || !needsNoQuestions)) {
    await slot.extra();
    try {
      observation = await ai.reviewExploration(recent, before);
    } catch (error) {
      if (!repairable(error) && !(wantsRecord && budgetExhausted(error))) throw error;
    }
  }
  const incoming = observation?.situation
    ? refFor(evidenceMessages, observation.situation, index)
    : undefined;
  if (observation?.newTopic && incoming && state.situation && !wantsRecord) {
    state = { stage: "CONTEXT_EXPLORATION", start: index, selectionVersion: emotion.version };
    recent = recent.slice(-1);
  }
  if (!state.situation && !observation && currentText.length >= 12 && !uncertain.test(currentText))
    state.situation = [index, 0, Math.min(160, currentText.length)];
  const rejection = Boolean(
    currentText &&
    (directNo.test(currentText) ||
      (observation?.rejected && /아니|달라|그보다|것보다는|다른/.test(currentText))),
  );
  if (state.start !== index && previousQuestion && rejection) {
    state.rejected = [...(state.rejected || []), previousQuestion.question].slice(-3);
    state.pending = undefined;
  } else if (
    rejection &&
    observation?.rejected &&
    state.confirmed?.length &&
    /아까|앞서|방금|그\s*(?:욕구|해석|마음)/.test(currentText)
  ) {
    const retracted = state.confirmed.at(-1);
    if (retracted) state.rejected = [...(state.rejected || []), retracted.quote].slice(-3);
    state.confirmed = state.confirmed.slice(0, -1);
  } else if (
    state.start !== index &&
    previousQuestion &&
    previousQuestion.question[0] === index - 1 &&
    directYes.test(currentText) &&
    !/[?？]|그렇긴|맞긴|그것도\s*있지만|잘\s*모르겠/.test(currentText)
  ) {
    const answer: EvidencePointer = [index, 0, Math.min(160, currentText.length)];
    state.confirmed = [
      ...(state.confirmed || []),
      { quote: previousQuestion.need || previousQuestion.question, answer },
    ].slice(-3);
    state.pending = undefined;
  } else if (previousQuestion && previousQuestion.question[0] !== index - 1) {
    state.pending = undefined;
  }
  if (observation) {
    for (const key of ["situation", "thought", "meaning", "wish", "insight", "reframe"] as const) {
      const found = refFor(evidenceMessages, observation[key], state.start);
      if (found) state[key] = found;
    }
    const emotions = observation.emotions
      .map((item) => refFor(evidenceMessages, item, state.start))
      .filter((item): item is EvidencePointer => item !== undefined);
    if (emotions.length) state.emotions = emotions;
    if (observation.estimatedIntensity !== "unknown" && (emotions.length || state.emotions?.length))
      state.estimatedIntensity = observation.estimatedIntensity;
    const declared = refFor(evidenceMessages, observation.confirmedNeed, state.start);
    if (
      declared &&
      compact(observation.confirmedNeed) !== compact(observation.wish) &&
      (!rejection || declared[0] === index) &&
      !(state.confirmed || []).some(
        ({ quote: ref }) => compact(quote(messages, ref)) === compact(observation.confirmedNeed),
      )
    ) {
      state.confirmed = [...(state.confirmed || []), { quote: declared }].slice(-3);
      state.pending = undefined;
    }
  }
  if (state.pending && (control === "skip" || control === "unsure" || uncertain.test(currentText)))
    state.pending = undefined;
  if (control === "skip")
    state.skipped = [...new Set([...(state.skipped || []), state.stage])].slice(-8);
  if (control === "more" || continueRequest.test(currentText)) state.deferred = true;
  const evidence = evidenceFor(state, evidenceMessages, emotion);
  const basis = observation?.needBasis
    ? refFor(evidenceMessages, observation.needBasis, state.start)
    : undefined;
  const candidate =
    basis &&
    !rejection &&
    !previousQuestion &&
    !movesOn &&
    observation &&
    !evidence.rejected.some((text) => compact(text).includes(compact(observation.need)))
      ? observation.need
      : "";
  const previousStage = state.stage;
  state.stage = nextStage(state, evidence, candidate);
  if (control === "skip" && state.stage === previousStage && evidence.situation)
    state.stage = evidence.confirmedNeeds.length ? "REFLECTION" : "UNDERLYING_NEED";
  if (control === "explore" && evidence.situation && state.stage === "EMOTION_IDENTIFICATION")
    state.stage = "AUTOMATIC_THOUGHT";

  if (wantsRecord) {
    const ready = isReady(evidence);
    state.stage = declinesRecord ? "COMPLETED" : "RECORD_GENERATION";
    if (declinesRecord)
      return {
        body: "오늘은 여기까지 이야기할게요. 마음을 나눠 주셔서 고마워요.",
        state,
        view: viewFor(state, evidence, emotion, turns, null, null, "without-record"),
        safety: "normal" as Safety,
        questions: 0,
      };
    let final: MindRecord | null = null;
    let hadUnsafeOutput = false;
    // A short explicit ending can use whatever the user supplied. Unknown fields stay empty.
    for (let attempt = 0; attempt < 2 && !final; attempt++) {
      if (attempt) await slot.extra();
      let record: MindRecord;
      try {
        record = await ai.generateMindRecord(recent, evidence, attempt > 0);
      } catch (error) {
        if (budgetExhausted(error)) break;
        if (!repairable(error)) throw error;
        continue;
      }
      const custom = emotionItems(emotion)
        .filter(
          (item) =>
            item.emotionId === "custom" &&
            evidence.selectedEmotions.some(({ label }) => label === item.customLabel) &&
            !record.emotions.includes(item.customLabel),
        )
        .map((item) => item.customLabel);
      if (custom.length) {
        const picked = `처음 적은 감정에는 ${custom.map((label) => `‘${label}’`).join(", ")}도 있었어요.`;
        record.emotions =
          record.emotions && picked.length + record.emotions.length < 239
            ? `${picked} ${record.emotions}`
            : picked;
      }
      if (!evidence.confirmedNeeds.length) record.needs = [];
      if (!evidence.thought && !evidence.meaning && !evidence.insight) record.connection = "";
      if (!evidence.insight && !evidence.reframe && !evidence.confirmedNeeds.length)
        record.discovery = "";
      const fields = recordFields(record);
      if (!fields.length || fields.some((text) => !validText(text))) continue;
      await slot.extra();
      const [reviewed, unsafe] = await Promise.all([
        ai.reviewMindRecord(recent, evidence, record).catch((error) => {
          if (!repairable(error) && !budgetExhausted(error)) throw error;
          return false;
        }),
        ai.moderateOutputs(fields),
      ]);
      if (unsafe.some(Boolean)) hadUnsafeOutput = true;
      else if (reviewed) final = record;
    }
    if (!final) {
      if (hadUnsafeOutput)
        throw new AppError(
          502,
          "OUTPUT_SAFETY",
          "기록을 안전하게 확인하지 못했어요. 입력은 이 화면에 남아 있어요.",
        );
      // Exact user excerpts remain useful when a generated interpretation cannot be verified.
      const record: MindRecord = {
        situation: evidence.situation,
        emotions: evidence.expressedEmotions.join(" · ") || evidence.selectedEmotion,
        meaning: evidence.meaning,
        needs: evidence.confirmedNeeds.flatMap(({ meaning }) =>
          /[?？]$/.test(meaning) ? [] : [meaning],
        ),
        connection: "",
        discovery: evidence.insight,
        care: [],
        message: "오늘의 마음을 돌아본 것만으로도 충분한 한 걸음이에요.",
      };
      if ((await ai.moderateOutputs(recordFields(record))).some(Boolean))
        throw new AppError(502, "OUTPUT_SAFETY", "기록을 안전하게 확인하지 못했어요.");
      final = record;
    }
    state.stage = "SURVEY";
    return {
      body: ready
        ? "오늘 알아차린 마음을 기록에 담았어요."
        : "지금까지 들려주신 이야기로 마음을 정리했어요.",
      state,
      view: viewFor(
        state,
        evidence,
        emotion,
        turns,
        null,
        final,
        ready ? "explored" : "requested-early",
      ),
      safety: "normal" as Safety,
      questions: 0,
    };
  }

  const emotionContext = selectionContext(
    evidence.selectedEmotion || state.start === 0 ? emotion : unknownEmotion,
  );
  const openingPace = !history.length && !needsNoQuestions && !plan.asksForPracticalHelp;
  const positiveOpening =
    emotionContext.category === "positive" ||
    (evidence.expressedEmotions.length > 0 &&
      evidence.expressedEmotions.every((text) =>
        /기쁘|기쁨|신나|즐거|행복|뿌듯|설레|감격/.test(text),
      ));
  const paceCheck = openingPace && !positiveOpening && emotionContext.pace === "veryHigh";
  const paceQuestion = "이 이야기를 지금 조금 더 이어가도 괜찮으세요?";
  const oldQuestions = history
    .slice(-8)
    .filter((m) => m.role === "assistant")
    .map((m) => compact(lastQuestion(m.content)));
  const previousFocus = questionFocus(lastQuestion(history.at(-1)?.content || ""));
  const statedPositive = evidence.expressedEmotions.some((text) =>
    /기쁘|기쁨|신나|즐거|행복|뿌듯|설레|감격|좋았/.test(text),
  );
  const prompt: GuidedPrompt = {
    stage: state.stage,
    evidence,
    candidate,
    control,
    intensity: emotionContext.pace,
    intensityGuidance: pacingDirections[emotionContext.pace],
    clarifying: plan.clarifyQuestion,
    gentleFollowup,
    openingPace,
    paceCheck,
  };
  let body = "";
  let question = "";
  let ambiguousRiskReviewed = false;
  for (let attempt = 0; attempt < 2 && !body; attempt++) {
    if (attempt) await slot.extra();
    let raw: StreamReply;
    try {
      raw = await ai.streamReply(
        recent,
        {
          emotion: emotionContext,
          forceComplete: false,
          listening: needsNoQuestions,
          openingQuestion: !history.length && !needsNoQuestions,
          followupQuestion:
            Boolean(history.length) && !needsNoQuestions && !plan.asksForPracticalHelp,
          asksForPracticalHelp: plan.asksForPracticalHelp,
          turn: turns,
          previousSafety: "normal",
          guided: prompt,
          ...(attempt ? { retryConversation: true } : {}),
        },
        async () => {},
      );
    } catch (error) {
      if (!repairable(error)) throw error;
      continue;
    }
    const safety = retainRisk("normal", raw.safety);
    if (raw.mode === "safety" || safety !== "normal" || raw.mode === "refusal") {
      let risk = safety === "normal" ? "check" : safety;
      if (raw.mode !== "refusal" && risk === "check") {
        if (ambiguousRiskReviewed) continue;
        await slot.extra();
        const routed = await ai.classify(messages, { generatedAmbiguousCheck: true }, "normal");
        if (routed.safety === "normal" && !routed.harmfulRequest) {
          ambiguousRiskReviewed = true;
          prompt.ordinaryDistress = true;
          continue;
        }
        risk = routed.safety === "normal" ? "check" : routed.safety;
      }
      return {
        body: raw.mode === "refusal" ? safetyText.refusal : safetyReply("normal", risk),
        state,
        view: viewFor(state, evidence, emotion, turns, null, null, null),
        safety: raw.mode === "refusal" ? safety : risk,
        questions: 0,
      };
    }
    if (raw.mode !== "continue") continue;
    const fields = raw.sentences.filter(
      (text) =>
        validText(text) &&
        !/(?:오늘\s*(?:의\s*)?(?:다이어리|일기|마음 기록)에|기록에\s*남겨\s*보세요)/.test(text) &&
        (plan.asksForPracticalHelp ||
          !/(?:이렇게|대신).{0,10}(?:말|전)(?:하|해).{0,5}(?:싶|보세요)|(?:제가|챗봇이).{0,18}말해\s*드릴/.test(
            text,
          )),
    );
    const proposed = paceCheck
      ? paceQuestion
      : needsNoQuestions
        ? ""
        : lastQuestion(fields.at(-1) || "");
    if (
      proposed &&
      (proposed.length > 100 ||
        oldQuestions.includes(compact(proposed)) ||
        (control === "skip" && previousFocus && previousFocus === questionFocus(proposed)) ||
        (!statedPositive && /특히 좋았|좋으셨|기쁘셨|뿌듯하셨|행복하셨/.test(proposed)) ||
        (futureCareQuestion(proposed) && oldQuestions.slice(-2).some(futureCareQuestion)) ||
        !selectSentences(proposed, true, false, new Set()).asked)
    )
      continue;
    const plain = selectSentences(fields.join(" "), false, false, new Set()).text;
    const reflection = plan.asksForPracticalHelp
      ? plain
      : [...sentenceBoundaries.segment(plain)][0]?.segment.trim();
    const sentences = [reflection, proposed].filter(Boolean);
    if (!plan.asksForPracticalHelp && sentences.join(" ").length > 200) continue;
    if (!sentences.length || (!needsNoQuestions && !plan.asksForPracticalHelp && !proposed))
      continue;
    const checked: StreamReply = { ...raw, sentences };
    try {
      const [attributed, flags] = await Promise.all([
        preserveAttribution(messages, checked, async (statements, fields, diary, verify) => {
          await slot.extra();
          return ai.checkAttribution(statements, fields, diary, verify);
        }),
        ai.moderateOutputs(sentences),
      ]);
      if (flags.some(Boolean) || attributed.sentences.some((text) => !validText(text))) continue;
      const reply = attributed.sentences.join(" ");
      if (reply !== sentences.join(" ") && (await ai.moderate(reply)).flagged) continue;
      question = proposed ? lastQuestion(attributed.sentences.at(-1) || "") : "";
      body = reply;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "ATTRIBUTION") throw error;
    }
  }
  if (!body && control === "skip" && evidence.situation && previousFocus === "thought") {
    body = "그 일이 있고 나서 바로 어떻게 하셨어요?";
    question = body;
  }
  if (!body && paceCheck) {
    body = `편하신 속도로 이야기해도 괜찮아요. ${paceQuestion}`;
    question = paceQuestion;
  }
  body ||= "말씀해 주신 내용은 여기까지 잘 들었어요. 편하신 만큼 이어서 이야기해 주세요.";
  if (
    needsNoQuestions &&
    /그냥\s*들어|질문\s*말고/.test(currentText) &&
    !/편하신 만큼|듣고 있어/.test(body)
  )
    body += " 편하신 만큼 말씀해 주세요.";
  if (
    candidate &&
    basis &&
    state.stage === "NEED_VALIDATION" &&
    !needsNoQuestions &&
    (!question || !compact(question).includes(compact(candidate)))
  ) {
    const fallback = `그때 느낀 마음이 ‘${candidate.slice(0, 100)}’에 가까웠을까요?`;
    if (
      validText(fallback) &&
      !oldQuestions.includes(compact(fallback)) &&
      !(await ai.moderate(fallback)).flagged
    ) {
      body = fallback;
      question = fallback;
    }
  }
  if (
    question &&
    candidate &&
    basis &&
    compact(question).includes(compact(candidate.slice(0, 100)))
  ) {
    const start = body.lastIndexOf(question);
    const needText = candidate.slice(0, 100);
    const offset = question.indexOf(needText);
    if (start >= 0 && question.length <= 160)
      state.pending = {
        question: [index + 1, start, question.length],
        basis,
        ...(offset >= 0 ? { need: [index + 1, start + offset, needText.length] } : {}),
      };
  }
  return {
    body,
    state,
    view: viewFor(state, evidence, emotion, turns, question || null, null, null),
    safety: "normal" as Safety,
    questions: question ? 1 : 0,
  };
}
