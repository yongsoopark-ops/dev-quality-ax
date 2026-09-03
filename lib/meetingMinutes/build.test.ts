import { describe, expect, it } from "vitest";
import { buildWeeklySections, type WeeklyTaskInfo } from "./build";

/**
 * Step(V1 코드 건강도 / 안정화 점검) — buildWeeklySections는 순수 함수라
 * DB 없이 "복수 담당 Task 중복 표시" / "미배정은 항상 맨 뒤" / "담당자 정렬
 * 안정성" 같은 문서화된 정책이 실제로 지켜지는지 회귀 테스트로 고정한다.
 */

function task(overrides: Partial<WeeklyTaskInfo>): WeeklyTaskInfo {
  return {
    id: "t1",
    title: "업무",
    meetingReportSection: "REGULAR_PROJECT",
    projectName: null,
    goalName: null,
    assigneeNames: [],
    isCommonAssignee: false,
    startDate: new Date("2026-09-01"),
    dueDate: new Date("2026-09-04"),
    ...overrides,
  };
}

describe("buildWeeklySections", () => {
  it("담당자가 여러 명인 Task는 각 담당자 그룹에 모두 중복 표시된다", () => {
    const tasks = [task({ id: "t1", projectName: "P1", assigneeNames: ["철수", "영희"] })];
    const sortKeys = new Map([
      ["철수", 1],
      ["영희", 2],
    ]);
    const [section] = buildWeeklySections(tasks, sortKeys);
    expect(section.assigneeGroups.map((g) => g.assigneeName)).toEqual(["철수", "영희"]);
    // 두 그룹 모두 같은 Task가 나타나야 한다.
    expect(section.assigneeGroups[0].groups[0].tasks[0].title).toBe("업무");
    expect(section.assigneeGroups[1].groups[0].tasks[0].title).toBe("업무");
    // 각 행의 담당자 목록 자체는 그룹 소속과 무관하게 항상 전체 담당자다.
    expect(section.assigneeGroups[0].groups[0].tasks[0].assignees).toEqual(["철수", "영희"]);
  });

  it("담당자가 없는 Task는 '담당자 미지정'(null) 그룹으로 모이고 항상 맨 뒤에 온다", () => {
    const tasks = [
      task({ id: "t1", projectName: "P1", assigneeNames: ["철수"] }),
      task({ id: "t2", projectName: "P2", assigneeNames: [] }),
    ];
    const sortKeys = new Map([["철수", 1]]);
    const [section] = buildWeeklySections(tasks, sortKeys);
    const names = section.assigneeGroups.map((g) => g.assigneeName);
    expect(names[names.length - 1]).toBeNull();
    expect(names).toContain("철수");
  });

  it("담당자 정렬은 assigneeSortKeys(createdAt asc) 기준이지 하드코딩된 이름 순서가 아니다", () => {
    const tasks = [
      task({ id: "t1", assigneeNames: ["영희"] }),
      task({ id: "t2", assigneeNames: ["철수"] }),
    ];
    // "영희"가 이름 사전순으로는 뒤지만, createdAt(sortKey)이 더 이르면 먼저 나와야 한다.
    const sortKeys = new Map([
      ["영희", 100],
      ["철수", 200],
    ]);
    const [section] = buildWeeklySections(tasks, sortKeys);
    expect(section.assigneeGroups.map((g) => g.assigneeName)).toEqual(["영희", "철수"]);
  });

  it("같은 프로젝트의 서로 다른 Task는 그룹 안에서 별도 행으로 유지된다(병합하지 않음)", () => {
    const tasks = [
      task({ id: "t1", projectName: "P1", assigneeNames: ["철수"], title: "업무A" }),
      task({ id: "t2", projectName: "P1", assigneeNames: ["철수"], title: "업무B" }),
    ];
    const [section] = buildWeeklySections(tasks, new Map([["철수", 1]]));
    const group = section.assigneeGroups[0].groups[0];
    expect(group.title).toBe("P1");
    expect(group.tasks.map((t) => t.title)).toEqual(["업무A", "업무B"]);
  });

  it("meetingReportSection이 다른 Task는 서로 다른 Section에 분류된다", () => {
    const tasks = [
      task({ id: "t1", meetingReportSection: "REGULAR_PROJECT" }),
      task({ id: "t2", meetingReportSection: "COMMON" }),
    ];
    const sections = buildWeeklySections(tasks, new Map());
    const regular = sections.find((s) => s.section === "REGULAR_PROJECT")!;
    const common = sections.find((s) => s.section === "COMMON")!;
    expect(regular.assigneeGroups).toHaveLength(1);
    expect(common.assigneeGroups).toHaveLength(1);
  });

  // Step(V1 Fix — 회의록 공통 일정 그룹 분리)
  describe("공통(isCommonAssignee) vs 담당자 미지정 분리", () => {
    it("isCommonAssignee=true인 Task는 담당자가 없어도 '공통' 그룹으로 간다(미배정과 합쳐지지 않음)", () => {
      const tasks = [task({ id: "t1", projectName: "P1", assigneeNames: [], isCommonAssignee: true })];
      const [section] = buildWeeklySections(tasks, new Map());
      expect(section.assigneeGroups).toHaveLength(1);
      expect(section.assigneeGroups[0]).toMatchObject({ assigneeName: null, isCommon: true });
      expect(section.assigneeGroups[0].groups[0].tasks[0].title).toBe("업무");
    });

    it("공통 Task와 진짜 미배정 Task는 서로 다른 그룹으로 분리된다", () => {
      const tasks = [
        task({ id: "t1", projectName: "P1", assigneeNames: [], isCommonAssignee: true }),
        task({ id: "t2", projectName: "P2", assigneeNames: [], isCommonAssignee: false }),
      ];
      const [section] = buildWeeklySections(tasks, new Map());
      const kinds = section.assigneeGroups.map((g) => ({ assigneeName: g.assigneeName, isCommon: g.isCommon }));
      expect(kinds).toEqual([
        { assigneeName: null, isCommon: true },
        { assigneeName: null, isCommon: false },
      ]);
    });

    it("공통 그룹은 담당자 그룹보다 먼저, 담당자 미지정 그룹은 항상 맨 뒤에 온다", () => {
      const tasks = [
        task({ id: "t1", projectName: "P1", assigneeNames: ["철수"] }),
        task({ id: "t2", projectName: "P2", assigneeNames: [], isCommonAssignee: true }),
        task({ id: "t3", projectName: "P3", assigneeNames: [] }),
      ];
      const [section] = buildWeeklySections(tasks, new Map([["철수", 1]]));
      expect(section.assigneeGroups.map((g) => (g.isCommon ? "COMMON" : (g.assigneeName ?? "UNASSIGNED")))).toEqual([
        "COMMON",
        "철수",
        "UNASSIGNED",
      ]);
    });

    it("개인 담당(assignee 있음)과 복수 담당 그룹핑은 공통 로직 추가와 무관하게 기존 그대로 동작한다", () => {
      const tasks = [
        task({ id: "t1", projectName: "P1", assigneeNames: ["철수", "영희"] }),
        task({ id: "t2", projectName: "P2", assigneeNames: [], isCommonAssignee: true }),
      ];
      const sortKeys = new Map([
        ["철수", 1],
        ["영희", 2],
      ]);
      const [section] = buildWeeklySections(tasks, sortKeys);
      const personGroups = section.assigneeGroups.filter((g) => !g.isCommon);
      expect(personGroups.map((g) => g.assigneeName)).toEqual(["철수", "영희"]);
    });
  });
});
