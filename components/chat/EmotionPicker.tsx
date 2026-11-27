"use client";
import { useRef, useState } from "react";
import { audience } from "@/lib/service-info";
import { Check, X } from "lucide-react";
import {
  searchEmotions,
  intensityBands,
  itemLabel,
  paceFor,
  emotionItems,
  makeEmotionSelection,
  normalizeEmotion,
  MAX_SELECTED_EMOTIONS,
  type EmotionItem,
  type EmotionSelection,
} from "@/lib/emotions";

const empty = (emotionId: string, customLabel = ""): EmotionItem => ({
  emotionId,
  customLabel,
  intensityBand: "unknown",
});

export default function EmotionPicker({
  value,
  onDone,
  onCancel,
}: {
  value: EmotionSelection | null;
  onDone: (value: EmotionSelection) => void;
  onCancel?: () => void;
}) {
  const [items, setItems] = useState<EmotionItem[]>(value ? emotionItems(value) : []);
  const [intensityStep, setIntensityStep] = useState(Boolean(value));
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [feedback, setFeedback] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const intensity = useRef<HTMLFieldSetElement>(null);
  const alternative = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const current = items[active];
  const valid = items.length > 0 && items.every((item) => item.intensityBand !== "unknown");
  const entries = searchEmotions(query, category);

  function add(item: EmotionItem) {
    if (
      items.some(
        (selected) => normalizeEmotion(itemLabel(selected)) === normalizeEmotion(itemLabel(item)),
      )
    ) {
      setFeedback("이미 추가한 감정이에요.");
      return;
    }
    const previous = items.filter((selected) => selected.emotionId !== "unknown");
    if (previous.length >= MAX_SELECTED_EMOTIONS) {
      setFeedback(`감정은 ${MAX_SELECTED_EMOTIONS}개까지 고를 수 있어요.`);
      return;
    }
    setItems([...previous, item]);
    setFeedback("");
  }

  function addTyped() {
    const label = query.trim();
    if (!label || composing.current) return;
    add(empty("custom", label));
    setQuery("");
  }

  function beginIntensity(next = items) {
    setItems(next);
    setActive(
      Math.max(
        0,
        next.findIndex((item) => item.intensityBand === "unknown"),
      ),
    );
    setIntensityStep(true);
    requestAnimationFrame(() => intensity.current?.focus());
  }

  function setStrength(band: EmotionItem["intensityBand"], percent?: number) {
    setItems((previous) =>
      previous.map((item, index) =>
        index === active ? { ...item, intensityBand: band, intensityPercent: percent } : item,
      ),
    );
  }

  return (
    <section className="emotion-picker" aria-label="감정과 강도 선택">
      <span className="eyebrow">{intensityStep ? "감정 강도" : "감정 선택"}</span>
      <h1>
        {intensityStep
          ? "지금 이 감정이 얼마나 크게 느껴지나요?"
          : "지금 느끼고 있는 감정을 입력해주세요."}
      </h1>
      {!intensityStep && (
        <>
          <p>내 감정을 잘 모르겠다면 아래 키워드에서 골라주세요.</p>
          <div className="emotion-entry">
            <label className="sr-only" htmlFor="emotion-search">
              지금 느끼는 감정
            </label>
            <input
              ref={search}
              id="emotion-search"
              value={query}
              maxLength={40}
              enterKeyHint="done"
              placeholder="지금 느끼는 감정을 자유롭게 적어주세요."
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setFeedback("");
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !composing.current &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  addTyped();
                }
              }}
            />
            <button className="secondary" type="button" onClick={addTyped} disabled={!query.trim()}>
              추가
            </button>
          </div>
          {items.length > 0 && (
            <ul className="emotion-chips" aria-label="선택한 감정">
              {items.map((item, index) => (
                <li key={itemLabel(item)}>
                  <span>{itemLabel(item)}</span>
                  <button
                    type="button"
                    aria-label={`${itemLabel(item)} 삭제`}
                    onClick={() => {
                      setItems((previous) => previous.filter((_, order) => order !== index));
                      setFeedback("");
                    }}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {feedback && (
            <p className="catalog-hint" role="status">
              {feedback}
            </p>
          )}
          <div className="emotion-tabs" aria-label="감정 분류">
            {[
              ["all", "전체"],
              ["positive", "긍정 감정"],
              ["negative", "부정 감정"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={(query.trim() ? "all" : category) === id}
                onClick={() => {
                  setCategory(id);
                  setQuery("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="skip-catalog" onClick={() => alternative.current?.focus()}>
            감정 목록 건너뛰기
          </button>
          <div className="emotion-catalog" role="group" aria-label="감정 단어 목록">
            {entries.map((emotion) => {
              const selected = items.some(
                (item) => normalizeEmotion(itemLabel(item)) === normalizeEmotion(emotion.label),
              );
              return (
                <button
                  type="button"
                  key={emotion.id}
                  aria-pressed={selected}
                  data-emotion-id={emotion.id}
                  onClick={() => add(empty(emotion.id))}
                >
                  {selected && <Check size={14} />}
                  <span>{emotion.label}</span>
                </button>
              );
            })}
            {!entries.length && <p>목록에 없어도 추가 버튼으로 입력한 감정을 고를 수 있어요.</p>}
          </div>
          <p className="catalog-hint" role="status">
            {query.trim()
              ? `추천 키워드 ${entries.length}개`
              : `감정 단어 ${entries.length}개 · 목록을 스크롤해 더 보기`}
          </p>
          <div className="emotion-alternatives">
            <button
              ref={alternative}
              type="button"
              onClick={() => beginIntensity([empty("unknown")])}
            >
              잘 모르겠어요
            </button>
          </div>
        </>
      )}
      {intensityStep && current && (
        <>
          <div className="selection-card">
            <strong>
              <Check size={18} />{" "}
              {items.length === 1 ? itemLabel(current) : `선택한 감정 ${items.length}개`}
            </strong>
            <button
              type="button"
              onClick={() => {
                setIntensityStep(false);
                requestAnimationFrame(() => search.current?.focus());
              }}
            >
              다시 고르기
            </button>
          </div>
          {items.length > 1 && (
            <div className="emotion-tabs emotion-strength-tabs" aria-label="강도를 정할 감정">
              {items.map((item, index) => (
                <button
                  key={itemLabel(item)}
                  type="button"
                  aria-pressed={active === index}
                  onClick={() => setActive(index)}
                >
                  {itemLabel(item)}{" "}
                  {item.intensityPercent !== undefined
                    ? `${item.intensityPercent}%`
                    : intensityBands.find((value) => value.id === item.intensityBand)?.shortLabel}
                </button>
              ))}
            </div>
          )}
          <fieldset className="intensity-picker" ref={intensity} tabIndex={-1}>
            <legend className="sr-only">{itemLabel(current)} 강도 고르기</legend>
            <p>정답은 없어요. 지금 느끼는 정도로 골라주세요.</p>
            <div className="intensity-options">
              {intensityBands.map((band) => (
                <button
                  type="button"
                  key={band.id}
                  aria-pressed={current.intensityBand === band.id}
                  onClick={() => setStrength(band.id)}
                >
                  {current.intensityBand === band.id && <Check size={16} />}
                  <strong>{band.label}</strong>
                </button>
              ))}
            </div>
            <details className="intensity-detail">
              <summary>숫자로 강도 고르기 (선택)</summary>
              <label htmlFor="emotion-percent">
                직접 느낀 강도{" "}
                {current.intensityPercent === undefined ? "" : `${current.intensityPercent}%`}
              </label>
              <div>
                <input
                  id="emotion-percent"
                  type="range"
                  min="0"
                  max="100"
                  value={current.intensityPercent ?? 50}
                  onChange={(event) => {
                    const next = Number(event.target.value),
                      pace = paceFor(next);
                    setStrength(pace === "veryHigh" ? "high" : pace, next);
                  }}
                />
                {current.intensityPercent === undefined && (
                  <button type="button" onClick={() => setStrength("medium", 50)}>
                    50% 선택
                  </button>
                )}
              </div>
            </details>
          </fieldset>
        </>
      )}
      <div className="emotion-start">
        <p role="status">
          {intensityStep
            ? valid
              ? "고른 마음으로 이야기해 볼게요."
              : "감정마다 지금 느끼는 강도를 골라주세요."
            : "여러 감정이 함께 느껴져도 괜찮아요."}
        </p>
        <button
          className="primary"
          type="button"
          disabled={intensityStep ? !valid : !items.length}
          onClick={() =>
            intensityStep
              ? onDone(makeEmotionSelection(items, (value?.version || 0) + 1))
              : beginIntensity()
          }
        >
          {intensityStep
            ? onCancel
              ? "선택 적용하기"
              : "이 마음으로 시작하기"
            : "감정 강도 고르기"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            이전 선택 유지하기
          </button>
        )}
      </div>
      {!onCancel && (
        <footer className="participant-info">
          <span>이용 대상: {audience}</span>
        </footer>
      )}
    </section>
  );
}
