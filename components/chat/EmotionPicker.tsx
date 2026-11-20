"use client";
import { useState } from "react";
import { audience, supportPhone, supportLink } from "@/lib/service-info";
import { Check } from "lucide-react";
import {
  emotionCatalog,
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
      value?.intensityBand || null,
    ),
    [custom, setCustom] = useState(value?.customLabel || "");
  const [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(!value),
    [customOpen, setCustomOpen] = useState(false);
  const pick = (id: string) => {
    setChosen(id);
    setBand(null);
    setExpanded(false);
    setCustomOpen(false);
  };
  const selection: EmotionSelection = {
    emotionId: chosen || "unknown",
    customLabel: custom.trim(),
    intensityBand: band || "unknown",
    version: (value?.version || 0) + 1,
  };
  const valid = chosen !== null && band !== null && (chosen !== "custom" || !!custom.trim());
  const entries = searchEmotions(query, category);
  return (
    <section className="emotion-picker" aria-label="감정과 강도 선택">
      <span className="eyebrow">나를 알아가는 짧은 시간</span>
      <h1>
        지금 마음에 가까운
        <br />
        단어를 골라주세요
      </h1>
      <p>짧게 이야기하고 내 마음을 한두 문장으로 남겨보세요. 대화는 보통 3분 정도예요.</p>
      {chosen && !expanded ? (
        <div className="selection-card">
          <strong>
            <Check size={18} /> 선택한 감정: {emotionLabel(selection)}
          </strong>
          <button onClick={() => setExpanded(true)}>다시 고르기</button>
        </div>
      ) : (
        <>
          <div className="emotion-tabs" aria-label="감정 분류">
            {[
              ["all", "전체"],
              ["positive", "긍정 감정"],
              ["negative", "부정 감정"],
            ].map(([id, label]) => (
              <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>
                {label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="emotion-search">
            전체 감정에서 찾기
          </label>
          <input
            id="emotion-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="감정 찾기 (선택)"
            autoComplete="off"
          />
          <div className="emotion-catalog" role="group" aria-label="감정 단어 목록" tabIndex={0}>
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
          <p className="catalog-hint">
            총 {emotionCatalog.length}개 · 목록을 스크롤하면 더 볼 수 있어요
          </p>
          <div className="emotion-alternatives">
            <button aria-pressed={chosen === "unknown"} onClick={() => pick("unknown")}>
              잘 모르겠어요
            </button>
            <button
              onClick={() => {
                setCustomOpen(true);
                setChosen("custom");
                setBand(null);
              }}
            >
              목록에 없는 감정 직접 쓰기
            </button>
          </div>
          {customOpen && (
            <label className="custom-emotion">
              내가 느끼는 감정
              <input
                maxLength={40}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                autoComplete="off"
              />
              <button
                onClick={() => {
                  if (custom.trim()) setExpanded(false);
                }}
              >
                이 감정 고르기
              </button>
            </label>
          )}
        </>
      )}
      {chosen && (!expanded || customOpen) && (
        <fieldset className="intensity-picker">
          <legend>그 일을 지금 떠올리면, 이 감정이 얼마나 크게 느껴지나요?</legend>
          <p>정확한 수치가 아니어도 괜찮아요. 지금 느껴지는 정도를 골라주세요.</p>
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
                <span>{b.description}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="emotion-start">
        <p role="status">
          {!chosen
            ? "마음에 가까운 단어를 먼저 골라주세요."
            : band === null
              ? "강도를 고르거나 ‘잘 모르겠어요’를 선택해 주세요."
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
          <span>
            문의 및 삭제 요청: <a href={supportLink}>{supportPhone}</a>
          </span>
        </footer>
      )}
    </section>
  );
}
