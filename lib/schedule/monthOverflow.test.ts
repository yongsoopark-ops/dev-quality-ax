import { describe, expect, it } from "vitest";
import { eventsOnDay } from "./monthOverflow";
import type { CalendarTaskEvent } from "./calendarMapper";

function event(id: string, start: string, end: string): CalendarTaskEvent {
  return { id, title: id, start: new Date(start), end: new Date(end), allDay: true, task: {} as CalendarTaskEvent["task"] };
}

describe("eventsOnDay", () => {
  const events = [
    event("single", "2026-09-10T00:00:00Z", "2026-09-10T23:59:59.999Z"),
    event("multiDay", "2026-09-08T00:00:00Z", "2026-09-12T23:59:59.999Z"),
    event("earlier", "2026-09-01T00:00:00Z", "2026-09-01T23:59:59.999Z"),
  ];

  it("그 날짜에 걸치는 이벤트만 반환한다(단일 + 여러 날짜에 걸친 이벤트)", () => {
    const result = eventsOnDay(events, new Date("2026-09-10T12:00:00"));
    expect(result.map((e) => e.id).sort()).toEqual(["multiDay", "single"]);
  });

  it("범위 밖 날짜는 제외한다", () => {
    const result = eventsOnDay(events, new Date("2026-09-15T00:00:00"));
    expect(result).toEqual([]);
  });

  it("여러 날짜에 걸친 이벤트의 시작일/마감일 경계 둘 다 포함한다", () => {
    expect(eventsOnDay(events, new Date("2026-09-08T00:00:00")).map((e) => e.id)).toContain("multiDay");
    expect(eventsOnDay(events, new Date("2026-09-12T00:00:00")).map((e) => e.id)).toContain("multiDay");
  });

  it("이벤트가 하나도 없으면 빈 배열", () => {
    expect(eventsOnDay([], new Date("2026-09-10T00:00:00"))).toEqual([]);
  });
});
