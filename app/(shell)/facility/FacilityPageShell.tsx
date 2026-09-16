/**
 * 설비 관리 3개 화면(예약 등록/일정 캘린더/사용 통계) 공용 페이지 레이아웃
 * — UI spacing/가시성 개선 요청에 대응한다. AppShell의 <main>은 자체
 * padding이 없어(components/AppShell.tsx 확인 — Schedule/Home 등 기존
 * 페이지들도 각자 page 레벨에서 padding을 직접 준다, 예: schedule/page.tsx
 * "p-8") 지금까지 설비 관리 3개 화면만 padding 없이 좌측·상단에 바로
 * 붙어 있었다 — 새 디자인 시스템을 만들지 않고 기존 관례(px-8 계열)를
 * 그대로 따르되, 상단만 24px(pt-6)로 살짝 좁혀 요청 범위(상단 ~24px,
 * 좌우 24~32px)에 맞췄다.
 *
 * gap-6(24px) 하나로 "제목/설명 ↔ 본문", "Toolbar ↔ Table", "Chart ↔
 * Table" 등 모든 최상위 Section 간격을 통일한다 — 페이지마다 개별 margin
 * 값을 반복해서 적지 않기 위함이다(요청사항 6). Table/Calendar가 필요로
 * 하는 가로 폭은 이 wrapper가 max-width를 전혀 주지 않으므로 그대로
 * 유지된다.
 */
export function FacilityPageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6 px-8 pt-6 pb-8">{children}</div>;
}
