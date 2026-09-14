import { describe, expect, it } from "vitest";
import { computeMeetingOccurrenceStatus, getEffectiveTaskStatus } from "./meetingStatus";
import { isTaskOverdue } from "./constants";
import { toKstParts } from "@/lib/kst";
import type { TaskWithRelations } from "./types";

/** 테스트에서 "오늘"/"어제"를 항상 Task.startDate/dueDate와 같은 "달력 날짜"
 * (UTC 자정 기준) 표현으로 만든다 — isTaskOverdue/computeGeneralEffectiveStatus
 * 둘 다 이 표현을 기준으로 오늘의 KST 달력 날짜와 비교하므로, 테스트도 실제
 * 코드와 동일한 기준(toKstParts)으로 "오늘"을 계산해야 실행 시점(자정 근처)과
 * 무관하게 항상 안정적으로 통과한다. */
function todayCalendarUtcMidnight(offsetDays = 0): Date {
  const { year, month, day } = toKstParts(new Date());
  return new Date(Date.UTC(year, month, day) + offsetDays * 24 * 60 * 60 * 1000);
}

describe("isTaskOverdue", () => {
  it("dueDate가 과거(오늘보다 이전 날짜)이고 완료 상태가 아니면 지연이다", () => {
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

  it("Step(overdue 정책 변경) — dueDate가 오늘(당일)이면 아직 지연이 아니다", () => {
    expect(isTaskOverdue(todayCalendarUtcMidnight(0), "TODO")).toBe(false);
  });

  it("Step(overdue 정책 변경) — dueDate가 어제(하루라도 지남)면 지연이다", () => {
    expect(isTaskOverdue(todayCalendarUtcMidnight(-1), "IN_PROGRESS")).toBe(true);
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
  it("MEETING이 아니고 저장된 status가 TODO가 아니면(자동 계산 대상 아님) 그대로 쓴다", () => {
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

  // Step(예정 → 진행중 자동 상태 표시) — MEETING 이외 전체 업무구분 공용.
  function nonMeetingTask(overrides: Partial<TaskWithRelations>): TaskWithRelations {
    return { id: "t2", category: "PROJECT", status: "TODO", startDate: todayCalendarUtcMidnight(0).toISOString(), ...overrides } as unknown as TaskWithRelations;
  }

  it("오늘 시작 + 예정(TODO) → 진행중으로 표시(요청사항 테스트 1)", () => {
    const task = nonMeetingTask({ startDate: todayCalendarUtcMidnight(0).toISOString() });
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("IN_PROGRESS");
  });

  it("내일 시작 + 예정(TODO) → 예정 그대로(요청사항 테스트 2)", () => {
    const task = nonMeetingTask({ startDate: todayCalendarUtcMidnight(1).toISOString() });
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("TODO");
  });

  it("어제 시작 + 저장된 status가 이미 진행중(IN_PROGRESS) → 그대로 진행중(요청사항 테스트 3)", () => {
    const task = nonMeetingTask({ status: "IN_PROGRESS", startDate: todayCalendarUtcMidnight(-1).toISOString() });
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("IN_PROGRESS");
  });

  it("어제 시작 + 완료(DONE) → 완료 그대로(요청사항 테스트 4)", () => {
    const task = nonMeetingTask({ status: "DONE", startDate: todayCalendarUtcMidnight(-1).toISOString() });
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("DONE");
  });

  it("사용자 정의 상태(예약 4종 아님)는 startDate와 무관하게 그대로 존중한다(GENERIC 동작)", () => {
    const task = nonMeetingTask({ status: "custom-drop-id", startDate: todayCalendarUtcMidnight(-5).toISOString() });
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("custom-drop-id");
  });

  it("보류(ON_HOLD)는 startDate와 무관하게 그대로 존중한다(사람이 고른 예외 상태)", () => {
    const task = nonMeetingTask({ status: "ON_HOLD", startDate: todayCalendarUtcMidnight(-5).toISOString() });
    expect(getEffectiveTaskStatus(task, new Date(), new Date())).toBe("ON_HOLD");
  });
});
