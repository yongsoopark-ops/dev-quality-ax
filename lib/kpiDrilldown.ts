import { prisma } from "@/lib/prisma";
import { loadCachedRows, parseFilterConfig } from "@/lib/kpiEngine";
import { matchesConditions } from "@/lib/kpiCalculator";
import { filterRowsByPeriod, getDashboardPeriodRange, type DashboardPeriod } from "@/lib/period";

/** 상세 표에 노출할 고정 Header. KPI마다 다르게 하드코딩하지 않는다. */
export const DRILLDOWN_COLUMNS = [
  "발생일",
  "제품명",
  "시험 항목",
  "최종 판정",
  "판정 사유",
] as const;

export interface DrilldownRow {
  [column: string]: string;
}

export interface DrilldownResult {
  rows: DrilldownRow[];
  columns: string[];
}

function groupLabel(row: Record<string, string>, header: string): string {
  return (row[header] ?? "").trim() || "(빈 값)";
}

/**
 * KPI를 구성하는 GoogleSheetSourceRow 캐시 행을 상세 조회한다.
 * Google API를 호출하지 않고, KPI 계산에 쓰는 것과 동일한 기간 필터(filterRowsByPeriod)와
 * 조건 매칭(matchesConditions)을 그대로 재사용한다.
 *
 * - COUNT_ALL: 조건 없음(전체 행)
 * - COUNT / SUM: 저장된 조건(filterConfig)
 * - RATIO: 분자 조건(filterConfig)만 사용 — 분모는 상세 표에 노출하지 않는다.
 * - groupValue가 주어지면, 위 결과에 groupByHeader = groupValue 조건을 추가로 적용한다.
 */
export async function getKpiDrilldownRows(params: {
  kpiId: string;
  period: DashboardPeriod;
  groupValue?: string | null;
}): Promise<DrilldownResult | { error: string }> {
  const kpi = await prisma.kPIDefinition.findUnique({ where: { id: params.kpiId } });
  if (!kpi) {
    return { error: "KPI를 찾을 수 없습니다." };
  }

  let rows = await loadCachedRows(kpi.sourceId);

  if (kpi.dateHeader) {
    // 월별/기간 모드 공통: getDashboardPeriodRange → filterRowsByPeriod. KPI 계산(Home)과
    // 동일한 두 함수를 거치므로 Drill-down 기간 필터가 KPI 계산과 어긋나지 않는다.
    const range = getDashboardPeriodRange(params.period);
    rows = filterRowsByPeriod(rows, kpi.dateHeader, range);
  }

  const conditions = parseFilterConfig(kpi.filterConfig);
  if (conditions.length > 0) {
    rows = rows.filter((row) => matchesConditions(row, conditions));
  }

  if (params.groupValue && kpi.groupByHeader) {
    const header = kpi.groupByHeader;
    rows = rows.filter((row) => groupLabel(row, header) === params.groupValue);
  }

  const columns = [...DRILLDOWN_COLUMNS];
  const detailRows: DrilldownRow[] = rows.map((row) => {
    const out: DrilldownRow = {};
    for (const column of columns) {
      out[column] = row[column] ?? "";
    }
    return out;
  });

  return { rows: detailRows, columns };
}
