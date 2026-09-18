import { describe, expect, it } from "vitest";
import {
  addMonthsTo,
  addQuarters,
  compareMonth,
  compareQuarter,
  fiscalQuarterOfCalendarMonth,
  monthKey,
  monthLabel,
  monthsBetween,
  quarterLabel,
  quarterRangeLabel,
  quartersBetween,
  parseIsoDate,
  formatIsoDate,
  displayDate,
  daysBetweenDates,
  addMonthsToDate,
} from "./date";

/**
 * 진행 현황 — 순수 날짜/분기/월 헬퍼 테스트(DB 의존 없음). ZIP 분석
 * 리포트가 확정한 회계 분기 정의(Q1=3월 시작, 1~2월은 전년도 Q4로 롤백)를
 * 그대로 검증한다.
 */

describe("fiscalQuarterOfCalendarMonth — Q1=3월 시작, 1~2월은 전년도 Q4", () => {
  it("3~5월 → Q1", () => {
    expect(fiscalQuarterOfCalendarMonth(2026, 3)).toEqual({ year: 2026, q: 1 });
    expect(fiscalQuarterOfCalendarMonth(2026, 5)).toEqual({ year: 2026, q: 1 });
  });
  it("6~8월 → Q2, 9~11월 → Q3", () => {
    expect(fiscalQuarterOfCalendarMonth(2026, 6)).toEqual({ year: 2026, q: 2 });
    expect(fiscalQuarterOfCalendarMonth(2026, 9)).toEqual({ year: 2026, q: 3 });
  });
  it("12월 → 같은 해 Q4", () => {
    expect(fiscalQuarterOfCalendarMonth(2026, 12)).toEqual({ year: 2026, q: 4 });
  });
  it("1~2월 → 전년도 Q4로 롤백", () => {
    expect(fiscalQuarterOfCalendarMonth(2027, 1)).toEqual({ year: 2026, q: 4 });
    expect(fiscalQuarterOfCalendarMonth(2027, 2)).toEqual({ year: 2026, q: 4 });
  });
});

describe("fiscalQuarterOfCalendarMonth — 분기 경계(핸드오프 §2 확인 요청)", () => {
  it("2월 말(2027-02) → 전년도(2026) Q4", () => {
    expect(fiscalQuarterOfCalendarMonth(2027, 2)).toEqual({ year: 2026, q: 4 });
  });
  it("3월 1일(2026-03) → 같은 해 Q1로 넘어간다", () => {
    expect(fiscalQuarterOfCalendarMonth(2026, 3)).toEqual({ year: 2026, q: 1 });
  });
  it("11월 30일(2026-11) → Q3", () => {
    expect(fiscalQuarterOfCalendarMonth(2026, 11)).toEqual({ year: 2026, q: 3 });
  });
  it("12월 1일(2026-12) → Q4로 넘어가고 연도는 그대로(2026)", () => {
    expect(fiscalQuarterOfCalendarMonth(2026, 12)).toEqual({ year: 2026, q: 4 });
  });
  it("다음 해 1월(2027-01) → 전년도(2026) Q4", () => {
    expect(fiscalQuarterOfCalendarMonth(2027, 1)).toEqual({ year: 2026, q: 4 });
  });
});

describe("quarterLabel / quarterRangeLabel", () => {
  it("2026 Q3 라벨", () => expect(quarterLabel({ year: 2026, q: 3 })).toBe("2026 Q3"));
  it("Q1(3~5월) 범위", () => expect(quarterRangeLabel({ year: 2026, q: 1 })).toBe("26.03–26.05"));
  it("Q4(12~다음해 2월) 범위는 종료월 연도가 넘어간다", () => expect(quarterRangeLabel({ year: 2026, q: 4 })).toBe("26.12–27.02"));
});

describe("compareQuarter / addQuarters / quartersBetween", () => {
  it("연도가 다른 분기 비교", () => expect(compareQuarter({ year: 2026, q: 4 }, { year: 2027, q: 1 })).toBeLessThan(0));
  it("addQuarters가 연도 경계를 넘긴다", () => expect(addQuarters({ year: 2026, q: 4 }, 1)).toEqual({ year: 2027, q: 1 }));
  it("quartersBetween이 시작~끝을 모두 포함한다", () => {
    expect(quartersBetween({ year: 2026, q: 3 }, { year: 2027, q: 1 })).toEqual([
      { year: 2026, q: 3 },
      { year: 2026, q: 4 },
      { year: 2027, q: 1 },
    ]);
  });
});

describe("월(공통 업무) 헬퍼 — 평범한 달력 월", () => {
  it("monthKey/monthLabel", () => {
    expect(monthKey({ year: 2026, month: 9 })).toBe("2026-09");
    expect(monthLabel({ year: 2026, month: 9 })).toBe("26.09");
  });
  it("addMonthsTo가 연도 경계를 넘긴다", () => expect(addMonthsTo({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 }));
  it("compareMonth", () => expect(compareMonth({ year: 2026, month: 12 }, { year: 2027, month: 1 })).toBeLessThan(0));
  it("monthsBetween이 시작~끝을 모두 포함한다", () => {
    expect(monthsBetween({ year: 2026, month: 11 }, { year: 2027, month: 1 })).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });
});

describe("YYYY-MM-DD ⇄ Date(UTC 자정)", () => {
  it("parseIsoDate/formatIsoDate 왕복", () => {
    const d = parseIsoDate("2026-09-16");
    expect(d).not.toBeNull();
    expect(formatIsoDate(d)).toBe("2026-09-16");
  });
  it("형식이 다르면 null", () => expect(parseIsoDate("2026/09/16")).toBeNull());
  it("displayDate — 빈 값은 —", () => {
    expect(displayDate(null)).toBe("—");
    expect(displayDate(parseIsoDate("2026-09-16"))).toBe("2026.09.16");
  });
  it("daysBetweenDates", () => {
    expect(daysBetweenDates(parseIsoDate("2026-09-16")!, parseIsoDate("2026-09-20")!)).toBe(4);
  });
  it("addMonthsToDate", () => {
    expect(formatIsoDate(addMonthsToDate(parseIsoDate("2026-09-16")!, 3))).toBe("2026-12-16");
  });
});
