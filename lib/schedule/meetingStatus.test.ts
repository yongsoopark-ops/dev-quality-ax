import { describe, expect, it } from "vitest";
import { computeMeetingOccurrenceStatus, getEffectiveTaskStatus } from "./meetingStatus";
import { isTaskOverdue } from "./constants";
import type { TaskWithRelations } from "./types";

describe("isTaskOverdue", () => {
  it("dueDate가 과거이고 완료 상태가 아니면 지연이다", () => {
    expect(isTaskOverdue(new Date("2020-01-01"), "TODO")).toBe(true);
  });

  it("완료(DONE) 상태면 dueDate가 과거여도 지연이 아니다", () => {
    expect(isTaskOverdue(new Date("2020-01-01"), "DONE")).toBe(false);
  });

  it("MEETING 업무구분은 항상 지연이 아니다(회차별 자동 상태가 대신 표시)", () => {
    expect(isTaskOverdue(new Date("2020-01-01"), "TODO", "MEETING")).toBe(false);
  });

  it("dueDate가 미래면 지연이 아니다", () => {
    expect(isTaskOverdue(new Date("2999-01-01"), "TODO")).toBe(false);
  });
});

describe("computeMeetingOccurrenceStatus", () => {
  const occurrence = new Date("2026-09-07T00:00:00");
  const start = new Date("2026-01-01T10:00:00").toISOString();
  const end = new Date("2026-01-01T11:00:00").toISOString();

  it("시작 전이면 TODO(예정)", () => {
    const now = new Date("2026-09-07T09:00:00");
    expect(computeMeetingOccurrenceStatus(occurrence, start, end, now)).toBe("TODO");
  });

  it("시작~종료 사이면 IN_PROGRESS(진행중)", () => {
    const now = new Date("2026-09-07T10:30:00");
    expect(computeMeetingOccurrenceStatus(occurrence, start, end, now)).toBe("IN_PROGRESS");
  });

  it("종료 이후면 DONE(완료)", () => {
    const now = new Date("2026-09-07T12:00:00");
    expect(computeMeetingOccurrenceStatus(occurrence, start, end, now)).toBe("DONE");
  });
});

function meetingTask(overrides: Partial<TaskWithRelations>): TaskWithRelations {
  return {
    id: "t1",
    category: "MEETING",
    status: "TODO",
    meetingDetail: {
      time: new Date("2026-01-01T10:00:00").toISOString(),
      endTime: new Date("2026-01-01T11:00:00").toISOString(),
    },
    ...overrides,
  } as unknown as TaskWithRelations;
}

describe("getEffectiveTaskStatus", () => {
  it("MEETING이 아니면 저장된 status를 그대로 쓴다", () => {
    const task = { category: "PROJECT", status: "IN_PROGRESS" } as unknown as TaskWithRelations;
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("IN_PROGRESS");
  });

  it("MEETING이지만 자동관리 3종(TODO/IN_PROGRESS/DONE)이 아니면(예: ON_HOLD) 그 값을 존중한다", () => {
    const task = meetingTask({ status: "ON_HOLD" });
    expect(getEffectiveTaskStatus(task, new Date("2026-09-07T00:00:00"), new Date("2026-09-07T12:00:00"))).toBe("ON_HOLD");
  });

  it("MEETING인데 endTime이 없는(레거시) 경우 저장된 status를 그대로 쓴다", () => {
    const task = meetingTask({
      meetingDetail: { time: new Date().toISOString(), endTime: null } as unknown as TaskWithRelations["meetingDetail"],
    });
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("TODO");
  });

  it("MEETING + 자동관리 상태 + 시간 정보 있음 → 회차 날짜 기준으로 계산한다", () => {
    const task = meetingTask({ status: "TODO" });
    const occurrence = new Date("2026-09-07T00:00:00");
    const now = new Date("2026-09-07T10:30:00");
    expect(getEffectiveTaskStatus(task, occurrence, now)).toBe("IN_PROGRESS");
  });
});
