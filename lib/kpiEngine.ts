import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/cache/memoCache";
import { calculateKpi, type FilterCondition, type KpiCalcConfig } from "@/lib/kpiCalculator";
import { isPeriodHeaderCandidate } from "@/lib/period";

/** /home page.tsx가 "enabled=true KPIDefinition+result" 조회를 캐시할 때 쓰는 키. */
export const KPI_DEFINITIONS_CACHE_KEY = "kpi-definitions-with-results";

/** GoogleSheetSourceRow 캐시를 읽는다. Google API를 호출하지 않는다.
 * 전역 성능 Step(select 최소화): 실제로 쓰는 건 data(JSON) 하나뿐이라
 * id/contentHash/updatedAt 등 나머지 필드는 가져오지 않는다. */
export async function loadCachedRows(sourceId: string): Promise<Record<string, string>[]> {
  const rows = await prisma.googleSheetSourceRow.findMany({
    where: { sourceId },
    orderBy: { rowIndex: "asc" },
    select: { data: true },
  });
  return rows.map((row) => JSON.parse(row.data) as Record<string, string>);
}

/** 캐시된 행을 표본 삼아 각 Header가 기간(날짜) 성격인지 판단한다. */
export async function getPeriodHeaders(sourceId: string, headers: string[]) {
  const rows = await prisma.googleSheetSourceRow.findMany({
    where: { sourceId },
    orderBy: { rowIndex: "asc" },
    take: 20,
    select: { data: true },
  });
  const parsed = rows.map((row) => JSON.parse(row.data) as Record<string, string>);

  return headers.filter((header) =>
    isPeriodHeaderCandidate(
      header,
      parsed.map((row) => row[header] ?? ""),
    ),
  );
}

export function parseFilterConfig(raw: string | null): FilterCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { conditions?: FilterCondition[] };
    return parsed.conditions ?? [];
  } catch {
    return [];
  }
}

/** 단일 KPI를 캐시 데이터로 재계산해 KPIResult를 갱신한다. Google API를 호출하지 않는다. */
export async function recalculateKpi(kpiId: string) {
  const kpi = await prisma.kPIDefinition.findUniqueOrThrow({ where: { id: kpiId } });
  const source = await prisma.googleSheetSource.findUnique({ where: { id: kpi.sourceId } });
  const rows = await loadCachedRows(kpi.sourceId);

  const config: KpiCalcConfig = {
    metricType: kpi.metricType,
    conditions: parseFilterConfig(kpi.filterConfig),
    denominatorConditions: parseFilterConfig(kpi.denominatorFilterConfig),
    groupByHeader: kpi.groupByHeader,
    sumHeader: kpi.sumHeader,
  };

  const result = calculateKpi(config, rows);

  await prisma.kPIResult.upsert({
    where: { kpiId },
    create: {
      kpiId,
      value: result.value,
      resultData: JSON.stringify(result.resultData ?? []),
      sourceSyncedAt: source?.lastSyncedAt ?? null,
    },
    update: {
      value: result.value,
      resultData: JSON.stringify(result.resultData ?? []),
      calculatedAt: new Date(),
      sourceSyncedAt: source?.lastSyncedAt ?? null,
    },
  });

  invalidateCache(KPI_DEFINITIONS_CACHE_KEY);
}

/** 특정 Source를 참조하는 KPI만 재계산한다. 다른 Source의 KPI는 건드리지 않는다. */
export async function recalculateKpisForSource(sourceId: string) {
  const kpis = await prisma.kPIDefinition.findMany({
    where: { sourceId },
    select: { id: true },
  });

  for (const kpi of kpis) {
    await recalculateKpi(kpi.id).catch(() => {});
  }
}
