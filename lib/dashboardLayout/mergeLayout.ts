import { packKpisBelow, type LayoutableKpi } from "@/lib/dashboardLayout/defaultLayout";
import type { DashboardLayoutItem } from "@/lib/dashboardLayout/types";

/**
 * 저장된 Layout과 현재 활성 KPI 목록을 병합한다.
 * 1. 저장 Layout 중 현재도 활성 상태인 KPI만 유지한다(삭제/비활성 KPI는 자동 제외).
 * 2. 저장 Layout에 없는 신규 활성 KPI는 기존 배치를 건드리지 않고 마지막 빈 공간 아래에
 *    Default 규칙으로 추가한다.
 * Home 로드 시 이 함수 하나만 거치면 최종 Grid 렌더링에 쓸 Layout이 완성된다.
 */
export function mergeDashboardLayout(
  activeKpis: LayoutableKpi[],
  savedItems: DashboardLayoutItem[] | null,
): DashboardLayoutItem[] {
  const activeIds = new Set(activeKpis.map((k) => k.id));
  const kept = (savedItems ?? []).filter((item) => activeIds.has(item.kpiId));

  const keptIds = new Set(kept.map((item) => item.kpiId));
  const missingKpis = activeKpis.filter((kpi) => !keptIds.has(kpi.id));

  if (missingKpis.length === 0) {
    return kept;
  }

  const bottomY = kept.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const appended = packKpisBelow(missingKpis, bottomY);

  return [...kept, ...appended];
}
