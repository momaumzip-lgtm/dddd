"use client";
import { supportLink } from "@/lib/service-info";
export default function ChatError({ retry }: { retry: () => void }) {
  return (
    <main className="app-shell">
      <section className="completion-card">
        <h1>화면을 다시 확인해야 해요</h1>
        <p>화면을 복구하지 못했어요. 아래 버튼으로 다시 열면 현재 대화는 초기화될 수 있어요.</p>
        <button className="primary" onClick={retry}>
          화면 다시 열기
        </button>
        <a href={supportLink}>운영자에게 문의하기</a>
      </section>
    </main>
  );
}
