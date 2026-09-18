/**
 * 진행 현황 페이지 공용 레이아웃 — Claude Design ZIP("진행 현황 관리판
 * v2.dc.html")의 &lt;main&gt; 값을 그대로 옮긴다: `padding: 26px 30px 72px`,
 * 자식 Section 간 `gap: 18px`. UI 정합성 재작업 요청(§최상위 기준)에 따라
 * 이 화면은 설비 관리 등 기존 AX 화면의 여백 값(px-8/gap-6)을 따르지 않고
 * Design 값을 그대로 쓴다 — AppShell/Sidebar/Auth/공통 Color·Font token만
 * 재사용 대상이고, 콘텐츠 내부 여백은 Design이 기준이다.
 *
 * max-width — Design은 1440~1920px 기준으로 짜여 있어, 그 이상의 초광폭
 * 화면(2560px 등)에서 본문을 끝까지 늘리면 정규 카드 PW 레일이 지나치게
 * 늘어지고 우측에 의미 없는 여백만 남는다. 1680px에서 자르고 왼쪽(사이드바
 * 옆)에 붙인다 — 가운데 정렬은 사이드바 옆 콘텐츠가 화면 중앙으로 쏠려
 * 보이는 부작용이 있어 쓰지 않는다.
 */
export function ProgressPageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full max-w-[1680px] flex-col gap-[18px] px-[30px] pb-[72px] pt-[26px]">{children}</div>;
}
