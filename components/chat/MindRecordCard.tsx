"use client";

import { Copy, PencilLine } from "lucide-react";
import { useState } from "react";
import type { MindRecord } from "@/lib/exploration";

const sections = [
  ["needs", "오늘 발견한 숨겨진 욕구"],
  ["situation", "오늘 내가 마주한 상황"],
  ["emotions", "처음 알아차린 감정"],
  ["meaning", "감정 뒤에 있었던 마음"],
  ["connection", "내가 그렇게 반응했던 이유"],
  ["discovery", "오늘 새롭게 알아차린 나"],
  ["care", "앞으로 내 마음을 돌보는 방법"],
  ["message", "오늘 나에게 건네는 한마디"],
] as const;

export default function MindRecordCard({
  record,
  onChange,
}: {
  record: MindRecord;
  onChange: (record: MindRecord) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(record);
  const [status, setStatus] = useState("");
  const shown = editing ? edited : record;
  async function copy() {
    const text = sections
      .map(([field, label]) => {
        const value = shown[field];
        const content = Array.isArray(value) ? value.filter(Boolean).join("\n") : value.trim();
        return content ? label + "\n" + content : "";
      })
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("마음 기록을 복사했어요.");
    } catch {
      setStatus("복사할 수 없어요. 필요한 문장을 고른 뒤 직접 복사해 주세요.");
    }
  }
  return (
    <section className="reflection-note mind-record" aria-label="마음 기록">
      <h2>오늘의 마음 기록</h2>
      {sections.map(([field, label]) => {
        const value = shown[field];
        const list = Array.isArray(value);
        if (!editing && (!value.length || (Array.isArray(value) && !value.some(Boolean))))
          return null;
        if (editing)
          return (
            <label key={field} className={field === "needs" ? "mind-need" : "mind-section"}>
              <strong>{label}</strong>
              <textarea
                rows={field === "needs" ? 3 : 2}
                maxLength={
                  list ? 500 : field === "connection" ? 320 : field === "discovery" ? 280 : 240
                }
                value={list ? value.join("\n") : value}
                onChange={(event) => {
                  const value = event.target.value;
                  setEdited({
                    ...edited,
                    [field]: list
                      ? value
                          .split("\n")
                          .slice(0, field === "needs" ? 3 : 2)
                          .map((line) => line.slice(0, 180))
                      : value,
                  });
                }}
              />
            </label>
          );
        return (
          <section key={field} className={field === "needs" ? "mind-need" : "mind-section"}>
            <h3>{label}</h3>
            {list ? (
              <ul>
                {value.filter(Boolean).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>{value}</p>
            )}
          </section>
        );
      })}
      <div className="record-actions">
        <button
          type="button"
          onClick={() => {
            if (editing)
              onChange({
                ...edited,
                needs: edited.needs.map((line) => line.trim()).filter(Boolean),
                care: edited.care.map((line) => line.trim()).filter(Boolean),
              });
            else setEdited(record);
            setEditing(!editing);
          }}
        >
          <PencilLine size={15} />
          {editing ? "편집 마치기" : "기록 고치기"}
        </button>
        <button type="button" onClick={copy}>
          <Copy size={15} /> 기록 복사
        </button>
      </div>
      <small role="status">{status}</small>
    </section>
  );
}
