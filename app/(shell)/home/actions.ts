"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/cache/memoCache";
import { computeKpiCardsForPeriod, type KpiCardOutput } from "@/lib/home/computeKpiCards";
import { getKpiDrilldownRows, type DrilldownResult } from "@/lib/kpiDrilldown";
import { KPI_DEFINITIONS_CACHE_KEY } from "@/lib/kpiEngine";
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

/**
 * 전역 성능 Step(Home 월 이동 부분 갱신) — PeriodSelector가 월/기간을 바꿀 때
 * 이 Action만 호출한다. Sidebar/DashboardLayout/ACTIVE User/Presence는 이
 * Action이 전혀 건드리지 않는다 — kpis(캐시된 KPIDefinition+result)를 다시
 * 가져와(대부분 캐시 Hit) home/page.tsx와 완전히 동일한 계산(computeKpiCardsForPeriod)만
 * 다시 실행한다. KPI가 표시하는 "어떤 KPI가 있는지"(레이아웃 대상)는 기간과
 * 무관해 여기서는 cards/years만 반환하고 레이아웃은 다시 계산하지 않는다.
 */
export async function getHomeKpiCardsAction(
  period: DashboardPeriod,
): Promise<{ cards: KpiCardOutput[]; years: number[] } | { error: string }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }

  const kpis = await cached(KPI_DEFINITIONS_CACHE_KEY, 60_000, () =>
    prisma.kPIDefinition.findMany({
      where: { enabled: true },
      orderBy: { displayOrder: "asc" },
      include: { result: true },
    }),
  );

  return computeKpiCardsForPeriod(kpis, period);
}
