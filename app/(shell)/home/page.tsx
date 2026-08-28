import { Suspense } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/cache/memoCache";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { mergeDashboardLayout } from "@/lib/dashboardLayout/mergeLayout";
import { DASHBOARD_LAYOUT_CACHE_KEY, HOME_LAYOUT_KEY, type DashboardLayoutItem } from "@/lib/dashboardLayout/types";
import { KPI_DEFINITIONS_CACHE_KEY } from "@/lib/kpiEngine";
import { computeKpiCardsForPeriod } from "@/lib/home/computeKpiCards";
import { withTiming } from "@/lib/perf/timing";
import { parseDashboardPeriod } from "@/lib/period";
import { MonthlyApiUsageCard } from "@/components/api/MonthlyApiUsageCard";
import { getMonthlyApiUsageSummary } from "@/lib/ai/usageSummary";
import { TeamPresenceCard } from "@/components/presence/TeamPresenceCard";
import { getTeamPresenceSummary, type ActiveUserWithPresence } from "@/lib/presence/presenceSummary";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

/**
 * 전역 성능 Step(Home 섹션별 Suspense) — KPI Dashboard/팀 연결 상태/API 사용료
 * 3개 영역은 서로 완전히 독립적인 조회다. 하나의 async 함수 안에서 전부
 * 끝날 때까지 기다리는 대신, 각자 별도의 async Server Component + <Suspense>로
 * 나눠 "느린 하나 때문에 나머지도 늦게 뜨는" 상황을 없앤다. activeUsers는
 * Presence/ApiUsage 둘 다 필요하지만 여기서 Promise를 한 번만 만들어 두
 * Section에 그대로 전달한다 — 두 Section이 각자 await해도 실제 조회는
 * 1번만 나간다(같은 Promise 재사용, 중복 쿼리 아님).
 */
async function HomePresenceSection({ activeUsers }: { activeUsers: Promise<ActiveUserWithPresence[]> }) {
  const teamPresence = await getTeamPresenceSummary(await activeUsers);
  return <TeamPresenceCard initialEntries={teamPresence} />;
}

async function HomeApiUsageSection({ activeUsers }: { activeUsers: Promise<ActiveUserWithPresence[]> }) {
  const apiUsageSummary = await getMonthlyApiUsageSummary(await activeUsers);
  return <MonthlyApiUsageCard summary={apiUsageSummary} />;
}

function SideCardSkeleton() {
  return <SkeletonBlock className="h-16 w-48" />;
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

  // activeUsers는 Presence(lastActiveAt 등 실시간성 데이터)를 포함해 항상
  // 즉시 조회한다(캐시하지 않음) — Promise만 미리 만들어 두 Section에 넘긴다.
  const activeUsersPromise: Promise<ActiveUserWithPresence[]> = prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, email: true, lastActiveAt: true, lastHeartbeatAt: true },
  });

  // 전역 구조 점검 Step: kpis/savedLayoutRow는 이 페이지가 처음 열릴 때 딱
  // 한 번만 조회한다. 월(period) 이동은 이제 getHomeKpiCardsAction(Client)이
  // 담당하며, 그 Action도 같은 캐시 키를 쓰므로 이 페이지가 이미 데워둔
  // 캐시를 그대로 재사용한다.
  const [kpis, savedLayoutRow] = await Promise.all([
    cached(KPI_DEFINITIONS_CACHE_KEY, 60_000, () =>
      prisma.kPIDefinition.findMany({
        where: { enabled: true },
        orderBy: { displayOrder: "asc" },
        include: { result: true },
      }),
    ),
    cached(DASHBOARD_LAYOUT_CACHE_KEY, 60_000, () => prisma.dashboardLayout.findUnique({ where: { key: HOME_LAYOUT_KEY } })),
  ]);

  // Performance Observability(26번) 사용 예 — 개발 환경에서만 소요 시간을 남긴다.
  const { cards, years } = await withTiming("home:computeKpiCards", () => computeKpiCardsForPeriod(kpis, period));

  const savedItems: DashboardLayoutItem[] | null = savedLayoutRow
    ? JSON.parse(savedLayoutRow.layoutData)
    : null;
  // KPI 목록(어떤 KPI가 있는지) 자체는 기간과 무관하므로 Layout은 여기서
  // 딱 한 번만 계산한다 — 월 이동 시 다시 계산하지 않는다.
  const layout = mergeDashboardLayout(
    kpis.map((kpi, index) => ({ id: kpi.id, chartType: kpi.chartType, displayOrder: index })),
    savedItems,
  );

  return (
    <HomeDashboard
      initialCards={cards}
      initialYears={years}
      initialPeriod={period}
      initialLayout={layout}
      isAdmin={isAdmin}
      sideCards={
        <>
          <Suspense fallback={<SideCardSkeleton />}>
            <HomePresenceSection activeUsers={activeUsersPromise} />
          </Suspense>
          <Suspense fallback={<SideCardSkeleton />}>
            <HomeApiUsageSection activeUsers={activeUsersPromise} />
          </Suspense>
        </>
      }
    />
  );
}
