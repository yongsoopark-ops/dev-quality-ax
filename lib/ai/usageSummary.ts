import { prisma } from "@/lib/prisma";
import { convertUsdToKrw } from "@/lib/ai/currency";
import { calculateBudgetUsagePercent, MONTHLY_AI_BUDGET_KRW } from "@/lib/ai/budget";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 현재 시각을 기준으로 "이번 달"의 Asia/Seoul 월 경계를 UTC Date로 계산한다.
 * 서버가 어떤 시간대에서 돌아가든(UTC 등) KST 기준 월 경계가 틀어지지 않게 한다.
 */
export function getCurrentMonthRangeKST(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);

  const start = new Date(Date.UTC(year, month - 1, 1) - KST_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, 1) - KST_OFFSET_MS);

  return { start, end, label: `${year}년 ${month}월` };
}

export interface UserApiUsageEntry {
  userId: string;
  displayName: string;
  costKrw: number;
  unpricedCount: number;
}

/** getMonthlyApiUsageByUser/getTeamPresenceSummary가 공유하는 최소 ACTIVE User 모양 —
 * 호출부(예: /home page.tsx)가 이미 한 번 조회한 값을 그대로 넘기면 중복 조회를
 * 피할 수 있다(성능 개선 요청사항 1). */
export interface ActiveUserLite {
  id: string;
  name: string | null;
  email: string;
}

export interface MonthlyApiUsageSummary {
  monthLabel: string;
  totalCostKrw: number;
  unpricedCount: number;
  budgetKrw: number | null;
  usagePercent: number | null;
  byUser: UserApiUsageEntry[];
}

/**
 * ACTIVE 사용자 기준 이번 달 담당자별 AI API 비용을 집계한다. Provider 구분 없이
 * 합산하며(Google+OpenAI+Anthropic 전부), 외부 API를 호출하지 않고 AIUsage 테이블만 조회한다.
 *
 * activeUsers를 넘기면 그 목록을 그대로 쓰고 User 테이블을 다시 조회하지 않는다 —
 * /home처럼 같은 요청 안에서 이미 ACTIVE User를 조회한 호출부가 중복 조회를
 * 피하기 위해 쓴다(성능 개선). 넘기지 않으면 기존과 동일하게 직접 조회한다.
 */
export async function getMonthlyApiUsageByUser(activeUsers?: ActiveUserLite[]): Promise<UserApiUsageEntry[]> {
  const { start, end } = getCurrentMonthRangeKST();

  const users =
    activeUsers ??
    (await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, email: true },
    }));

  const usages = await prisma.aIUsage.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      status: "SUCCESS",
      userId: { in: users.map((u) => u.id) },
    },
    select: { userId: true, calculatedCostUsd: true },
  });

  const usdByUser = new Map<string, number>();
  const unpricedByUser = new Map<string, number>();

  for (const usage of usages) {
    if (usage.calculatedCostUsd === null) {
      unpricedByUser.set(usage.userId, (unpricedByUser.get(usage.userId) ?? 0) + 1);
      continue;
    }
    usdByUser.set(usage.userId, (usdByUser.get(usage.userId) ?? 0) + usage.calculatedCostUsd);
  }

  return users
    .map((user) => ({
      userId: user.id,
      displayName: user.name ?? user.email,
      // USD를 사용자 단위로 먼저 합산한 뒤 KRW로 변환·반올림한다.
      costKrw: Math.round(convertUsdToKrw(usdByUser.get(user.id) ?? 0)),
      unpricedCount: unpricedByUser.get(user.id) ?? 0,
    }))
    .sort((a, b) => b.costKrw - a.costKrw);
}

/**
 * Home 상단 "이번 달 API" 요약. 총액은 담당자별 집계(byUser)의 합으로 산출한다 —
 * Home 총액을 별도로 독립 집계하면 반올림 방식 차이로 담당자별 합계와 어긋날 수 있으므로,
 * 항상 동일한 숫자가 나오도록 이 함수가 유일한 진실 공급원이 되게 한다.
 */
export async function getMonthlyApiUsageSummary(activeUsers?: ActiveUserLite[]): Promise<MonthlyApiUsageSummary> {
  const { label } = getCurrentMonthRangeKST();
  const byUser = await getMonthlyApiUsageByUser(activeUsers);

  const totalCostKrw = byUser.reduce((sum, user) => sum + user.costKrw, 0);
  const unpricedCount = byUser.reduce((sum, user) => sum + user.unpricedCount, 0);

  return {
    monthLabel: label,
    totalCostKrw,
    unpricedCount,
    budgetKrw: MONTHLY_AI_BUDGET_KRW,
    usagePercent: calculateBudgetUsagePercent(totalCostKrw, MONTHLY_AI_BUDGET_KRW),
    byUser,
  };
}
