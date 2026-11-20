import type { Metadata } from "next";
import "./chat.css";

export const metadata: Metadata = {
  title: process.env.APP_NAME || "마음 한걸음",
  description: "감정과 생각을 정리하는 AI 대화 도우미",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
