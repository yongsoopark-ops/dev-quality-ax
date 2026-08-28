import { loadCachedRows, parseFilterConfig } from "@/lib/kpiEngine";
import { calculateKpi, type KpiCalcConfig } from "@/lib/kpiCalculator";
import { calculateKpiComparison, type KpiComparison } from "@/lib/kpiComparison";
import {
  buildYearRange,
  extractYearsFromRows,
  filterRowsByPeriod,
  getComparisonLabel,
  getDashboardPeriodRange,
  getDashboardPeriodYears,
  getPreviousComparisonPeriod,
  type DashboardPeriod,
} from "@/lib/period";
import type { ChartType, MetricType } from "@/app/generated/prisma/enums";

export interface KpiForCards {
  id: string;
  name: string;
  sourceId: string;
  metricType: MetricType;
  chartType: ChartType;
  groupByHeader: string | null;
  sumHeader: string | null;
  dateHeader: string | null;
  filterConfig: string | null;
  denominatorFilterConfig: string | null;
  result: { value: number | null; resultData: string | null; calculatedAt: Date } | null;
}

export interface KpiCardOutput {
  id: string;
  name: string;
  metricType: MetricType;
  chartType: ChartType;
  value: number | null;
  resultData: { label: string; value: number }[] | null;
  footerText?: string;
  periodLabel: string;
  comparison: KpiComparison | null;
}

function formatDateTime(date: Date | null) {
  if (!date) return null;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 전역 성능 Step(Home 월 이동 부분 갱신 근거) — home/page.tsx의 초기 렌더와
 * getHomeKpiCardsAction(월 이동 시 재조회)이 완전히 동일한 계산을 하도록
 * 이 함수 하나로 합쳤다. kpis(KPIDefinition+result)는 이미 호출부에서
 * (캐시된 값으로) 가져온 상태로 넘어오며, 여기서는 절대 DB를 다시 조회하지
 * 않는다 — GoogleSheetSourceRow 캐시(loadCachedRows)만 기간별로 다시
 * 필터링/재계산한다. 기존 home/page.tsx의 로직/계산 결과와 완전히 동일하다.
 */
export async function computeKpiCardsForPeriod(
  kpis: KpiForCards[],
  period: DashboardPeriod,
): Promise<{ cards: KpiCardOutput[]; years: number[] }> {
  const range = getDashboardPeriodRange(period);
  const previousPeriod = getPreviousComparisonPeriod(period);
  const previousRange = getDashboardPeriodRange(previousPeriod);
  const comparisonLabel = getComparisonLabel(period);

  const rowsBySource = new Map<string, Record<string, string>[]>();
  async function getRows(sourceId: string) {
    const cached = rowsBySource.get(sourceId);
    if (cached) return cached;
    const rows = await loadCachedRows(sourceId);
    rowsBySource.set(sourceId, rows);
    return rows;
  }

  const detectedYears = new Set<number>();

  const cards: KpiCardOutput[] = await Promise.all(
    kpis.map(async (kpi) => {
      if (!kpi.dateHeader) {
        return {
          id: kpi.id,
          name: kpi.name,
          metricType: kpi.metricType,
          chartType: kpi.chartType,
          value: kpi.result?.value ?? null,
          resultData: kpi.result?.resultData ? JSON.parse(kpi.result.resultData) : null,
          footerText: kpi.result?.calculatedAt
            ? `마지막 계산: ${formatDateTime(kpi.result.calculatedAt)} (전체 누적)`
            : "아직 계산되지 않음",
          periodLabel: "전체 누적",
          comparison: null as KpiComparison | null,
        };
      }

      const rows = await getRows(kpi.sourceId);
      for (const y of extractYearsFromRows(rows, kpi.dateHeader)) {
        detectedYears.add(y);
      }
      const filtered = filterRowsByPeriod(rows, kpi.dateHeader, range);
      const config: KpiCalcConfig = {
        metricType: kpi.metricType,
        conditions: parseFilterConfig(kpi.filterConfig),
        denominatorConditions: parseFilterConfig(kpi.denominatorFilterConfig),
        groupByHeader: kpi.groupByHeader,
        sumHeader: kpi.sumHeader,
      };
      const result = calculateKpi(config, filtered);

      let comparison: KpiComparison | null = null;
      if (!kpi.groupByHeader) {
        const previousFiltered = filterRowsByPeriod(rows, kpi.dateHeader, previousRange);
        const previousResult = calculateKpi(config, previousFiltered);
        comparison = calculateKpiComparison({
          metricType: kpi.metricType,
          currentValue: result.value ?? 0,
          previousValue: previousResult.value ?? 0,
          comparisonLabel,
        });
      }

      return {
        id: kpi.id,
        name: kpi.name,
        metricType: kpi.metricType,
        chartType: kpi.chartType,
        value: result.value,
        resultData: result.resultData,
        footerText: undefined,
        periodLabel: range.label,
        comparison,
      };
    }),
  );

  const years = buildYearRange([...detectedYears, ...getDashboardPeriodYears(period)]);
  return { cards, years };
}
