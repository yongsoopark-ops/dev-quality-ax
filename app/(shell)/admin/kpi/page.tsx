import { prisma } from "@/lib/prisma";
import { getPeriodHeaders } from "@/lib/kpiEngine";
import type { FilterCondition } from "@/lib/kpiCalculator";
import KpiManager, { type KpiListItem, type SourceOption } from "./KpiManager";

function parseConditions(raw: string | null): FilterCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { conditions?: FilterCondition[] };
    return parsed.conditions ?? [];
  } catch {
    return [];
  }
}

function formatDateTime(date: Date | null) {
  if (!date) return null;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function parseResultData(raw: string | undefined | null): { label: string; value: number }[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { label: string; value: number }[];
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export default async function AdminKpiPage() {
  // 전역 성능 Step(select 최소화): source/result는 화면에 쓰는 필드만 함께 가져온다.
  const [connectedSources, kpiRows] = await Promise.all([
    prisma.googleSheetSource.findMany({ where: { syncStatus: "CONNECTED" } }),
    prisma.kPIDefinition.findMany({
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        name: true,
        sourceId: true,
        metricType: true,
        chartType: true,
        groupByHeader: true,
        sumHeader: true,
        dateHeader: true,
        filterConfig: true,
        denominatorFilterConfig: true,
        enabled: true,
        source: { select: { name: true } },
        result: { select: { value: true, resultData: true, calculatedAt: true } },
      },
    }),
  ]);

  const sources: SourceOption[] = await Promise.all(
    connectedSources.map(async (source) => {
      const headers: string[] = JSON.parse(source.headers || "[]");
      const periodHeaders = await getPeriodHeaders(source.id, headers);
      return { id: source.id, name: source.name, headers, periodHeaders };
    }),
  );

  const kpis: KpiListItem[] = kpiRows.map((kpi) => ({
    id: kpi.id,
    name: kpi.name,
    sourceId: kpi.sourceId,
    sourceName: kpi.source.name,
    metricType: kpi.metricType,
    chartType: kpi.chartType,
    groupByHeader: kpi.groupByHeader,
    sumHeader: kpi.sumHeader,
    dateHeader: kpi.dateHeader,
    conditions: parseConditions(kpi.filterConfig),
    denominatorConditions: parseConditions(kpi.denominatorFilterConfig),
    enabled: kpi.enabled,
    resultValue: kpi.result?.value ?? null,
    resultData: parseResultData(kpi.result?.resultData),
    resultCalculatedAt: formatDateTime(kpi.result?.calculatedAt ?? null),
  }));

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-navy-950">KPI 관리</h1>
      <p className="mt-1 text-sm text-navy-950/60">
        등록된 데이터 소스의 캐시 데이터를 기준으로 KPI를 정의합니다. 미리보기와
        저장 시에도 Google API는 호출되지 않습니다.
      </p>

      <KpiManager sources={sources} kpis={kpis} />
    </div>
  );
}
