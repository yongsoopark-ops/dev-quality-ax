export interface PeriodSelection {
  year: number;
  month: number; // 1-12
}

/**
 * Home 상단 기간 선택의 공통 상태. "월별"과 "기간" 두 조회 모드를 명확히 구분하면서도,
 * 두 모드 모두 동일한 getDashboardPeriodRange()/filterRowsByPeriod()를 거쳐
 * 하나의 PeriodRange로 귀결되도록 한다 (KPI 계산과 Drill-down이 서로 다른 필터를
 * 쓰지 않게 하기 위함).
 */
export type DashboardPeriod =
  | { mode: "month"; year: number; month: number }
  | {
      mode: "range";
      fromYear: number;
      fromMonth: number;
      toYear: number;
      toMonth: number;
    };

export interface PeriodRange {
  startKey: number;
  endKey: number;
  label: string;
}

/** 해당 연/월의 마지막 일(day-of-month)을 구한다. */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function dateKey(y: number, m: number, d: number): number {
  return y * 10000 + m * 100 + d;
}

/** 선택 월을 실제 날짜 범위(YYYYMMDD 정수 키, inclusive)로 변환한다. */
export function getPeriodRange(selection: PeriodSelection): PeriodRange {
  const daysInMonth = getDaysInMonth(selection.year, selection.month);

  return {
    startKey: dateKey(selection.year, selection.month, 1),
    endKey: dateKey(selection.year, selection.month, daysInMonth),
    label: `${selection.year}년 ${selection.month}월`,
  };
}

/** 시작월 1일 ~ 종료월 마지막 날까지(둘 다 포함)를 하나의 PeriodRange로 만든다. */
export function getPeriodRangeSpan(
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number,
): PeriodRange {
  const daysInToMonth = getDaysInMonth(toYear, toMonth);

  return {
    startKey: dateKey(fromYear, fromMonth, 1),
    endKey: dateKey(toYear, toMonth, daysInToMonth),
    label: `${fromYear}년 ${fromMonth}월 ~ ${toYear}년 ${toMonth}월`,
  };
}

/**
 * DashboardPeriod(월별 또는 기간)를 실제 날짜 범위로 변환하는 단일 진입점.
 * KPI 계산(Home)과 Drill-down이 반드시 이 함수를 거쳐 동일한 PeriodRange를 얻도록 한다.
 */
export function getDashboardPeriodRange(period: DashboardPeriod): PeriodRange {
  if (period.mode === "month") {
    return getPeriodRange({ year: period.year, month: period.month });
  }
  return getPeriodRangeSpan(period.fromYear, period.fromMonth, period.toYear, period.toMonth);
}

/** 현재 선택된 연도(들)를 반환한다. 연도 선택지 계산 시 항상 포함시키기 위해 쓴다. */
export function getDashboardPeriodYears(period: DashboardPeriod): number[] {
  if (period.mode === "month") return [period.year];
  return [period.fromYear, period.toYear];
}

/** 연/월을 "연*12+월(0-based)" 하나의 정수로 접어, 월 단위 덧셈/뺄셈에서 연도 초과를 자동 처리한다. */
function toMonthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * "전월 대비" 비교에 쓸 직전 기간을 계산한다.
 * - 월별 모드: 선택한 달의 바로 전 달(연도 경계 자동 처리, 예: 2026-01 → 2025-12).
 * - 기간 모드: 선택한 기간과 동일한 개월 수를 가지며, 선택 기간과 겹치지 않고 바로 앞에
 *   붙는 기간(예: 2026-05~2026-07(3개월) → 2026-02~2026-04).
 * 기존 월 파싱/필터 함수(getPeriodRange 등)가 그대로 이 결과를 받아 처리할 수 있도록
 * 동일한 DashboardPeriod 형태로 반환한다.
 */
export function getPreviousComparisonPeriod(period: DashboardPeriod): DashboardPeriod {
  if (period.mode === "month") {
    const prev = fromMonthIndex(toMonthIndex(period.year, period.month) - 1);
    return { mode: "month", year: prev.year, month: prev.month };
  }

  const fromIndex = toMonthIndex(period.fromYear, period.fromMonth);
  const toIndex = toMonthIndex(period.toYear, period.toMonth);
  const spanMonths = toIndex - fromIndex + 1;

  const prevToIndex = fromIndex - 1;
  const prevFromIndex = prevToIndex - spanMonths + 1;

  const prevFrom = fromMonthIndex(prevFromIndex);
  const prevTo = fromMonthIndex(prevToIndex);

  return {
    mode: "range",
    fromYear: prevFrom.year,
    fromMonth: prevFrom.month,
    toYear: prevTo.year,
    toMonth: prevTo.month,
  };
}

/** 비교 Indicator에 붙일 라벨. 월별 모드는 "전월 대비", 기간 모드는 "직전 기간 대비". */
export function getComparisonLabel(period: DashboardPeriod): string {
  return period.mode === "month" ? "전월 대비" : "직전 기간 대비";
}

// "2026-07-15", "2026/7/15", "2026.7.15" (뒤에 시각이 붙어도 허용)
const YMD_PATTERN = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/;
// "2025. 2", "2025-7", "2025/07" 처럼 연/월까지만 기록된 경우 (일자 없음 → 1일로 간주)
const YM_PATTERN = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*$/;

/** Sheet 셀 원문 값에서 연/월/일을 추출한다. 실패하면 null. */
export function parseCellDate(value: string): { y: number; m: number; d: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const ymdMatch = trimmed.match(YMD_PATTERN);
  if (ymdMatch) {
    const y = Number(ymdMatch[1]);
    const m = Number(ymdMatch[2]);
    const d = Number(ymdMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { y, m, d };
    }
  }

  const ymMatch = trimmed.match(YM_PATTERN);
  if (ymMatch) {
    const y = Number(ymMatch[1]);
    const m = Number(ymMatch[2]);
    if (m >= 1 && m <= 12) {
      return { y, m, d: 1 };
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
  }

  return null;
}

const DATE_HEADER_NAME_KEYWORDS = ["발생일", "날짜", "일자", "등록일", "완료일", "date"];

/** Header 이름 자체가 날짜를 의미하는지 확인한다. */
export function looksLikeDateHeaderName(header: string): boolean {
  const normalized = header.toLowerCase();
  return DATE_HEADER_NAME_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

/** 표본 값들을 보고 해당 Header가 기간(날짜) 성격인지 휴리스틱으로 판단한다. AI를 사용하지 않는다. */
export function isPeriodHeaderBySamples(samples: string[]): boolean {
  const nonEmpty = samples.map((s) => s.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return false;
  const dateLike = nonEmpty.filter((value) => parseCellDate(value) !== null).length;
  return dateLike / nonEmpty.length >= 0.6;
}

/**
 * Header가 기간 기준 Header 후보인지 판단한다.
 * 이름에 날짜 의미 키워드가 있으면 우선 포함하고, 아니면 표본 값의 날짜 파싱 비율로 판단한다.
 */
export function isPeriodHeaderCandidate(header: string, samples: string[]): boolean {
  if (looksLikeDateHeaderName(header)) return true;
  return isPeriodHeaderBySamples(samples);
}

/**
 * GoogleSheetSourceRow 캐시 행을 dateHeader 기준으로 선택 기간에 해당하는 행만 남긴다.
 * Google API를 호출하지 않고, 이미 로드된 캐시 행 배열만 대상으로 필터링한다.
 */
export function filterRowsByPeriod<T extends Record<string, string>>(
  rows: T[],
  dateHeader: string,
  range: PeriodRange,
): T[] {
  return rows.filter((row) => {
    const parts = parseCellDate(row[dateHeader] ?? "");
    if (!parts) return false;
    const key = dateKey(parts.y, parts.m, parts.d);
    return key >= range.startKey && key <= range.endKey;
  });
}

/** 캐시 행에서 dateHeader 값이 실제로 가리키는 연도만 뽑아낸다. */
export function extractYearsFromRows<T extends Record<string, string>>(
  rows: T[],
  dateHeader: string,
): number[] {
  const years = new Set<number>();
  for (const row of rows) {
    const parts = parseCellDate(row[dateHeader] ?? "");
    if (parts) years.add(parts.y);
  }
  return [...years];
}

/**
 * 후보 연도들(및 현재 선택된 연도)을 감싸는 최소~최대 연속 구간을 만든다.
 * 데이터가 2024/2026년만 있어도 2025년까지 선택은 가능하게 해, "데이터 없는 기간은 0건으로
 * 표시" 원칙과 일관되게 동작한다.
 */
export function buildYearRange(candidateYears: number[]): number[] {
  if (candidateYears.length === 0) return [];
  const min = Math.min(...candidateYears);
  const max = Math.max(...candidateYears);
  const range: number[] = [];
  for (let y = min; y <= max; y++) range.push(y);
  return range;
}

/** searchParams에서 월 선택 상태를 복원한다. 값이 없거나 잘못되면 현재 월로 기본값을 잡는다. */
export function parsePeriodSelection(searchParams: { date?: string }): PeriodSelection {
  const now = new Date();
  const dateMatch = (searchParams.date ?? "").match(/^(\d{4})-(\d{1,2})$/);
  const year = dateMatch ? Number(dateMatch[1]) : now.getFullYear();
  const rawMonth = dateMatch ? Number(dateMatch[2]) : now.getMonth() + 1;
  const month = Math.min(Math.max(rawMonth, 1), 12);

  return { year, month };
}

function parseMonthString(value: string | undefined): { year: number; month: number } | null {
  const match = (value ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/**
 * searchParams에서 Home의 기간 선택 상태(DashboardPeriod)를 복원한다.
 * 우선순위: from+to가 둘 다 유효하고 from<=to → 기간 모드.
 * 그 외 date가 유효 → 월별 모드. 아무것도 없으면 현재 월(월별 모드).
 * from>to처럼 순서가 잘못된 경우는 "정상 존재"로 보지 않고 다음 우선순위로 넘어간다.
 */
export function parseDashboardPeriod(searchParams: {
  date?: string;
  from?: string;
  to?: string;
}): DashboardPeriod {
  const from = parseMonthString(searchParams.from);
  const to = parseMonthString(searchParams.to);

  if (from && to && from.year * 100 + from.month <= to.year * 100 + to.month) {
    return {
      mode: "range",
      fromYear: from.year,
      fromMonth: from.month,
      toYear: to.year,
      toMonth: to.month,
    };
  }

  const month = parsePeriodSelection({ date: searchParams.date });
  return { mode: "month", year: month.year, month: month.month };
}
