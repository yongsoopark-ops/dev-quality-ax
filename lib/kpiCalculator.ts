export type MetricType = "COUNT" | "COUNT_ALL" | "RATIO" | "SUM";
export type ChartType =
  | "NUMBER_CARD"
  | "BAR"
  | "HORIZONTAL_BAR"
  | "LINE"
  | "AREA"
  | "DONUT"
  | "PIE"
  | "PROGRESS";
export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "is_empty"
  | "is_not_empty";

export interface FilterCondition {
  header: string;
  operator: FilterOperator;
  value?: string;
}

export interface KpiCalcConfig {
  metricType: MetricType;
  conditions: FilterCondition[];
  denominatorConditions: FilterCondition[];
  groupByHeader: string | null;
  sumHeader: string | null;
}

export interface KpiCalcResult {
  value: number | null;
  resultData: { label: string; value: number }[] | null;
}

type Row = Record<string, string>;

/**
 * 행이 조건(AND)을 만족하는지 판단한다. KPI 계산과 Drill-down 상세 조회가
 * 서로 다른 기준을 쓰지 않도록, 이 함수를 계산기와 Drill-down 양쪽에서 공유한다.
 */
export function matchesConditions(row: Row, conditions: FilterCondition[]): boolean {
  return conditions.every((condition) => {
    const raw = (row[condition.header] ?? "").trim();
    const target = (condition.value ?? "").trim();
    switch (condition.operator) {
      case "equals":
        return raw === target;
      case "not_equals":
        return raw !== target;
      case "contains":
        return target.length > 0 && raw.includes(target);
      case "is_empty":
        return raw === "";
      case "is_not_empty":
        return raw !== "";
      default:
        return true;
    }
  });
}

function groupCount(rows: Row[], header: string): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = (row[header] ?? "").trim() || "(빈 값)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

function groupSum(
  rows: Row[],
  groupByHeader: string,
  sumHeader: string,
): { label: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const label = (row[groupByHeader] ?? "").trim() || "(빈 값)";
    const amount = parseFloat((row[sumHeader] ?? "").replace(/,/g, ""));
    sums.set(label, (sums.get(label) ?? 0) + (Number.isFinite(amount) ? amount : 0));
  }
  return [...sums.entries()].map(([label, value]) => ({ label, value }));
}

/** GoogleSheetSourceRow 캐시(순수 데이터)만을 입력으로 받아 KPI 결과를 계산한다. Google API를 호출하지 않는다. */
export function calculateKpi(config: KpiCalcConfig, rows: Row[]): KpiCalcResult {
  switch (config.metricType) {
    case "COUNT_ALL": {
      if (config.groupByHeader) {
        return {
          value: rows.length,
          resultData: groupCount(rows, config.groupByHeader),
        };
      }
      return { value: rows.length, resultData: null };
    }

    case "COUNT": {
      const filtered = rows.filter((row) => matchesConditions(row, config.conditions));
      if (config.groupByHeader) {
        return {
          value: filtered.length,
          resultData: groupCount(filtered, config.groupByHeader),
        };
      }
      return { value: filtered.length, resultData: null };
    }

    case "RATIO": {
      const numerator = rows.filter((row) => matchesConditions(row, config.conditions)).length;
      const denominator = config.denominatorConditions.length
        ? rows.filter((row) => matchesConditions(row, config.denominatorConditions)).length
        : rows.length;
      const value = denominator > 0 ? (numerator / denominator) * 100 : 0;
      return { value, resultData: null };
    }

    case "SUM": {
      const filtered = rows.filter((row) => matchesConditions(row, config.conditions));
      const header = config.sumHeader;
      if (!header) {
        return { value: 0, resultData: null };
      }
      if (config.groupByHeader) {
        const grouped = groupSum(filtered, config.groupByHeader, header);
        const total = grouped.reduce((sum, item) => sum + item.value, 0);
        return { value: total, resultData: grouped };
      }
      const total = filtered.reduce((sum, row) => {
        const amount = parseFloat((row[header] ?? "").replace(/,/g, ""));
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0);
      return { value: total, resultData: null };
    }

    default:
      return { value: null, resultData: null };
  }
}

/** groupByHeader가 chart 형 KPI를 지원하는 metricType인지 판단한다. */
export function supportsGrouping(metricType: MetricType): boolean {
  return metricType === "COUNT" || metricType === "COUNT_ALL" || metricType === "SUM";
}

/**
 * 현재 설정(metricType, groupBy 여부, groupBy Header가 기간형인지)으로
 * 선택 가능한 chartType 목록을 계산한다. UI와 서버 액션 양쪽에서 이 함수만 사용해
 * 동일한 제한을 적용한다.
 */
export function getAvailableChartTypes(
  metricType: MetricType,
  hasGroupBy: boolean,
  isPeriodHeader: boolean,
): ChartType[] {
  if (metricType === "RATIO") {
    return ["NUMBER_CARD", "PROGRESS"];
  }

  // COUNT / COUNT_ALL / SUM
  if (!hasGroupBy) {
    return ["NUMBER_CARD"];
  }

  if (isPeriodHeader) {
    return ["NUMBER_CARD", "BAR", "LINE", "AREA"];
  }

  return ["NUMBER_CARD", "BAR", "HORIZONTAL_BAR", "DONUT", "PIE"];
}
