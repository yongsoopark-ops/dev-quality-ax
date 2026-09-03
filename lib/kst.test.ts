import { describe, expect, it } from "vitest";
import { combineDateWithKstTimeOfDay, formatKstTime, kstWallClockToInstant, toKstParts } from "./kst";

/**
 * Hotfix Audit(Production KST/UTC 시간대 오차) — 이 파일의 함수들은 전부
 * getUTC*()/Date.UTC()만 쓰므로, 테스트가 어떤 TZ에서 돌아가든(vitest
 * 프로세스의 실제 로컬 timezone과 무관) 항상 같은 결과가 나와야 한다.
 * 그래서 "서버가 UTC일 때"를 흉내내려고 process.env.TZ를 바꾸는 대신,
 * 절대 시각(UTC ISO 문자열) → KST 벽시계 값을 직접 검증한다.
 */

describe("toKstParts", () => {
  it("UTC 자정은 KST로 같은 날 오전 9시다", () => {
    expect(toKstParts(new Date("2026-09-07T00:00:00Z"))).toEqual({
      year: 2026,
      month: 8, // 0-based → 9월
      day: 7,
      hour: 9,
      minute: 0,
    });
  });

  it("실제로 재현한 문제: 로컬(KST) 10:00 ~ 11:20 회의는 UTC로 01:00 ~ 02:20에 저장된다", () => {
    expect(toKstParts(new Date("2026-09-07T01:00:00Z"))).toMatchObject({ hour: 10, minute: 0 });
    expect(toKstParts(new Date("2026-09-07T02:20:00Z"))).toMatchObject({ hour: 11, minute: 20 });
  });

  it("자정 경계: UTC 15:00(=KST 00:00 다음날)부터 KST 날짜가 바뀐다", () => {
    expect(toKstParts(new Date("2026-09-06T14:59:00Z"))).toMatchObject({ day: 6, hour: 23, minute: 59 });
    expect(toKstParts(new Date("2026-09-06T15:00:00Z"))).toMatchObject({ day: 7, hour: 0, minute: 0 });
  });
});

describe("formatKstTime", () => {
  it("서버 런타임 timezone과 무관하게 항상 KST 기준 HH:mm을 준다", () => {
    expect(formatKstTime(new Date("2026-09-07T01:00:00Z"))).toBe("10:00");
    expect(formatKstTime(new Date("2026-09-07T02:20:00Z"))).toBe("11:20");
  });
});

describe("kstWallClockToInstant", () => {
  it("KST 10:00 입력은 UTC 01:00 절대 시각으로 저장된다", () => {
    expect(kstWallClockToInstant("2026-09-07", "10:00").toISOString()).toBe("2026-09-07T01:00:00.000Z");
  });

  it("KST 자정 근처(00:30) 입력도 전날로 밀리지 않고 정확한 UTC로 변환된다", () => {
    expect(kstWallClockToInstant("2026-09-07", "00:30").toISOString()).toBe("2026-09-06T15:30:00.000Z");
  });

  it("왕복 변환: kstWallClockToInstant → toKstParts는 원래 입력과 같다", () => {
    const instant = kstWallClockToInstant("2026-09-07", "10:00");
    expect(toKstParts(instant)).toMatchObject({ year: 2026, month: 8, day: 7, hour: 10, minute: 0 });
  });
});

describe("combineDateWithKstTimeOfDay", () => {
  it("달력 날짜(UTC 자정 anchored)에 다른 절대 시각의 KST 시:분만 얹는다", () => {
    const calendarDate = new Date("2026-09-10T00:00:00Z"); // Task.startDate 관례 — UTC 자정 anchored
    const timeSource = new Date("2026-09-07T01:00:00Z"); // KST 10:00
    const result = combineDateWithKstTimeOfDay(calendarDate, timeSource);
    expect(result.toISOString()).toBe("2026-09-10T01:00:00.000Z"); // "2026-09-10 10:00 KST" = "2026-09-10 01:00 UTC"
    expect(formatKstTime(result)).toBe("10:00");
    expect(toKstParts(result)).toMatchObject({ year: 2026, month: 8, day: 10 });
  });
});
