"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/cache/memoCache";
import { KPI_DEFINITIONS_CACHE_KEY, loadCachedRows, recalculateKpi } from "@/lib/kpiEngine";
import {
  calculateKpi,
  type ChartType,
  type FilterCondition,
  type KpiCalcConfig,
  type KpiCalcResult,
  type MetricType,
} from "@/lib/kpiCalculator";

export interface KpiDraftConfig {
  name: string;
  sourceId: string;
  metricType: MetricType;
  conditions: FilterCondition[];
  denominatorConditions: FilterCondition[];
  groupByHeader: string;
  sumHeader: string;
  dateHeader: string;
  chartType: ChartType;
  enabled: boolean;
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return session;
}

async function requireConnectedSource(sourceId: string) {
  const source = await prisma.googleSheetSource.findUnique({ where: { id: sourceId } });
  if (!source || source.syncStatus !== "CONNECTED") {
    throw new Error("CONNECTED 상태의 Source만 선택할 수 있습니다.");
  }
  return source;
}

function toCalcConfig(draft: KpiDraftConfig): KpiCalcConfig {
  return {
    metricType: draft.metricType,
    conditions: draft.conditions,
    denominatorConditions: draft.denominatorConditions,
    groupByHeader: draft.groupByHeader || null,
    sumHeader: draft.sumHeader || null,
  };
}

export async function previewKpiAction(
  draft: KpiDraftConfig,
): Promise<{ result?: KpiCalcResult; error?: string }> {
  await requireAdmin();

  try {
    await requireConnectedSource(draft.sourceId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Source 확인에 실패했습니다." };
  }

  const rows = await loadCachedRows(draft.sourceId);
  const result = calculateKpi(toCalcConfig(draft), rows);
  return { result };
}

export async function createKpiAction(
  draft: KpiDraftConfig,
): Promise<{ ok?: true; error?: string }> {
  const session = await requireAdmin();

  if (!draft.name.trim()) {
    return { error: "KPI 이름을 입력해 주세요." };
  }

  try {
    await requireConnectedSource(draft.sourceId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Source 확인에 실패했습니다." };
  }

  const maxOrder = await prisma.kPIDefinition.aggregate({
    _max: { displayOrder: true },
  });

  const kpi = await prisma.kPIDefinition.create({
    data: {
      name: draft.name.trim(),
      sourceId: draft.sourceId,
      metricType: draft.metricType,
      filterConfig: JSON.stringify({ conditions: draft.conditions }),
      denominatorFilterConfig:
        draft.metricType === "RATIO"
          ? JSON.stringify({ conditions: draft.denominatorConditions })
          : null,
      groupByHeader: draft.groupByHeader || null,
      sumHeader: draft.metricType === "SUM" ? draft.sumHeader || null : null,
      dateHeader: draft.dateHeader || null,
      chartType: draft.chartType,
      displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
      enabled: draft.enabled,
      createdBy: session.user.id,
    },
  });

  await recalculateKpi(kpi.id);

  revalidatePath("/admin/kpi");
  revalidatePath("/home");
  return { ok: true };
}

export async function updateKpiAction(
  id: string,
  draft: KpiDraftConfig,
): Promise<{ ok?: true; error?: string }> {
  await requireAdmin();

  if (!draft.name.trim()) {
    return { error: "KPI 이름을 입력해 주세요." };
  }

  try {
    await requireConnectedSource(draft.sourceId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Source 확인에 실패했습니다." };
  }

  await prisma.kPIDefinition.update({
    where: { id },
    data: {
      name: draft.name.trim(),
      sourceId: draft.sourceId,
      metricType: draft.metricType,
      filterConfig: JSON.stringify({ conditions: draft.conditions }),
      denominatorFilterConfig:
        draft.metricType === "RATIO"
          ? JSON.stringify({ conditions: draft.denominatorConditions })
          : null,
      groupByHeader: draft.groupByHeader || null,
      sumHeader: draft.metricType === "SUM" ? draft.sumHeader || null : null,
      dateHeader: draft.dateHeader || null,
      chartType: draft.chartType,
      enabled: draft.enabled,
    },
  });

  await recalculateKpi(id);

  revalidatePath("/admin/kpi");
  revalidatePath("/home");
  return { ok: true };
}

export async function toggleKpiEnabledAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;

  await prisma.kPIDefinition.update({ where: { id }, data: { enabled } });

  invalidateCache(KPI_DEFINITIONS_CACHE_KEY);
  revalidatePath("/admin/kpi");
  revalidatePath("/home");
}

export async function deleteKpiAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.kPIDefinition.delete({ where: { id } });

  invalidateCache(KPI_DEFINITIONS_CACHE_KEY);
  revalidatePath("/admin/kpi");
  revalidatePath("/home");
}
