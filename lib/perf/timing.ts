/**
 * 공통 성능 아키텍처 — Performance Observability(26번). 느려졌을 때 추측 대신
 * 바로 원인을 찾기 위한 개발 전용 timing helper다.
 *
 * - Production에서는 아무 것도 하지 않는다(로그 노출 금지). 개발 환경에서만
 *   `console.debug`로 label과 소요 시간(ms)만 남긴다.
 * - label 외에는 절대 아무 값도 로그하지 않는다 — 호출하는 쪽에서 실수로
 *   DB URL/Secret/개인 데이터가 담긴 값을 label에 넣지 않도록 주의한다
 *   (예: `withTiming("KPI 카드 계산", fn)`처럼 짧고 값이 섞이지 않는 설명만).
 *
 * 사용 예:
 *   const cards = await withTiming("home:computeKpiCards", () =>
 *     computeKpiCardsForPeriod(kpis, period),
 *   );
 */
export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === "production") {
    return fn();
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    console.debug(`[perf] ${label}: ${ms.toFixed(0)}ms`);
  }
}
