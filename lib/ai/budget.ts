/**
 * 월 예산 관리 기능 전체는 이번 단계에서 구현하지 않는다.
 * 확정된 운영 예산이 아직 없으므로 가짜 값을 넣지 않고 null로 둔다.
 * 값이 채워지면 Home Card에 사용률(%)과 Progress Bar가 자동으로 표시된다.
 */
export const MONTHLY_AI_BUDGET_KRW: number | null = null;

/**
 * 예산이 없거나(null) 0 이하이면 "예산 미설정"으로 취급해 null을 반환한다.
 * 예산이 있으면 사용률(%)을 반환한다.
 */
export function calculateBudgetUsagePercent(
  totalCostKrw: number,
  budgetKrw: number | null,
): number | null {
  if (budgetKrw === null || budgetKrw <= 0) return null;
  return Math.round((totalCostKrw / budgetKrw) * 100);
}
