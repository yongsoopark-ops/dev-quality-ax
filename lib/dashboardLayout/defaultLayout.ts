import type { ChartType } from "@/lib/kpiCalculator";
import { GRID_COLS, type DashboardLayoutItem } from "@/lib/dashboardLayout/types";

export interface SizeSpec {
  w: number;
  h: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
}

/**
 * Chart Type별 합리적인 기본/최소 크기. KPI마다 좌표를 하드코딩하지 않고 이 규칙
 * 하나로 Default Layout 생성과 Resize 제약을 모두 처리한다.
 *
 * monday.com류 Dashboard Widget처럼 "그래프마다 정해진 Small/Medium/Large" 방식이
 * 아니라 "읽을 수 있는 최소 크기만 보장하고 나머지는 자유 Resize"를 원칙으로 한다.
 * 그래서 maxW/maxH는 모든 Chart Type에 동일하게 넉넉히 열어 두고(12 Column 전체
 * 너비까지 포함), Chart Type별로는 minW/minH만 다르게 가져간다.
 */
export function getSizeSpec(chartType: ChartType): SizeSpec {
  const maxW = GRID_COLS;
  const maxH = 12;

  switch (chartType) {
    case "NUMBER_CARD":
    case "PROGRESS":
      return { w: 3, h: 2, minW: 2, minH: 2, maxW, maxH };
    case "DONUT":
    case "PIE":
      // Legend를 좁을 때 Chart 아래로 Wrap하고 원형 자체도 object-contain으로
      // 축소되므로, 다른 그래프보다 더 촘촘한 최소 크기까지 허용한다.
      return { w: 6, h: 4, minW: 3, minH: 2, maxW, maxH };
    case "BAR":
    case "HORIZONTAL_BAR":
    case "LINE":
    case "AREA":
      return { w: 6, h: 4, minW: 4, minH: 3, maxW, maxH };
    default:
      return { w: 3, h: 2, minW: 2, minH: 2, maxW, maxH };
  }
}

export interface LayoutableKpi {
  id: string;
  chartType: ChartType;
  displayOrder: number;
}

/**
 * 주어진 KPI 목록을, 이미 배치된 Row 아래의 새 영역에 왼쪽부터 순서대로 채워 넣는다
 * (Shelf Packing). 한 줄에 다 들어가지 않으면 다음 줄로 넘어간다.
 * Default Layout 생성과, 저장된 Layout에 없는 신규 KPI를 마지막 빈 공간에 추가하는
 * 두 경우 모두 이 함수 하나로 처리한다.
 */
export function packKpisBelow(
  kpis: LayoutableKpi[],
  startY: number,
): DashboardLayoutItem[] {
  const sorted = [...kpis].sort((a, b) => a.displayOrder - b.displayOrder);

  let cursorX = 0;
  let cursorY = startY;
  let rowHeight = 0;
  const items: DashboardLayoutItem[] = [];

  for (const kpi of sorted) {
    const spec = getSizeSpec(kpi.chartType);
    if (cursorX + spec.w > GRID_COLS) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    items.push({ kpiId: kpi.id, x: cursorX, y: cursorY, w: spec.w, h: spec.h });
    cursorX += spec.w;
    rowHeight = Math.max(rowHeight, spec.h);
  }

  return items;
}

/** 활성 KPI 전체를 처음부터 배치하는 완전한 Default Layout. */
export function getDefaultDashboardLayout(kpis: LayoutableKpi[]): DashboardLayoutItem[] {
  return packKpisBelow(kpis, 0);
}
