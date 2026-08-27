"use server";

import { auth } from "@/auth";
import { getKpiDrilldownRows, type DrilldownResult } from "@/lib/kpiDrilldown";
import type { DashboardPeriod } from "@/lib/period";

/** ADMIN/MEMBER 모두 조회 가능 — 로그인 여부만 확인한다. */
export async function fetchKpiDrilldown(params: {
  kpiId: string;
  period: DashboardPeriod;
  groupValue?: string | null;
}): Promise<DrilldownResult | { error: string }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }

  return getKpiDrilldownRows(params);
}
