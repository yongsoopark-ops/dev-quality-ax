import type { MetricType } from "@/lib/kpiCalculator";

export type ComparisonDirection = "UP" | "DOWN" | "SAME" | "NEW";

export interface KpiComparison {
  currentValue: number;
  previousValue: number;
  /** RATIO는 %p 차이, 그 외(COUNT/COUNT_ALL/SUM)는 상대 변화율(%). NEW인 경우 null. */
  delta: number | null;
  direction: ComparisonDirection;
  /** 카드에 그대로 표시할 문자열 (예: "50.0%", "13.3%p", "신규"). */
  displayValue: string;
  /** "전월 대비" 또는 "직전 기간 대비". */
  comparisonLabel: string;
}

/**
 * KPI 숫자 카드의 전월/직전 기간 대비 비교값을 계산한다.
 * - RATIO: 두 기간을 각각 calculateKpi로 독립 계산한 % 값의 차이(%p)로 비교한다.
 *   (월별 비율의 평균이 아니라, 두 기간 각각의 calculateKpi 결과를 그대로 뺀 값이다.)
 * - COUNT/COUNT_ALL/SUM: 상대 변화율(%)로 비교한다. 이전 값이 0이면 나눗셈이 무의미하므로
 *   0이 아닌 값이 새로 생긴 경우 "신규"로, 둘 다 0이면 변화 없음(0.0%)으로 표시한다.
 */
export function calculateKpiComparison(params: {
  metricType: MetricType;
  currentValue: number;
  previousValue: number;
  comparisonLabel: string;
}): KpiComparison {
  const { metricType, currentValue, previousValue, comparisonLabel } = params;

  if (metricType === "RATIO") {
    const delta = currentValue - previousValue;
    const direction: ComparisonDirection = delta > 0 ? "UP" : delta < 0 ? "DOWN" : "SAME";
    return {
      currentValue,
      previousValue,
      delta,
      direction,
      displayValue: `${Math.abs(delta).toFixed(1)}%p`,
      comparisonLabel,
    };
  }

  // COUNT / COUNT_ALL / SUM
  if (previousValue === 0) {
    if (currentValue === 0) {
      return {
        currentValue,
        previousValue,
        delta: 0,
        direction: "SAME",
        displayValue: "0.0%",
        comparisonLabel,
      };
    }
    return {
      currentValue,
      previousValue,
      delta: null,
      direction: "NEW",
      displayValue: "신규",
      comparisonLabel,
    };
  }

  const percentChange = ((currentValue - previousValue) / previousValue) * 100;
  const direction: ComparisonDirection = percentChange > 0 ? "UP" : percentChange < 0 ? "DOWN" : "SAME";
  return {
    currentValue,
    previousValue,
    delta: percentChange,
    direction,
    displayValue: `${Math.abs(percentChange).toFixed(1)}%`,
    comparisonLabel,
  };
}
