import { describe, expect, it } from "vitest";
import { addCalendarDays, daysBetween, dayOfWeekLabel, formatCalendarDate, isSameCalendarDate, parseCalendarDateInput, sundayOf, thisWeekSunday } from "./date";

/**
 * 설비 관리 — 순수 날짜 유틸 테스트(DB/Prisma 의존 없음, migration 미적용
 * 상태에서도 전부 실행 가능). "달력 날짜"(UTC 자정 기준) 관례를 지키는지,
 * 특히 로컬 timezone getter를 쓰지 않아 실행 환경과 무관하게 항상 같은
 * 결과를 내는지가 핵심 검증 대상이다.
 */

describe("parseCalendarDateInput / formatCalendarDate", () => {
  it("점(.) 구분 입력을 파싱한다", () => {
    const d = parseCalendarDateInput("2026.09.09");
    expect(d).not.toBeNull();
    expect(formatCalendarDate(d!)).toBe("2026.09.09");
  });

  it("하이픈(-) 구분 입력도 파싱한다(URL 쿼리 등에서 재사용)", () => {
    const d = parseCalendarDateInput("2026-01-05");
    expect(formatCalendarDate(d!)).toBe("2026.01.05");
  });

  it("한 자리 월/일도 허용한다", () => {
    const d = parseCalendarDateInput("2026.9.9");
    expect(formatCalendarDate(d!)).toBe("2026.09.09");
  });

  it("형식이 잘못되면 null을 반환한다", () => {
    expect(parseCalendarDateInput("")).toBeNull();
    expect(parseCalendarDateInput("내일")).toBeNull();
    expect(parseCalendarDateInput("2026/09")).toBeNull();
  });

  it("UTC 자정으로 저장된다(로컬 timezone과 무관) — Task.startDate와 동일한 관례", () => {
    const d = parseCalendarDateInput("2026.09.09")!;
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe("addCalendarDays", () => {
  it("일수를 더하고 월/연도 경계를 넘어간다", () => {
    const d = parseCalendarDateInput("2026.09.28")!;
    expect(formatCalendarDate(addCalendarDays(d, 5))).toBe("2026.10.03");
  });

  it("음수로 과거로 이동한다", () => {
    const d = parseCalendarDateInput("2026.01.01")!;
    expect(formatCalendarDate(addCalendarDays(d, -1))).toBe("2025.12.31");
  });

  it("원본 Date를 변경하지 않는다(불변)", () => {
    const d = parseCalendarDateInput("2026.09.09")!;
    const before = d.getTime();
    addCalendarDays(d, 10);
    expect(d.getTime()).toBe(before);
  });
});

describe("sundayOf / thisWeekSunday", () => {
  it("주 중간 날짜 → 그 주의 일요일", () => {
    // 2026-09-09는 수요일 — README 예시 "9월 6일 – 12일"의 그 주.
    const wed = parseCalendarDateInput("2026.09.09")!;
    expect(formatCalendarDate(sundayOf(wed))).toBe("2026.09.06");
  });

  it("이미 일요일이면 그대로", () => {
    const sun = parseCalendarDateInput("2026.09.06")!;
    expect(formatCalendarDate(sundayOf(sun))).toBe("2026.09.06");
  });

  it("토요일 → 같은 주 일요일(6일 전)", () => {
    const sat = parseCalendarDateInput("2026.09.12")!;
    expect(formatCalendarDate(sundayOf(sat))).toBe("2026.09.06");
  });

  it("thisWeekSunday는 KST 파츠를 UTC 자정 달력 날짜로 바꿔 그 주 일요일을 구한다", () => {
    const sunday = thisWeekSunday({ year: 2026, month: 8, day: 9 }); // month는 0-based(9월=8)
    expect(formatCalendarDate(sunday)).toBe("2026.09.06");
  });
});

describe("isSameCalendarDate / daysBetween / dayOfWeekLabel", () => {
  it("같은 날짜면 true, 다르면 false", () => {
    const a = parseCalendarDateInput("2026.09.09")!;
    const b = parseCalendarDateInput("2026.09.09")!;
    const c = parseCalendarDateInput("2026.09.10")!;
    expect(isSameCalendarDate(a, b)).toBe(true);
    expect(isSameCalendarDate(a, c)).toBe(false);
  });

  it("daysBetween은 두 달력 날짜 사이의 일수를 계산한다(캘린더 이벤트 grid-column 계산에 사용)", () => {
    const from = parseCalendarDateInput("2026.09.06")!;
    const to = parseCalendarDateInput("2026.09.09")!;
    expect(daysBetween(from, to)).toBe(3);
    expect(daysBetween(to, from)).toBe(-3);
  });

  it("dayOfWeekLabel — 일~토 순서(README: 캘린더는 일요일 시작)", () => {
    expect(dayOfWeekLabel(parseCalendarDateInput("2026.09.06")!)).toBe("일");
    expect(dayOfWeekLabel(parseCalendarDateInput("2026.09.09")!)).toBe("수");
    expect(dayOfWeekLabel(parseCalendarDateInput("2026.09.12")!)).toBe("토");
  });
});
