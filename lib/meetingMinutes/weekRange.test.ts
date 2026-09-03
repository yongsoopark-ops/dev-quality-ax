import { describe, expect, it } from "vitest";
import { getWeeklyMeetingRange } from "./weekRange";

/**
 * Hotfix Audit(Production KST/UTC 시간대 오차) — getWeeklyMeetingRange는
 * "지금 이 순간"(절대 시각)을 KST 기준 달력 날짜로 바꾼 뒤 그 주의 월~금을
 * 계산한다. 서버 런타임이 UTC(Netlify Production)든 KST(로컬 개발)든 같은
 * 절대 시각에 대해 항상 같은 결과를 내야 한다 — 특히 KST 자정을 넘나드는
 * 순간(UTC 15:00 경계)에서 "오늘"의 요일이 하루 밀리지 않아야 한다.
 */
describe("getWeeklyMeetingRange", () => {
  it("평일 한낮(월요일, KST) 기준으로 그 주의 월~금을 반환한다", () => {
    // 2026-09-07은 월요일. KST 10:00 = UTC 01:00.
    expect(getWeeklyMeetingRange(new Date("2026-09-07T01:00:00Z"))).toEqual({
      start: "2026-09-07",
      end: "2026-09-11",
    });
  });

  it("주말(토요일, KST)에는 바로 지난 주의 월~금을 가리킨다(다음 주로 앞서가지 않는다)", () => {
    // 2026-09-12는 토요일.
    expect(getWeeklyMeetingRange(new Date("2026-09-12T01:00:00Z"))).toEqual({
      start: "2026-09-07",
      end: "2026-09-11",
    });
  });

  it("일요일(KST)에도 바로 지난 주의 월~금을 가리킨다", () => {
    // 2026-09-13은 일요일.
    expect(getWeeklyMeetingRange(new Date("2026-09-13T01:00:00Z"))).toEqual({
      start: "2026-09-07",
      end: "2026-09-11",
    });
  });

  it("자정 경계 — KST로는 이미 월요일이 됐지만 UTC로는 아직 일요일인 순간에도 새 주(월~금)를 정확히 계산한다", () => {
    // UTC 2026-09-06T15:30:00Z = KST 2026-09-07T00:30(월요일). 서버가 UTC로
    // 이 값을 실행했을 때(getDay()류 로컬 접근자를 썼다면) "일요일"로 잘못
    // 판정해 전전 주를 반환했을 상황 — 이 테스트가 바로 그 회귀를 막는다.
    expect(getWeeklyMeetingRange(new Date("2026-09-06T15:30:00Z"))).toEqual({
      start: "2026-09-07",
      end: "2026-09-11",
    });
  });

  it("반대 경계 — KST로는 아직 일요일 23:59인 순간에는 지난 주를 그대로 가리킨다", () => {
    // UTC 2026-09-06T14:59:00Z = KST 2026-09-06T23:59(일요일).
    expect(getWeeklyMeetingRange(new Date("2026-09-06T14:59:00Z"))).toEqual({
      start: "2026-08-31",
      end: "2026-09-04",
    });
  });

  it("월말/월초 경계에서도 자연스럽게 이전 달로 넘어간다", () => {
    // 2026-09-01은 화요일 → 그 주 월요일은 2026-08-31.
    expect(getWeeklyMeetingRange(new Date("2026-09-01T01:00:00Z"))).toEqual({
      start: "2026-08-31",
      end: "2026-09-04",
    });
  });
});
