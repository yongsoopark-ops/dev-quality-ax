import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "개발품질 AX",
  // 이번 배포는 사내 베타 테스트용 — 이미 로그인이 필수라 별도 접근 제어를
  // 새로 추가하지는 않지만(요청사항), 검색엔진 노출만 최소한으로 막는다.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
