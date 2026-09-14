import { describe, expect, it } from "vitest";
import { dateFnsLocalizer } from "react-big-calendar";
import { sortWeekEvents } from "react-big-calendar/lib/utils/eventLevels";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { ko } from "date-fns/locale";
import {
  applyMonthCalendarTierOrder,
  buildEventTitle,
  formatMeetingTimeLabel,
  sortEventsForMonthCalendar,
  type CalendarTaskEvent,
} from "./calendarMapper";
import type { ScheduleOptionInfo, TaskWithRelations } from "./types";

function task(overrides: Partial<TaskWithRelations>): TaskWithRelations {
  return {
    id: "t1",
    title: "선제적 품질 강화",
    category: "MEETING",
    projectDetail: null,
    goalName: null,
    meetingDetail: null,
    ...overrides,
  } as unknown as TaskWithRelations;
}

describe("formatMeetingTimeLabel", () => {
  it("KST 10:00~11:20(UTC로는 01:00~02:20) → \"10:00-11:20 미팅\"", () => {
    expect(formatMeetingTimeLabel("2026-09-07T01:00:00.000Z", "2026-09-07T02:20:00.000Z")).toBe("10:00-11:20 미팅");
  });

  it("endTime이 없는 legacy 미팅은 \"HH:mm 미팅\"로 fallback", () => {
    expect(formatMeetingTimeLabel("2026-09-07T01:00:00.000Z", null)).toBe("10:00 미팅");
  });

  it("time 자체가 없으면 null(제목만 표시하는 graceful fallback)", () => {
    expect(formatMeetingTimeLabel(null, "2026-09-07T02:20:00.000Z")).toBeNull();
  });

  it("time 파싱에 실패하면 null", () => {
    expect(formatMeetingTimeLabel("이건-날짜가-아님", "2026-09-07T02:20:00.000Z")).toBeNull();
  });

  it("endTime 파싱에 실패하면 시작 시간만으로 fallback", () => {
    expect(formatMeetingTimeLabel("2026-09-07T01:00:00.000Z", "이건-날짜가-아님")).toBe("10:00 미팅");
  });

  it("자정 근처 KST 경계에서도 정확하다", () => {
    // UTC 2026-09-06T15:30:00Z = KST 2026-09-07T00:30
    expect(formatMeetingTimeLabel("2026-09-06T15:30:00.000Z", null)).toBe("00:30 미팅");
  });
});

describe("buildEventTitle", () => {
  it("PROJECT는 \"프로젝트명 | 업무명\"(회귀 없음)", () => {
    const t = task({ category: "PROJECT", title: "업무A", projectDetail: { projectName: "M-쿨러터보 핏", categoryId: null } });
    expect(buildEventTitle(t)).toBe("M-쿨러터보 핏 | 업무A");
  });

  it("PERSONAL_GOAL은 \"목표명 | 업무명\"(회귀 없음)", () => {
    const t = task({ category: "PERSONAL_GOAL", title: "업무B", goalName: "목표1" });
    expect(buildEventTitle(t)).toBe("목표1 | 업무B");
  });

  it("MEETING은 \"미팅명 | HH:mm-HH:mm 미팅\"", () => {
    const t = task({
      title: "선제적 품질 강화",
      meetingDetail: { time: "2026-09-07T01:00:00.000Z", endTime: "2026-09-07T02:20:00.000Z" } as unknown as TaskWithRelations["meetingDetail"],
    });
    expect(buildEventTitle(t)).toBe("선제적 품질 강화 | 10:00-11:20 미팅");
  });

  it("endTime 없는 legacy MEETING은 \"미팅명 | HH:mm 미팅\"", () => {
    const t = task({ title: "레거시 미팅", meetingDetail: { time: "2026-09-07T01:00:00.000Z", endTime: null } as unknown as TaskWithRelations["meetingDetail"] });
    expect(buildEventTitle(t)).toBe("레거시 미팅 | 10:00 미팅");
  });

  it("meetingDetail이 아예 없으면 제목만(graceful fallback)", () => {
    const t = task({ title: "미팅 상세 없음", meetingDetail: null });
    expect(buildEventTitle(t)).toBe("미팅 상세 없음");
  });

  it("time 파싱 실패면 제목만(graceful fallback)", () => {
    const t = task({ title: "깨진 시간", meetingDetail: { time: "invalid", endTime: "invalid" } as unknown as TaskWithRelations["meetingDetail"] });
    expect(buildEventTitle(t)).toBe("깨진 시간");
  });

  it("PROJECT인데 projectDetail이 없으면 업무명만(기존 동작 유지)", () => {
    const t = task({ category: "PROJECT", title: "업무C", projectDetail: null });
    expect(buildEventTitle(t)).toBe("업무C");
  });

  it("그 외 업무구분은 업무명 그대로(회귀 없음)", () => {
    const t = task({ category: "COMMON", title: "공통 업무" });
    expect(buildEventTitle(t)).toBe("공통 업무");
  });
});

describe("sortEventsForMonthCalendar", () => {
  const OPTIONS: ScheduleOptionInfo[] = [
    { id: "regular-id", label: "정규", color: "#000", order: 0, active: true, meetingReportSection: "REGULAR_PROJECT" },
    { id: "sub-id", label: "서브", color: "#000", order: 1, active: true, meetingReportSection: "SUB_PROJECT" },
    { id: "common-id", label: "공통", color: "#000", order: 2, active: true, meetingReportSection: "COMMON" },
    { id: "exception-id", label: "예외", color: "#000", order: 3, active: true, meetingReportSection: "EXCEPTION" },
    { id: "trip-id", label: "출장", color: "#000", order: 4, active: true, meetingReportSection: "BUSINESS_TRIP" },
    { id: "meeting-id", label: "미팅", color: "#000", order: 5, active: true, meetingReportSection: null },
  ];

  function event(id: string, category: string, isCommonAssignee = false): CalendarTaskEvent {
    return {
      id,
      title: id,
      start: new Date(),
      end: new Date(),
      allDay: true,
      task: { id, category, isCommonAssignee } as unknown as TaskWithRelations,
    };
  }

  it("요청사항 8 테스트 케이스 — 뒤섞인 입력을 파트공통 > 정규 > 서브 > 공통 > 예외 > 출장 순으로 정렬한다", () => {
    const input = [
      event("trip", "trip-id"),
      event("common", "common-id"),
      event("partCommon", "regular-id", true),
      event("sub", "sub-id"),
      event("regular", "regular-id"),
      event("exception", "exception-id"),
    ];
    const result = sortEventsForMonthCalendar(input, OPTIONS);
    expect(result.map((e) => e.id)).toEqual(["partCommon", "regular", "sub", "common", "exception", "trip"]);
  });

  it("meetingReportSection이 없는 업무구분(예: 미팅)은 맨 뒤로 간다", () => {
    const input = [event("meeting", "meeting-id"), event("trip", "trip-id"), event("regular", "regular-id")];
    const result = sortEventsForMonthCalendar(input, OPTIONS);
    expect(result.map((e) => e.id)).toEqual(["regular", "trip", "meeting"]);
  });

  it("같은 tier 안에서는 기존 순서를 그대로 보존한다(안정 정렬, 요청사항 4-1)", () => {
    const input = [event("regular-2", "regular-id"), event("regular-1", "regular-id"), event("regular-3", "regular-id")];
    const result = sortEventsForMonthCalendar(input, OPTIONS);
    expect(result.map((e) => e.id)).toEqual(["regular-2", "regular-1", "regular-3"]);
  });

  it("파트 공통 일정(isCommonAssignee)은 업무구분의 '공통'(meetingReportSection=COMMON)과 다른 개념이라 서로 구분된다", () => {
    const input = [event("commonSection", "common-id", false), event("partCommon", "sub-id", true)];
    const result = sortEventsForMonthCalendar(input, OPTIONS);
    // isCommonAssignee=true(파트 공통 일정)가 항상 tier 0으로 최우선이고,
    // meetingReportSection=COMMON(업무구분의 "공통")은 tier 3이라 그 뒤에 온다.
    expect(result.map((e) => e.id)).toEqual(["partCommon", "commonSection"]);
  });
});

/**
 * Step(Month Calendar 실제 표시 순서 보장) — sortEventsForMonthCalendar 자체는
 * 정상이었지만 react-big-calendar Month view가 주(week)마다 자체
 * sortWeekEvents로 순서를 다시 계산해 그 결과를 덮어쓰는 것이 실제 원인이었다
 * (TierAwareMonthView.tsx 참고). 이 테스트는 순수 로직만이 아니라 실제
 * react-big-calendar가 Month.js에서 호출하는 바로 그 sortWeekEvents(공식
 * export, DOM/React 렌더링 불필요)에 이벤트를 통과시킨 뒤, 그 결과 위에
 * applyMonthCalendarTierOrder를 적용해 최종 화면 순서를 검증한다 — "실제
 * library ordering path에 투입되는 comparator 수준"의 테스트(요청사항 7).
 */
describe("applyMonthCalendarTierOrder — react-big-calendar sortWeekEvents 결과 위에 tier 적용", () => {
  const OPTIONS: ScheduleOptionInfo[] = [
    { id: "regular-id", label: "정규", color: "#000", order: 0, active: true, meetingReportSection: "REGULAR_PROJECT" },
    { id: "sub-id", label: "서브", color: "#000", order: 1, active: true, meetingReportSection: "SUB_PROJECT" },
    { id: "common-id", label: "공통", color: "#000", order: 2, active: true, meetingReportSection: "COMMON" },
    { id: "exception-id", label: "예외", color: "#000", order: 3, active: true, meetingReportSection: "EXCEPTION" },
    { id: "trip-id", label: "출장", color: "#000", order: 4, active: true, meetingReportSection: "BUSINESS_TRIP" },
    { id: "meeting-id", label: "미팅", color: "#000", order: 5, active: true, meetingReportSection: null },
  ];

  const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek: () => startOfWeek(new Date(), { locale: ko }),
    getDay,
    locales: { ko },
  });
  const accessors = {
    start: (e: CalendarTaskEvent) => e.start,
    end: (e: CalendarTaskEvent) => e.end,
    allDay: (e: CalendarTaskEvent) => e.allDay,
  };

  function event(
    id: string,
    category: string,
    options: { isCommonAssignee?: boolean; start?: Date; end?: Date } = {},
  ): CalendarTaskEvent {
    const { isCommonAssignee = false, start = new Date("2026-09-14T00:00:00.000Z"), end = start } = options;
    const ev: CalendarTaskEvent = {
      id,
      title: id,
      start,
      end,
      allDay: true,
      task: { id, category, isCommonAssignee } as unknown as TaskWithRelations,
    };
    ev.monthCalendarTier = sortEventsForMonthCalendar([ev], OPTIONS)[0].monthCalendarTier;
    return ev;
  }

  it("요청사항 8 케이스 — react-big-calendar 자체 정렬을 거친 뒤에도 파트공통 > 정규 > 서브 > 공통 > 예외 > 출장 순서가 된다", () => {
    const day = new Date("2026-09-14T00:00:00.000Z");
    const input = [
      event("common", "common-id", { start: day }),
      event("exception", "exception-id", { start: day }),
      event("regular", "regular-id", { start: day }),
      event("trip", "trip-id", { start: day }),
      event("sub", "sub-id", { start: day }),
      event("partCommon", "regular-id", { isCommonAssignee: true, start: day }),
    ];
    const librarySorted = sortWeekEvents(input, accessors, localizer) as CalendarTaskEvent[];
    const result = applyMonthCalendarTierOrder(librarySorted);
    expect(result.map((e) => e.id)).toEqual(["partCommon", "regular", "sub", "common", "exception", "trip"]);
  });

  it("멀티데이 일정끼리도 tier가 다르면 react-big-calendar의 멀티데이 우선 배치보다 tier가 먼저 적용된다", () => {
    const day = new Date("2026-09-14T00:00:00.000Z");
    const weekEnd = new Date("2026-09-20T00:00:00.000Z");
    const input = [
      // 예외(tier 4) — 기간이 훨씬 길어 react-big-calendar 자체 정렬이면
      // "멀티데이 우선"으로 앞에 오지만, tier가 낮은(정규) 이벤트보다는 뒤여야 한다.
      event("exceptionLong", "exception-id", { start: day, end: weekEnd }),
      // 정규(tier 1) — 짧은 기간이라 react-big-calendar 자체 정렬만으로는
      // 위 예외 이벤트보다 뒤로 밀리지만, tier 정렬이 이를 뒤집어야 한다.
      event("regularShort", "regular-id", { start: day, end: day }),
    ];
    const librarySorted = sortWeekEvents(input, accessors, localizer) as CalendarTaskEvent[];
    // react-big-calendar 자체 정렬만으로는 멀티데이(exceptionLong)가 먼저 온다 —
    // 이 테스트가 실제로 그 상황을 재현하는지 먼저 확인한다(그렇지 않으면
    // 아래 tier 정렬 검증이 무의미해진다).
    expect(librarySorted.map((e) => e.id)).toEqual(["exceptionLong", "regularShort"]);

    const result = applyMonthCalendarTierOrder(librarySorted);
    expect(result.map((e) => e.id)).toEqual(["regularShort", "exceptionLong"]);
  });

  it("동일 tier에서는 react-big-calendar 자체 정렬(기존 second-order)이 그대로 유지된다", () => {
    const day = new Date("2026-09-14T00:00:00.000Z");
    const longerFirst = new Date("2026-09-18T00:00:00.000Z");
    const input = [
      event("regularA", "regular-id", { start: day, end: day }),
      event("regularB", "regular-id", { start: day, end: longerFirst }),
    ];
    const librarySorted = sortWeekEvents(input, accessors, localizer) as CalendarTaskEvent[];
    // 같은 tier(정규)라도 react-big-calendar는 기간이 더 긴 이벤트를 먼저
    // 배치한다 — tier 정렬(안정 정렬)이 이 순서를 바꾸지 않아야 한다.
    expect(librarySorted.map((e) => e.id)).toEqual(["regularB", "regularA"]);
    const result = applyMonthCalendarTierOrder(librarySorted);
    expect(result.map((e) => e.id)).toEqual(["regularB", "regularA"]);
  });
});
