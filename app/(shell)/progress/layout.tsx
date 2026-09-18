import type { ReactNode } from "react";

/**
 * Claude Design ZIP이 실제로 로드하는 Pretendard 웹폰트를 이 라우트에만
 * 적용한다 — AX 전역 폰트 스택(globals.css)은 이름만 나열할 뿐 실제 파일을
 * 로드하지 않아, 한글이 폴백 시스템 폰트로 렌더되며 Design보다 굵고 넓게
 * 잡혀 체감 밀도가 달라지는 원인이었다. 다른 화면에 영향 주지 않도록 전역
 * 폰트 스택은 건드리지 않고 이 세그먼트에만 스타일시트를 추가한다.
 */
export default function ProgressLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" />
      {children}
    </>
  );
}
