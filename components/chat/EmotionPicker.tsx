"use client";
import { useRef, useState } from "react";
import { audience } from "@/lib/service-info";
import { Check } from "lucide-react";
import {
  searchEmotions,
  intensityBands,
  emotionLabel,
  type EmotionSelection,
} from "@/lib/emotions";
export default function EmotionPicker({
  value,
  onDone,
  onCancel,
}: {
  value: EmotionSelection | null;
  onDone: (value: EmotionSelection) => void;
  onCancel?: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(value?.emotionId || null),
    [band, setBand] = useState<EmotionSelection["intensityBand"] | null>(
      value && value.intensityBand !== "unknown" ? value.intensityBand : null,
    ),
    [custom, setCustom] = useState(value?.customLabel || "");
  const [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(!value),
    [customOpen, setCustomOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const intensity = useRef<HTMLFieldSetElement>(null);
  const alternative = useRef<HTMLButtonElement>(null);
  const confirmEmotion = () => {
    setExpanded(false);
    setCustomOpen(false);
    requestAnimationFrame(() => intensity.current?.focus());
  };
  const pick = (id: string) => {
    setChosen(id);
    setBand(null);
    confirmEmotion();
  };
  const selection: EmotionSelection = {
    emotionId: chosen || "unknown",
    customLabel: chosen === "custom" ? custom.trim() : "",
    intensityBand: band || "unknown",
    version: (value?.version || 0) + 1,
  };
  const valid =
    !expanded && chosen !== null && band !== null && (chosen !== "custom" || !!custom.trim());
  const entries = searchEmotions(query, category);
  return (
    <section className="emotion-picker" aria-label="감정과 강도 선택">
      <span className="eyebrow">{expanded ? "감정 선택" : "감정 강도"}</span>
      <h1>
        {expanded ? (
          <>
            지금 마음에 가까운
            <br />
            단어를 골라주세요
          </>
        ) : (
          "그 일을 지금 떠올렸을 때, 이 감정이 얼마나 크게 느껴지나요?"
        )}
      </h1>
      {expanded && (
        <p>
          지금 마음에 가까운 감정을 골라보세요. 대화를 나눈 뒤 원할 때 한두 문장으로 남길 수 있어요.
        </p>
      )}
      {chosen && !expanded ? (
        <div className="selection-card">
          <strong>
            <Check size={18} /> 선택한 감정: {emotionLabel(selection)}
          </strong>
          <button
            onClick={() => {
              setExpanded(true);
              requestAnimationFrame(() => search.current?.focus());
            }}
          >
            다시 고르기
          </button>
        </div>
      ) : (
        <>
          <div className="emotion-tabs" aria-label="감정 분류">
            {[
              ["all", "전체"],
              ["positive", "긍정 감정"],
              ["negative", "부정 감정"],
            ].map(([id, label]) => (
              <button
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
          <label className="sr-only" htmlFor="emotion-search">
            전체 감정에서 찾기
          </label>
          <input
            ref={search}
            id="emotion-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="전체 감정에서 찾기"
            autoComplete="off"
          />
          <button className="skip-catalog" onClick={() => alternative.current?.focus()}>
            감정 목록 건너뛰기
          </button>
          <div className="emotion-catalog" role="group" aria-label="감정 단어 목록">
            {entries.map((e) => (
              <button
                key={e.id}
                aria-pressed={chosen === e.id}
                onClick={() => pick(e.id)}
                data-emotion-id={e.id}
              >
                {chosen === e.id && <Check size={14} />}
                <span>{e.label}</span>
                {query && <small>{e.category === "positive" ? "긍정" : "부정"}</small>}
              </button>
            ))}
            {!entries.length && <p>맞는 단어가 없어요. 검색어를 지우거나 직접 적어도 괜찮아요.</p>}
          </div>
          <p className="catalog-hint" role="status">
            {query.trim()
              ? `전체 감정에서 찾은 단어 ${entries.length}개`
              : `감정 단어 ${entries.length}개 · 목록을 스크롤해 더 보기`}
          </p>
          <div className="emotion-alternatives">
            <button
              ref={alternative}
              aria-pressed={chosen === "unknown"}
              onClick={() => pick("unknown")}
            >
              잘 모르겠어요
            </button>
            <button
              onClick={() => {
                setCustomOpen(true);
                requestAnimationFrame(() => customInput.current?.focus());
                setChosen("custom");
                setBand(null);
              }}
            >
              목록에 없는 감정 직접 쓰기
            </button>
          </div>
          {customOpen && (
            <div className="custom-emotion">
              <label htmlFor="custom-label">내가 느끼는 감정</label>
              <input
                ref={customInput}
                id="custom-label"
                maxLength={40}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                autoComplete="off"
              />
              <button type="button" disabled={!custom.trim()} onClick={confirmEmotion}>
                이 감정 고르기
              </button>
            </div>
          )}
        </>
      )}
      {chosen && !expanded && (
        <fieldset className="intensity-picker" ref={intensity} tabIndex={-1}>
          <legend className="sr-only">감정 강도 고르기</legend>
          <p>정답은 없어요. 지금 느끼는 정도로 골라주세요.</p>
          <div className="intensity-options">
            {intensityBands.map((b) => (
              <button
                type="button"
                key={b.id}
                aria-pressed={band === b.id}
                onClick={() => setBand(b.id)}
              >
                {band === b.id && <Check size={16} />}
                <strong>{b.label}</strong>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="emotion-start">
        <p role="status">
          {expanded
            ? "마음에 가까운 단어를 먼저 골라주세요."
            : band === null
              ? "지금 느끼는 강도를 하나 골라주세요."
              : "고른 마음으로 짧게 이야기해 볼게요."}
        </p>
        <button className="primary" disabled={!valid} onClick={() => onDone(selection)}>
          {onCancel ? "선택 적용하기" : "이 마음으로 시작하기"}
        </button>
        {onCancel && <button onClick={onCancel}>이전 선택 유지하기</button>}
      </div>
      {!onCancel && (
        <footer className="participant-info">
          <span>이용 대상: {audience}</span>
        </footer>
      )}
    </section>
  );
}
