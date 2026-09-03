import { describe, expect, it } from "vitest";
import {
  NO_RECURRENCE,
  computeFirstOccurrenceOnOrAfter,
  computeRecurringOccurrenceDates,
  describeRecurrenceRule,
  type RecurrenceRule,
  type Weekday,
} from "./recurrence";

/**
 * Step(V1 코드 건강도 / 안정화 점검) — recurrence.ts는 DB/React 의존이 없는
 * 순수 계산 함수라 회귀 테스트를 붙이기 가장 안전하고 가치가 큰 대상이다.
 * 여기서 확인이 깨지면 Month/Week View에 실제로 잘못된 반복 일정이
 * 표시된다 — 화면 없이도 이 계산 자체의 정확성을 보장한다.
 */

function rule(overrides: Partial<RecurrenceRule>): RecurrenceRule {
  return { ...NO_RECURRENCE, ...overrides };
}

/** 이 모듈 전체가 로컬 달력 날짜(연/월/일) 기준으로 계산하므로(date-fns의
 * startOfDay/addDays, `new Date(year, month, day)` 로컬 생성자 등), 검증도
 * 로컬 날짜 성분으로 포맷해야 한다 — toISOString()은 UTC로 변환해 로컬
 * 타임존이 UTC+였면 하루 밀려 보이는 착시를 만든다(실제로 겪은 문제). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function iso(dates: Date[]): string[] {
  return dates.map(isoLocal);
}

describe("computeRecurringOccurrenceDates — DAILY", () => {
  it("매일 반복 — 구간 안의 모든 날짜를 반환한다(anchor 자신은 제외)", () => {
    const anchor = new Date("2026-09-01T00:00:00");
    const rangeStart = new Date("2026-09-01T00:00:00");
    const rangeEnd = new Date("2026-09-05T00:00:00");
    const result = computeRecurringOccurrenceDates(rule({ type: "DAILY", interval: 1 }), anchor, rangeStart, rangeEnd);
    expect(iso(result)).toEqual(["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
  });

  it("2일마다(interval=2) — anchor 기준으로 정렬된 날짜만 반환한다", () => {
    const anchor = new Date("2026-09-01T00:00:00");
    const rangeStart = new Date("2026-09-01T00:00:00");
    const rangeEnd = new Date("2026-09-09T00:00:00");
    const result = computeRecurringOccurrenceDates(rule({ type: "DAILY", interval: 2 }), anchor, rangeStart, rangeEnd);
    expect(iso(result)).toEqual(["2026-09-03", "2026-09-05", "2026-09-07", "2026-09-09"]);
  });
});

describe("computeRecurringOccurrenceDates — WEEKLY", () => {
  it("매주 특정 요일들(복수 weekday) — 지정한 요일에만 발생한다", () => {
    // 2026-09-01은 화요일
    const anchor = new Date("2026-09-01T00:00:00");
    const rangeStart = new Date("2026-09-01T00:00:00");
    const rangeEnd = new Date("2026-09-14T00:00:00");
    const weekdays: Weekday[] = ["MON", "WED", "FRI"];
    const result = computeRecurringOccurrenceDates(rule({ type: "WEEKLY", interval: 1, weekdays }), anchor, rangeStart, rangeEnd);
    // anchor(화, 09-01) 자체는 제외. 그 주 수/금, 다음 주 월/수/금까지.
    expect(iso(result)).toEqual(["2026-09-02", "2026-09-04", "2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14"]);
  });

  it("격주(interval=2) — anchor가 속한 주 기준으로 2주 간격만 발생한다", () => {
    const anchor = new Date("2026-09-01T00:00:00"); // 화요일, 그 주가 0주차
    const rangeStart = new Date("2026-09-01T00:00:00");
    const rangeEnd = new Date("2026-09-22T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "WEEKLY", interval: 2, weekdays: ["TUE"] }),
      anchor,
      rangeStart,
      rangeEnd,
    );
    // 0주차(anchor 주)는 anchor 자신이라 제외, 1주차(홀수)는 건너뛰고 2주차만.
    expect(iso(result)).toEqual(["2026-09-15"]);
  });

  it("weekdays가 비어 있으면 아무 것도 발생하지 않는다", () => {
    const anchor = new Date("2026-09-01T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "WEEKLY", interval: 1, weekdays: [] }),
      anchor,
      anchor,
      new Date("2026-09-30T00:00:00"),
    );
    expect(result).toEqual([]);
  });
});

describe("computeRecurringOccurrenceDates — MONTHLY", () => {
  it("매월 같은 날짜(DAY_OF_MONTH)", () => {
    const anchor = new Date("2026-01-15T00:00:00");
    const rangeStart = new Date("2026-01-01T00:00:00");
    const rangeEnd = new Date("2026-04-30T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "MONTHLY", interval: 1, monthlyRuleType: "DAY_OF_MONTH", monthDay: 15 }),
      anchor,
      rangeStart,
      rangeEnd,
    );
    expect(iso(result)).toEqual(["2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("존재하지 않는 날짜(31일)가 있는 달은 건너뛴다(임의 보정하지 않음)", () => {
    const anchor = new Date("2026-01-31T00:00:00");
    const rangeStart = new Date("2026-01-01T00:00:00");
    const rangeEnd = new Date("2026-05-31T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "MONTHLY", interval: 1, monthlyRuleType: "DAY_OF_MONTH", monthDay: 31 }),
      anchor,
      rangeStart,
      rangeEnd,
    );
    // 2월/4월은 31일이 없어 건너뛰고 3월/5월만.
    expect(iso(result)).toEqual(["2026-03-31", "2026-05-31"]);
  });

  it("매월 N번째 요일(NTH_WEEKDAY) — 예: 둘째 주 화요일", () => {
    const anchor = new Date("2026-01-13T00:00:00"); // 2026-01-13은 둘째 주 화요일
    const rangeStart = new Date("2026-01-01T00:00:00");
    const rangeEnd = new Date("2026-03-31T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "MONTHLY", interval: 1, monthlyRuleType: "NTH_WEEKDAY", monthlyWeekOrdinal: 2, monthlyWeekday: "TUE" }),
      anchor,
      rangeStart,
      rangeEnd,
    );
    expect(iso(result)).toEqual(["2026-02-10", "2026-03-10"]);
  });

  it("매월 마지막 요일(ordinal=-1) — 예: 마지막 금요일", () => {
    const anchor = new Date("2026-01-30T00:00:00"); // 2026-01-30은 1월의 마지막 금요일
    const rangeStart = new Date("2026-01-01T00:00:00");
    const rangeEnd = new Date("2026-03-31T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "MONTHLY", interval: 1, monthlyRuleType: "NTH_WEEKDAY", monthlyWeekOrdinal: -1, monthlyWeekday: "FRI" }),
      anchor,
      rangeStart,
      rangeEnd,
    );
    expect(iso(result)).toEqual(["2026-02-27", "2026-03-27"]);
  });
});

describe("computeRecurringOccurrenceDates — YEARLY", () => {
  it("매년 같은 월/일에 발생한다", () => {
    const anchor = new Date("2026-03-10T00:00:00");
    const rangeStart = new Date("2026-01-01T00:00:00");
    const rangeEnd = new Date("2029-12-31T00:00:00");
    const result = computeRecurringOccurrenceDates(rule({ type: "YEARLY", interval: 1 }), anchor, rangeStart, rangeEnd);
    expect(iso(result)).toEqual(["2027-03-10", "2028-03-10", "2029-03-10"]);
  });

  it("윤년 2/29 anchor는 평년에는 건너뛴다", () => {
    const anchor = new Date("2028-02-29T00:00:00"); // 2028은 윤년
    const rangeStart = new Date("2028-01-01T00:00:00");
    const rangeEnd = new Date("2032-12-31T00:00:00");
    const result = computeRecurringOccurrenceDates(rule({ type: "YEARLY", interval: 1 }), anchor, rangeStart, rangeEnd);
    // 2029/2030/2031은 평년이라 2/29가 없어 건너뛰고, 2032(윤년)에만 발생.
    expect(iso(result)).toEqual(["2032-02-29"]);
  });
});

describe("computeRecurringOccurrenceDates — recurrenceCount vs recurrenceEndDate", () => {
  it("count=5면 anchor 포함 총 5회(anchor 1 + 계산된 4회)만 발생한다", () => {
    const anchor = new Date("2026-01-01T00:00:00");
    const rangeStart = new Date("2026-01-01T00:00:00");
    const rangeEnd = new Date("2027-01-01T00:00:00"); // 범위는 넉넉히 주고 count로만 제한되는지 확인
    const result = computeRecurringOccurrenceDates(rule({ type: "DAILY", interval: 1, count: 5 }), anchor, rangeStart, rangeEnd);
    expect(result).toHaveLength(4); // anchor 자신은 결과에 없으므로 4개
    expect(iso(result)).toEqual(["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
  });

  it("count=1이면 anchor만 발생 횟수를 채우므로 추가 회차가 없다", () => {
    const anchor = new Date("2026-01-01T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "DAILY", interval: 1, count: 1 }),
      anchor,
      anchor,
      new Date("2026-02-01T00:00:00"),
    );
    expect(result).toEqual([]);
  });

  it("endDate가 있으면 그 날짜까지만(초과 제외) 발생한다", () => {
    const anchor = new Date("2026-01-01T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "DAILY", interval: 1, endDate: "2026-01-04T00:00:00.000Z" }),
      anchor,
      anchor,
      new Date("2026-02-01T00:00:00"),
    );
    expect(iso(result)).toEqual(["2026-01-02", "2026-01-03", "2026-01-04"]);
  });

  it("count와 endDate 중 count가 먼저 도달하면 count가 우선 적용된다", () => {
    const anchor = new Date("2026-01-01T00:00:00");
    const result = computeRecurringOccurrenceDates(
      rule({ type: "DAILY", interval: 1, count: 3, endDate: "2026-06-01T00:00:00.000Z" }),
      anchor,
      anchor,
      new Date("2026-06-01T00:00:00"),
    );
    expect(result).toHaveLength(2); // count=3 → anchor+2회
  });
});

describe("computeFirstOccurrenceOnOrAfter", () => {
  it("WEEKLY — referenceDate 당일이 반복 요일이면 그 날짜를 반환한다", () => {
    const result = computeFirstOccurrenceOnOrAfter(
      rule({ type: "WEEKLY", interval: 1, weekdays: ["MON"] }),
      new Date("2026-09-07T00:00:00"), // 월요일
    );
    expect(result && isoLocal(result)).toBe("2026-09-07");
  });

  it("MONTHLY ordinal — 다음 유효 회차를 24개월 이내에서 찾는다", () => {
    const result = computeFirstOccurrenceOnOrAfter(
      rule({ type: "MONTHLY", interval: 1, monthlyRuleType: "NTH_WEEKDAY", monthlyWeekOrdinal: 1, monthlyWeekday: "MON" }),
      new Date("2026-09-02T00:00:00"),
    );
    expect(result).not.toBeNull();
  });

  it("endDate가 이미 지난 반복은 null을 반환한다", () => {
    const result = computeFirstOccurrenceOnOrAfter(
      rule({ type: "DAILY", interval: 1, endDate: "2026-01-01T00:00:00.000Z" }),
      new Date("2026-06-01T00:00:00"),
    );
    expect(result).toBeNull();
  });
});

describe("describeRecurrenceRule", () => {
  it("반복 없음", () => {
    expect(describeRecurrenceRule(NO_RECURRENCE, new Date())).toBe("반복 없음");
  });

  it("격주 요약 문구", () => {
    const r = rule({ type: "WEEKLY", interval: 2, weekdays: ["MON", "WED"] });
    expect(describeRecurrenceRule(r, new Date())).toBe("반복: 격주 월, 수요일 · 무한 반복");
  });

  it("count 종료 조건 문구", () => {
    const r = rule({ type: "DAILY", interval: 1, count: 5 });
    expect(describeRecurrenceRule(r, new Date())).toBe("반복: 매일 · 5회");
  });

  it("endDate 종료 조건 문구", () => {
    const r = rule({ type: "DAILY", interval: 1, endDate: "2026-12-31T00:00:00.000Z" });
    expect(describeRecurrenceRule(r, new Date())).toBe("반복: 매일 · 2026-12-31까지");
  });
});
