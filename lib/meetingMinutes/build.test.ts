import { describe, expect, it } from "vitest";
import { buildWeeklySections, type WeeklyTaskInfo } from "./build";

/**
 * Step(V1 코드 건강도 / 안정화 점검) — buildWeeklySections는 순수 함수라
 * DB 없이 "복수 담당 Task 중복 표시" / "미배정은 항상 맨 뒤" / "담당자 정렬
 * 안정성" 같은 문서화된 정책이 실제로 지켜지는지 회귀 테스트로 고정한다.
 *
 * Step(담당자 View Filter + 안전한 Block 단위 저장)부터 그룹핑 key가 이름이
 * 아니라 User.id다(동명이인 안전) — 테스트의 assigneeSortKeys/그룹 key는
 * 전부 id("u-철수" 형태)를 쓰고, assigneeName은 표시용 결과 확인에만 쓴다.
 */

function task(overrides: Partial<WeeklyTaskInfo>): WeeklyTaskInfo {
  return {
    id: "t1",
    title: "업무",
    meetingReportSection: "REGULAR_PROJECT",
    projectName: null,
    goalName: null,
    assigneeNames: [],
    assigneeUserIds: [],
    isCommonAssignee: false,
    startDate: new Date("2026-09-01"),
    dueDate: new Date("2026-09-04"),
    ...overrides,
  };
}

describe("buildWeeklySections", () => {
  it("담당자가 여러 명인 Task는 각 담당자 그룹에 모두 중복 표시된다", () => {
    const tasks = [task({ id: "t1", projectName: "P1", assigneeNames: ["철수", "영희"], assigneeUserIds: ["u-철수", "u-영희"] })];
    const sortKeys = new Map([
      ["u-철수", 1],
      ["u-영희", 2],
    ]);
    const [section] = buildWeeklySections(tasks, sortKeys);
    expect(section.assigneeGroups.map((g) => g.assigneeName)).toEqual(["철수", "영희"]);
    expect(section.assigneeGroups.map((g) => g.assigneeUserId)).toEqual(["u-철수", "u-영희"]);
    // 두 그룹 모두 같은 Task가 나타나야 한다.
    expect(section.assigneeGroups[0].groups[0].tasks[0].title).toBe("업무");
    expect(section.assigneeGroups[1].groups[0].tasks[0].title).toBe("업무");
    // 각 행의 담당자 목록 자체는 그룹 소속과 무관하게 항상 전체 담당자다.
    expect(section.assigneeGroups[0].groups[0].tasks[0].assignees).toEqual(["철수", "영희"]);
  });

  it("담당자가 없는 Task는 '담당자 미지정'(null) 그룹으로 모이고 항상 맨 뒤에 온다", () => {
    const tasks = [
      task({ id: "t1", projectName: "P1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
      task({ id: "t2", projectName: "P2", assigneeNames: [], assigneeUserIds: [] }),
    ];
    const sortKeys = new Map([["u-철수", 1]]);
    const [section] = buildWeeklySections(tasks, sortKeys);
    const names = section.assigneeGroups.map((g) => g.assigneeName);
    expect(names[names.length - 1]).toBeNull();
    expect(names).toContain("철수");
  });

  it("담당자 정렬은 assigneeSortKeys(createdAt asc) 기준이지 하드코딩된 이름 순서가 아니다", () => {
    const tasks = [
      task({ id: "t1", assigneeNames: ["영희"], assigneeUserIds: ["u-영희"] }),
      task({ id: "t2", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
    ];
    // "영희"가 이름 사전순으로는 뒤지만, createdAt(sortKey)이 더 이르면 먼저 나와야 한다.
    const sortKeys = new Map([
      ["u-영희", 100],
      ["u-철수", 200],
    ]);
    const [section] = buildWeeklySections(tasks, sortKeys);
    expect(section.assigneeGroups.map((g) => g.assigneeName)).toEqual(["영희", "철수"]);
  });

  it("같은 프로젝트의 서로 다른 Task는 그룹 안에서 별도 행으로 유지된다(병합하지 않음)", () => {
    const tasks = [
      task({ id: "t1", projectName: "P1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"], title: "업무A" }),
      task({ id: "t2", projectName: "P1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"], title: "업무B" }),
    ];
    const [section] = buildWeeklySections(tasks, new Map([["u-철수", 1]]));
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
      expect(section.assigneeGroups[0]).toMatchObject({ assigneeName: null, assigneeUserId: null, isCommon: true });
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
        task({ id: "t1", projectName: "P1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
        task({ id: "t2", projectName: "P2", assigneeNames: [], isCommonAssignee: true }),
        task({ id: "t3", projectName: "P3", assigneeNames: [] }),
      ];
      const [section] = buildWeeklySections(tasks, new Map([["u-철수", 1]]));
      expect(section.assigneeGroups.map((g) => (g.isCommon ? "COMMON" : (g.assigneeName ?? "UNASSIGNED")))).toEqual([
        "COMMON",
        "철수",
        "UNASSIGNED",
      ]);
    });

    it("개인 담당(assignee 있음)과 복수 담당 그룹핑은 공통 로직 추가와 무관하게 기존 그대로 동작한다", () => {
      const tasks = [
        task({ id: "t1", projectName: "P1", assigneeNames: ["철수", "영희"], assigneeUserIds: ["u-철수", "u-영희"] }),
        task({ id: "t2", projectName: "P2", assigneeNames: [], isCommonAssignee: true }),
      ];
      const sortKeys = new Map([
        ["u-철수", 1],
        ["u-영희", 2],
      ]);
      const [section] = buildWeeklySections(tasks, sortKeys);
      const personGroups = section.assigneeGroups.filter((g) => !g.isCommon);
      expect(personGroups.map((g) => g.assigneeName)).toEqual(["철수", "영희"]);
    });
  });

  // Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일)
  describe("Stable metadata(taskId/assigneeUserIds) 및 섹션별 taskLayout/attachMetadata", () => {
    it("SectionTaskRow는 taskId(Task.id)를 그대로 보존한다", () => {
      const tasks = [task({ id: "t-abc", projectName: "P1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] })];
      const [section] = buildWeeklySections(tasks, new Map([["u-철수", 1]]));
      expect(section.assigneeGroups[0].groups[0].tasks[0].taskId).toBe("t-abc");
    });

    it("복수 담당자 Task는 assigneeUserIds 배열에 모든 담당자의 id가 담긴다", () => {
      const tasks = [
        task({ id: "t1", projectName: "P1", assigneeNames: ["철수", "영희"], assigneeUserIds: ["u-철수", "u-영희"] }),
      ];
      const sortKeys = new Map([
        ["u-철수", 1],
        ["u-영희", 2],
      ]);
      const [section] = buildWeeklySections(tasks, sortKeys);
      // 담당자별로 중복 표시되는 각 그룹에서도 이 Task 행의 assigneeUserIds는
      // 항상 전체 목록 그대로다(assignees와 동일한 원칙).
      expect(section.assigneeGroups[0].groups[0].tasks[0].assigneeUserIds).toEqual(["u-철수", "u-영희"]);
      expect(section.assigneeGroups[1].groups[0].tasks[0].assigneeUserIds).toEqual(["u-철수", "u-영희"]);
    });

    it("REGULAR_PROJECT/COMMON/EXCEPTION은 taskLayout=SHARED, attachMetadata=true다", () => {
      const sections = buildWeeklySections([], new Map());
      const byKey = new Map(sections.map((s) => [s.section, s]));
      expect(byKey.get("REGULAR_PROJECT")).toMatchObject({ taskLayout: "SHARED", attachMetadata: true });
      expect(byKey.get("COMMON")).toMatchObject({ taskLayout: "SHARED", attachMetadata: true });
      expect(byKey.get("EXCEPTION")).toMatchObject({ taskLayout: "SHARED", attachMetadata: true });
    });

    it("SUB_PROJECT는 taskLayout=PER_TASK, attachMetadata=true다(goalName groupKey는 유지)", () => {
      const sections = buildWeeklySections([], new Map());
      const sub = sections.find((s) => s.section === "SUB_PROJECT")!;
      expect(sub).toMatchObject({ taskLayout: "PER_TASK", attachMetadata: true });

      const tasks = [
        task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
        task({ id: "t2", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
      ];
      const [subSection] = buildWeeklySections(tasks, new Map([["u-철수", 1]])).filter((s) => s.section === "SUB_PROJECT");
      // groupKey는 그대로 goalName 기준 — 여러 Task가 같은 group.title 아래
      // 하나의 SectionGroup으로 묶인다(goalName은 상위 시각적 그룹으로 유지,
      // Task별 분리는 injectDocument.ts의 taskLayout 분기가 담당).
      expect(subSection.assigneeGroups[0].groups).toHaveLength(1);
      expect(subSection.assigneeGroups[0].groups[0].title).toBe("AI AX 프로젝트");
      expect(subSection.assigneeGroups[0].groups[0].tasks.map((t) => t.taskId)).toEqual(["t1", "t2"]);
    });

    it("BUSINESS_TRIP은 attachMetadata=false다(이번 필터 대상 아님, 구조 변경 없음)", () => {
      const sections = buildWeeklySections([], new Map());
      const trip = sections.find((s) => s.section === "BUSINESS_TRIP")!;
      expect(trip.attachMetadata).toBe(false);
      expect(trip.taskLayout).toBe("SHARED");
    });
  });

  // Step(담당자 View Filter + 안전한 Block 단위 저장)
  describe("담당자 그룹핑이 이름이 아니라 User.id 기준(동명이인 안전)", () => {
    it("이름이 같아도 id가 다르면 서로 다른 그룹으로 분리된다(동명이인)", () => {
      const tasks = [
        task({ id: "t1", projectName: "P1", assigneeNames: ["철수"], assigneeUserIds: ["u-1"] }),
        task({ id: "t2", projectName: "P2", assigneeNames: ["철수"], assigneeUserIds: ["u-2"] }),
      ];
      const sortKeys = new Map([
        ["u-1", 1],
        ["u-2", 2],
      ]);
      const [section] = buildWeeklySections(tasks, sortKeys);
      expect(section.assigneeGroups.map((g) => g.assigneeUserId)).toEqual(["u-1", "u-2"]);
      expect(section.assigneeGroups).toHaveLength(2); // 이름만 보면 병합될 뻔했지만 id가 달라 분리
    });

    it("assigneeGroups의 assigneeUserId로 select value(필터 key)를 만들 수 있다", () => {
      const tasks = [task({ id: "t1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] })];
      const [section] = buildWeeklySections(tasks, new Map([["u-철수", 1]]));
      expect(section.assigneeGroups[0].assigneeUserId).toBe("u-철수");
    });
  });
});
