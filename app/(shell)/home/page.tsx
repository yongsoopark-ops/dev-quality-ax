import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { mergeDashboardLayout } from "@/lib/dashboardLayout/mergeLayout";
import { HOME_LAYOUT_KEY, type DashboardLayoutItem } from "@/lib/dashboardLayout/types";
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
  parseDashboardPeriod,
} from "@/lib/period";
import PeriodSelector from "@/components/period/PeriodSelector";
import { MonthlyApiUsageCard } from "@/components/api/MonthlyApiUsageCard";
import { getMonthlyApiUsageSummary } from "@/lib/ai/usageSummary";
import { TeamPresenceCard } from "@/components/presence/TeamPresenceCard";
import { getTeamPresenceSummary } from "@/lib/presence/presenceSummary";

function formatDateTime(date: Date | null) {
  if (!date) return null;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}) {
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";

  const rawParams = await searchParams;
  const period = parseDashboardPeriod(rawParams);
  const range = getDashboardPeriodRange(period);
  // "전월 대비"/"직전 기간 대비" 비교 대상 기간. dateHeader가 있고 Group By가 없는
  // 숫자 KPI에 한해, 이미 로드된 캐시 행을 이 기간으로 다시 필터링해 재계산한다
  // (추가 API 호출/DB 조회 없음).
  const previousPeriod = getPreviousComparisonPeriod(period);
  const previousRange = getDashboardPeriodRange(previousPeriod);
  const comparisonLabel = getComparisonLabel(period);

  // Google API를 호출하지 않는다. 미리 계산되어 저장된 KPIResult / 캐시(GoogleSheetSourceRow)만 사용한다.
  const kpis = await prisma.kPIDefinition.findMany({
    where: { enabled: true },
    orderBy: { displayOrder: "asc" },
    include: { result: true },
  });

  // API 사용료 요약은 Home의 KPI 기간 선택(period)과 무관하게 항상 실제 현재 월 기준이다.
  // AIUsage 테이블만 조회하며 외부 AI API를 호출하지 않는다.
  const apiUsageSummary = await getMonthlyApiUsageSummary();

  // 팀원 연결 상태도 KPI 기간 선택과 무관하게 User 테이블만으로 계산한다.
  const teamPresence = await getTeamPresenceSummary();

  const rowsBySource = new Map<string, Record<string, string>[]>();
  async function getRows(sourceId: string) {
    const cached = rowsBySource.get(sourceId);
    if (cached) return cached;
    const rows = await loadCachedRows(sourceId);
    rowsBySource.set(sourceId, rows);
    return rows;
  }

  // 연도 선택지는 실제 dateHeader를 쓰는 KPI들의 캐시 데이터에 존재하는 연도만으로 구성한다.
  const detectedYears = new Set<number>();

  const cards = await Promise.all(
    kpis.map(async (kpi) => {
      // dateHeader가 없는 KPI는 기존과 동일하게 전체 누적 KPIResult를 그대로 보여준다.
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
          // dateHeader가 없는 누적 KPI는 기간 개념이 없으므로 비교 대상에서 제외한다.
          comparison: null as KpiComparison | null,
        };
      }

      // dateHeader가 있는 KPI는 캐시 행을 선택 기간(월별 또는 기간)으로 필터링해
      // 기존 계산기로 즉시 재계산한다. 월별/기간 모두 동일한 getDashboardPeriodRange +
      // filterRowsByPeriod를 거치므로 필터 방식이 갈라지지 않는다.
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

      // Group By가 있는 KPI(그래프형)는 이번 Step의 비교 Indicator 대상이 아니다.
      // dateHeader 필터만 직전 기간으로 바꿔 동일한 config/calculateKpi를 재사용한다.
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
        // Home 상단에 이미 기간 Selector가 있으므로 Card 하단에는 기간을 반복 표시하지 않는다.
        // (Drill-down Modal에는 periodLabel로 계속 표시된다.)
        footerText: undefined,
        periodLabel: range.label,
        comparison,
      };
    }),
  );

  const years = buildYearRange([...detectedYears, ...getDashboardPeriodYears(period)]);

  // Dashboard Layout은 Prisma 1회 조회로만 가져온다. KPI 계산(위)과는 완전히 분리되어 있으며,
  // 여기서는 이미 계산된 cards를 저장된 좌표에 맞춰 배치만 한다.
  const savedLayoutRow = await prisma.dashboardLayout.findUnique({ where: { key: HOME_LAYOUT_KEY } });
  const savedItems: DashboardLayoutItem[] | null = savedLayoutRow
    ? JSON.parse(savedLayoutRow.layoutData)
    : null;
  const layout = mergeDashboardLayout(
    kpis.map((kpi, index) => ({ id: kpi.id, chartType: kpi.chartType, displayOrder: index })),
    savedItems,
  );

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PeriodSelector period={period} years={years} />
        <div className="flex flex-wrap gap-4">
          <TeamPresenceCard initialEntries={teamPresence} />
          <MonthlyApiUsageCard summary={apiUsageSummary} />
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-sm text-navy-950/40">표시할 KPI가 없습니다.</p>
        </div>
      ) : (
        <div className="mt-6">
          <HomeDashboard cards={cards} initialLayout={layout} isAdmin={isAdmin} period={period} />
        </div>
      )}
    </div>
  );
}
