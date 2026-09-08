import { describe, expect, it } from "vitest";
import { buildEventTitle, formatMeetingTimeLabel } from "./calendarMapper";
import type { TaskWithRelations } from "./types";

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
