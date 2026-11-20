"use client";
import { useRef, useState } from "react";
import { Copy } from "lucide-react";
export default function DiaryDraft({ initial }: { initial: string }) {
  const [draft, setDraft] = useState(initial),
    [feedback, setFeedback] = useState("");
  const revision = useRef(0);
  async function copy() {
    const version = revision.current;
    try {
      await navigator.clipboard.writeText(draft);
      if (version === revision.current) setFeedback("지금 보이는 초안을 복사했어요.");
    } catch {
      if (version === revision.current)
        setFeedback("복사할 수 없어요. 초안에서 글을 선택해 직접 복사해 주세요.");
    }
  }
  return (
    <section className="reflection-note">
      <label>
        <strong>기록 초안</strong>
        <span>내 말에 맞게 고쳐 써도 좋아요.</span>
        <textarea
          value={draft}
          rows={3}
          onChange={(e) => {
            revision.current++;
            setDraft(e.target.value);
            setFeedback("");
          }}
        />
      </label>
      <button type="button" onClick={copy} disabled={!draft.trim()}>
        <Copy size={15} /> 초안 복사
      </button>
      <small role="status">{feedback}</small>
    </section>
  );
}
