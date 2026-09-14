import { describe, expect, it } from "vitest";
import { buildWeeklySections, type WeeklyTaskInfo } from "./build";
import { mergeSectionsIntoDocument } from "./injectDocument";
import { extractWriteTableFieldValues, fieldValuesEqual, listFilterableBlocks, mergeFilteredSave } from "./filteredSave";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(담당자 View Filter + 안전한 Block 단위 저장) — filteredSave.ts는
 * DB/Prisma 없이 순수 JSONContent 세 개(server/base/current)만으로 동작하는
 * 핵심 병합 로직이라, 실제 Server Action(draft.ts)을 거치지 않고도 §17의
 * 시나리오(H/I/J/L/N)를 전부 재현/검증할 수 있다(요청사항 19: "DB 없는 pure
 * merge test 우선").
 */

function task(overrides: Partial<WeeklyTaskInfo>): WeeklyTaskInfo {
  return {
    id: "t1",
    title: "업무",
    meetingReportSection: "SUB_PROJECT",
    projectName: null,
    goalName: "G",
    assigneeNames: [],
    assigneeUserIds: [],
    isCommonAssignee: false,
    startDate: new Date("2026-09-01"),
    dueDate: new Date("2026-09-04"),
    ...overrides,
  };
}

const ALL_SECTIONS = [
  { section: "REGULAR_PROJECT" as const, text: "정규 프로젝트" },
  { section: "SUB_PROJECT" as const, text: "서브 프로젝트" },
  { section: "EXCEPTION" as const, text: "예외 업무" },
  { section: "BUSINESS_TRIP" as const, text: "출장 업무" },
  { section: "COMMON" as const, text: "공통 업무" },
];

function baseDocument(): JSONContent {
  return {
    type: "doc",
    content: ALL_SECTIONS.map((s) => ({
      type: "heading",
      attrs: { level: 2, meetingSection: s.section },
      content: [{ type: "text", text: s.text }],
    })),
  };
}

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(extractText).join("");
  return "";
}

/** 복수 담당자 Task는 담당자마다 자기 섹션 아래 같은 Task의 Block이 문서에
 * 물리적으로 두 번 나타난다("중복 표시" 정책, build.ts) — 실제 merge
 * 함수(mergeFilteredSave)는 이 모든 occurrence를 함께 동기화하므로, 테스트
 * fixture도 "이미 동기화된 상태"를 만들려면 전부(find가 아니라 filter) 값을
 * 맞춰 둬야 한다. */
function setWriteTableValue(doc: JSONContent, taskId: string, fieldKey: string, value: string): JSONContent {
  const cloned = JSON.parse(JSON.stringify(doc)) as JSONContent;
  const content = cloned.content as JSONContent[];
  const blocks = listFilterableBlocks(content).filter((b) => b.taskIds.includes(taskId));
  if (blocks.length === 0) throw new Error(`block for ${taskId} not found`);
  for (const block of blocks) {
    if (!block.writeTable) throw new Error(`block for ${taskId} has no write table`);
    const row = (block.writeTable.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === fieldKey);
    if (!row) throw new Error(`fieldKey ${fieldKey} not found`);
    row.content![1] = { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] };
  }
  return cloned;
}

function getWriteTableValue(doc: JSONContent, taskId: string, fieldKey: string): string {
  const content = doc.content as JSONContent[];
  const block = listFilterableBlocks(content).find((b) => b.taskIds.includes(taskId));
  const row = (block?.writeTable?.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === fieldKey);
  return row ? extractText(row.content![1]) : "";
}

function getAutoTableTitle(doc: JSONContent, taskId: string): string {
  const content = doc.content as JSONContent[];
  const block = listFilterableBlocks(content).find((b) => b.taskIds.includes(taskId));
  const firstDataRow = block?.autoTable.content?.[1];
  return firstDataRow ? extractText(firstDataRow.content![0]) : "";
}

/** Step(복수 담당 Task Filter/Save 안전성 보완) — 여러 occurrence 중 특정
 * 담당자(sectionAssigneeUserId) 구역의 occurrence "딱 하나"만 값을 바꾼다
 * — 다른 occurrence는 그대로 둔다. "server occurrence 1만 바뀜"/"base
 * 단계부터 이미 벌어짐" 같은 시나리오를 만드는 데 쓴다. */
function setWriteTableValueForAssignee(doc: JSONContent, taskId: string, assigneeUserId: string, fieldKey: string, value: string): JSONContent {
  const cloned = JSON.parse(JSON.stringify(doc)) as JSONContent;
  const content = cloned.content as JSONContent[];
  const block = listFilterableBlocks(content).find((b) => b.taskIds.includes(taskId) && b.sectionAssigneeUserId === assigneeUserId);
  if (!block?.writeTable) throw new Error(`occurrence for ${taskId}/${assigneeUserId} not found`);
  const row = (block.writeTable.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === fieldKey);
  if (!row) throw new Error(`fieldKey ${fieldKey} not found`);
  row.content![1] = { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] };
  return cloned;
}

function getWriteTableValueForAssignee(doc: JSONContent, taskId: string, assigneeUserId: string, fieldKey: string): string {
  const content = doc.content as JSONContent[];
  const block = listFilterableBlocks(content).find((b) => b.taskIds.includes(taskId) && b.sectionAssigneeUserId === assigneeUserId);
  const row = (block?.writeTable?.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === fieldKey);
  return row ? extractText(row.content![1]) : "";
}

describe("listFilterableBlocks / extractWriteTableFieldValues — 기본 동작", () => {
  it("PER_TASK Block 하나를 taskIds=[taskId]로 식별하고 작성 Table 값을 뽑는다", () => {
    const tasks = [task({ id: "t1", title: "업무A", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map([["u-박용수", 1]])));
    const blocks = listFilterableBlocks(document.content as JSONContent[]);
    const block = blocks.find((b) => b.taskIds.includes("t1"))!;
    expect(block.section).toBe("SUB_PROJECT");
    expect(block.assigneeUserIds).toEqual(["u-박용수"]);
    const values = extractWriteTableFieldValues(block.writeTable);
    expect(values.DELIVERABLE).toBe("");
  });

  it("fieldValuesEqual은 필드 순서와 무관하게 값 자체만 비교한다", () => {
    const a = { DELIVERABLE: "x", PROGRESS: "", SPECIAL_NOTE: "", DECISION: "", NEXT_SCHEDULE: "" } as Record<string, string>;
    const b = { NEXT_SCHEDULE: "", DECISION: "", SPECIAL_NOTE: "", PROGRESS: "", DELIVERABLE: "x" } as Record<string, string>;
    expect(fieldValuesEqual(a as never, b as never)).toBe(true);
  });
});

describe("mergeFilteredSave — §17 시나리오", () => {
  it("H. 박용수 Task A 수정 + 이지민 Task B 서버 최신 수정 → 박용수 filtered save 시 Task A는 새 내용, Task B는 이지민 최신 내용 유지", () => {
    const tasks = [
      task({ id: "tA", title: "업무A", goalName: "G", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] }),
      task({ id: "tB", title: "업무B", goalName: "G2", assigneeNames: ["이지민"], assigneeUserIds: ["u-이지민"] }),
    ];
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map())).document;

    // 이지민이 Task B를 이미 저장함(서버 최신).
    const server = setWriteTableValue(base, "tB", "PROGRESS", "이지민의 최신 진행 현황");
    // 박용수가 Task A를 로컬에서 편집 중(base 기준).
    const current = setWriteTableValue(base, "tA", "PROGRESS", "박용수가 방금 작성한 진행 현황");

    const { merged, conflictedBlockKeys } = mergeFilteredSave(server, base, current, "u-박용수");
    expect(conflictedBlockKeys).toEqual([]);
    expect(getWriteTableValue(merged, "tA", "PROGRESS")).toBe("박용수가 방금 작성한 진행 현황");
    expect(getWriteTableValue(merged, "tB", "PROGRESS")).toBe("이지민의 최신 진행 현황"); // 절대 되돌리거나 덮지 않는다
  });

  it("I. 같은 Task A를 서버에서도 수정 → filtered save conflict, 서버 최신 내용 overwrite 안 됨", () => {
    const tasks = [task({ id: "tA", title: "업무A", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map())).document;

    const server = setWriteTableValue(base, "tA", "PROGRESS", "다른 사람이 서버에 저장한 내용");
    const current = setWriteTableValue(base, "tA", "PROGRESS", "박용수가 로컬에서 작성한 내용");

    const { merged, conflictedBlockKeys } = mergeFilteredSave(server, base, current, "u-박용수");
    expect(conflictedBlockKeys.length).toBe(1);
    expect(getWriteTableValue(merged, "tA", "PROGRESS")).toBe("다른 사람이 서버에 저장한 내용"); // overwrite 안 됨
  });

  it("J. 복수 담당 Task(박용수+이지민 공동) 동일 Block을 서로 다른 시점에 저장 → 두 번째 저장은 conflict", () => {
    const tasks = [
      task({ id: "tShared", title: "공동업무", assigneeNames: ["박용수", "이지민"], assigneeUserIds: ["u-박용수", "u-이지민"] }),
    ];
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map())).document;

    // 1차: 박용수가 저장 성공(server에 반영됨).
    const currentByPark = setWriteTableValue(base, "tShared", "DECISION", "박용수가 적은 결정 내용");
    const afterParkSave = mergeFilteredSave(base, base, currentByPark, "u-박용수");
    expect(afterParkSave.conflictedBlockKeys).toEqual([]);
    const serverAfterPark = afterParkSave.merged;

    // 2차: 이지민이 "base"(박용수 저장 전 상태)를 그대로 들고 있다가 저장 시도 → conflict.
    const currentByLee = setWriteTableValue(base, "tShared", "DECISION", "이지민이 적은 결정 내용");
    const { merged, conflictedBlockKeys } = mergeFilteredSave(serverAfterPark, base, currentByLee, "u-이지민");
    expect(conflictedBlockKeys.length).toBe(1);
    expect(getWriteTableValue(merged, "tShared", "DECISION")).toBe("박용수가 적은 결정 내용"); // 이지민의 값으로 덮이지 않음
  });

  it("L. AUTO Table이 서버에서 최신화(제목 변경)되고 client는 작성 Table만 로컬 수정 → AUTO는 서버 최신값 유지, 작성값만 병합", () => {
    const tasksOld = [task({ id: "t1", title: "옛 업무명", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasksOld, new Map())).document;

    // 서버는 "일정 불러오기"로 AUTO Table(업무명)이 최신화됨.
    const tasksNew = [task({ id: "t1", title: "새 업무명", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const server = mergeSectionsIntoDocument(base, buildWeeklySections(tasksNew, new Map())).document;

    // client는 그 사실을 모른 채(base 기준) 작성 Table만 로컬에서 수정.
    const current = setWriteTableValue(base, "t1", "SPECIAL_NOTE", "박용수의 특이 사항 메모");

    const { merged, conflictedBlockKeys } = mergeFilteredSave(server, base, current, "u-박용수");
    expect(conflictedBlockKeys).toEqual([]);
    expect(getAutoTableTitle(merged, "t1")).toBe("새 업무명"); // AUTO는 서버 최신 유지
    expect(getWriteTableValue(merged, "t1", "SPECIAL_NOTE")).toBe("박용수의 특이 사항 메모"); // 작성값은 병합
  });

  it("N. sourceTaskIds가 여러 개인 SHARED Block(REGULAR_PROJECT)도 안정적으로 식별/저장된다", () => {
    const tasks = [
      task({ id: "r1", meetingReportSection: "REGULAR_PROJECT", projectName: "P", title: "업무A", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] }),
      task({ id: "r2", meetingReportSection: "REGULAR_PROJECT", projectName: "P", title: "업무B", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] }),
    ];
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map())).document;
    const blocks = listFilterableBlocks(base.content as JSONContent[]);
    const sharedBlock = blocks.find((b) => b.section === "REGULAR_PROJECT")!;
    expect(sharedBlock.taskIds.sort()).toEqual(["r1", "r2"]);

    const current = setWriteTableValue(base, "r1", "DECISION", "정규 프로젝트 결정 내용");
    const { merged, conflictedBlockKeys } = mergeFilteredSave(base, base, current, "u-박용수");
    expect(conflictedBlockKeys).toEqual([]);
    expect(getWriteTableValue(merged, "r1", "DECISION")).toBe("정규 프로젝트 결정 내용");
  });

  it("필터 대상이 아닌 담당자의 Block은 건드리지 않는다(다른 사람 선택 시 이 Block 무시)", () => {
    const tasks = [
      task({ id: "tA", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] }),
      task({ id: "tB", goalName: "G2", assigneeNames: ["이지민"], assigneeUserIds: ["u-이지민"] }),
    ];
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map())).document;
    // client가 실수로/UI 버그로 이지민 Block도 로컬에서 바꿨다고 가정해도,
    // selectedUserId="박용수"로 저장하면 이지민 Block(tB)은 절대 반영되지 않는다.
    const current = setWriteTableValue(setWriteTableValue(base, "tA", "DECISION", "박용수 결정"), "tB", "DECISION", "잘못 섞여 들어온 값");
    const { merged } = mergeFilteredSave(base, base, current, "u-박용수");
    expect(getWriteTableValue(merged, "tA", "DECISION")).toBe("박용수 결정");
    expect(getWriteTableValue(merged, "tB", "DECISION")).toBe(""); // 이지민 Block은 그대로
  });

  it("legacy Block(sourceTaskIds 없음)은 필터 매칭 대상이 아니라 절대 건드리지 않는다", () => {
    const legacyDoc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, meetingSection: "SUB_PROJECT" }, content: [{ type: "text", text: "서브 프로젝트" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "레거시 프로젝트" }] },
        { type: "table", attrs: { tableRole: "auto" }, content: [] }, // sourceTaskIds 없음
        { type: "paragraph" },
        {
          type: "table",
          content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { fieldKey: "DECISION" }, content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "레거시 값" }] }] }] }],
        },
      ],
    };
    const blocks = listFilterableBlocks(legacyDoc.content as JSONContent[]);
    expect(blocks[0].taskIds).toEqual([]);
    expect(blocks[0].assigneeUserIds).toEqual([]);

    const { merged, conflictedBlockKeys } = mergeFilteredSave(legacyDoc, legacyDoc, legacyDoc, "u-누구든");
    expect(conflictedBlockKeys).toEqual([]);
    // 문서가 그대로 clone만 됐는지 확인 — 레거시 값이 그대로 남아 있어야 한다.
    const table = (merged.content as JSONContent[])[4];
    expect(extractText(table.content![0].content![1])).toBe("레거시 값");
  });
});

/**
 * Step(복수 담당 Task Filter/Save 안전성 보완) — §11 A~L. 공동담당(복수
 * 담당자) Task는 문서에 occurrence가 물리적으로 여러 번 나타난다(§1로 실제
 * fixture에서 재확인 완료). "첫 occurrence만 보고 통과" 버그를 막는 것이
 * 핵심 — 특히 H(두 번째 occurrence만 바뀐 경우)가 실제로 conflict로
 * 잡히는지가 이 보완의 존재 이유다.
 */
describe("mergeFilteredSave — 복수 담당 Task의 occurrence-aware conflict/동기화(§11)", () => {
  function sharedTask(overrides: Partial<WeeklyTaskInfo> = {}): WeeklyTaskInfo[] {
    return [
      task({
        id: "tShared",
        title: "공동업무",
        goalName: "공동 프로젝트",
        assigneeNames: ["박용수", "이지민"],
        assigneeUserIds: ["u-박용수", "u-이지민"],
        ...overrides,
      }),
    ];
  }

  it("F. USER_A(박용수) occurrence 편집 후 save → 동일 sourceTaskIds의 서버 occurrence 모두 같은 값으로 갱신된다", () => {
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(sharedTask(), new Map())).document;
    const current = setWriteTableValueForAssignee(base, "tShared", "u-박용수", "DECISION", "박용수가 작성한 결정 내용");

    const { merged, conflictedBlockKeys } = mergeFilteredSave(base, base, current, "u-박용수");
    expect(conflictedBlockKeys).toEqual([]);
    // 박용수 구역, 이지민 구역 양쪽 occurrence 모두 같은 값으로 갱신돼야 한다
    // (공동업무 사본들이 서로 다른 내용으로 갈라지지 않게, 요청사항 8).
    expect(getWriteTableValueForAssignee(merged, "tShared", "u-박용수", "DECISION")).toBe("박용수가 작성한 결정 내용");
    expect(getWriteTableValueForAssignee(merged, "tShared", "u-이지민", "DECISION")).toBe("박용수가 작성한 결정 내용");
  });

  it("G. server occurrence 1(박용수 구역)만 변경 → conflict", () => {
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(sharedTask(), new Map())).document;
    // 서버에서 박용수 구역 occurrence(occurrence 1)만 이미 바뀜.
    const server = setWriteTableValueForAssignee(base, "tShared", "u-박용수", "PROGRESS", "서버에서 이미 바뀐 값(occurrence 1)");
    const current = setWriteTableValueForAssignee(base, "tShared", "u-박용수", "PROGRESS", "박용수가 로컬에서 쓰려는 값");

    const { conflictedBlockKeys } = mergeFilteredSave(server, base, current, "u-박용수");
    expect(conflictedBlockKeys.length).toBe(1);
  });

  it("H(핵심). server occurrence 2(이지민 구역)만 변경 → 첫 occurrence(박용수 구역)는 그대로여도 conflict여야 한다", () => {
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(sharedTask(), new Map())).document;
    // occurrence 1(박용수 구역)은 base와 동일하게 그대로 둔다.
    // occurrence 2(이지민 구역)만 서버에서 이미 바뀌었다 — "첫 occurrence만
    // 비교"하는 버그가 있다면 이 케이스를 conflict로 잡지 못한다.
    const server = setWriteTableValueForAssignee(base, "tShared", "u-이지민", "PROGRESS", "이지민 구역만 서버에서 바뀜(occurrence 2)");
    const current = setWriteTableValueForAssignee(base, "tShared", "u-박용수", "PROGRESS", "박용수가 로컬에서 쓰려는 값");

    const { merged, conflictedBlockKeys } = mergeFilteredSave(server, base, current, "u-박용수");
    expect(conflictedBlockKeys.length).toBe(1); // 반드시 conflict
    // 박용수의 값으로 덮이지 않아야 한다(server 값 그대로 유지).
    expect(getWriteTableValueForAssignee(merged, "tShared", "u-박용수", "PROGRESS")).not.toBe("박용수가 로컬에서 쓰려는 값");
  });

  it("I. base 단계부터 duplicate occurrence 내용이 서로 다름 → conflict(임의 정답 추정 금지)", () => {
    const initial = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(sharedTask(), new Map())).document;
    // base 자체가 이미 두 occurrence 내용이 다른 상태로 시작한다(예: 과거
    // 어떤 경로로든 이미 벌어져 있었다고 가정) — 어느 쪽도 정답이라고
    // 추정하지 않는다.
    const inconsistentBase = setWriteTableValueForAssignee(initial, "tShared", "u-이지민", "DECISION", "이지민 쪽에만 있던 값");

    const current = setWriteTableValueForAssignee(inconsistentBase, "tShared", "u-박용수", "DECISION", "박용수가 새로 쓰려는 값");

    const { conflictedBlockKeys } = mergeFilteredSave(inconsistentBase, inconsistentBase, current, "u-박용수");
    expect(conflictedBlockKeys.length).toBe(1);
  });

  it("J. server 단계에서 duplicate occurrence 내용이 서로 다름 → conflict", () => {
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(sharedTask(), new Map())).document;
    // server 쪽에서 두 occurrence가 서로 다른 값을 갖게 됐다(정상적인 흐름
    //에서는 발생하지 않아야 하지만, 방어적으로 감지해야 한다).
    const inconsistentServer = setWriteTableValueForAssignee(base, "tShared", "u-이지민", "SPECIAL_NOTE", "이지민 구역에만 생긴 값");
    const current = setWriteTableValueForAssignee(base, "tShared", "u-박용수", "SPECIAL_NOTE", "박용수가 쓰려는 값");

    const { conflictedBlockKeys } = mergeFilteredSave(inconsistentServer, base, current, "u-박용수");
    expect(conflictedBlockKeys.length).toBe(1);
  });

  it("K. 공동업무에서도 AUTO Table은 여전히 서버 최신값이 보존된다", () => {
    const base = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(sharedTask({ title: "옛 업무명" }), new Map())).document;
    const server = mergeSectionsIntoDocument(base, buildWeeklySections(sharedTask({ title: "새 업무명" }), new Map())).document;
    const current = setWriteTableValueForAssignee(base, "tShared", "u-박용수", "NEXT_SCHEDULE", "박용수의 향후 일정");

    const { merged, conflictedBlockKeys } = mergeFilteredSave(server, base, current, "u-박용수");
    expect(conflictedBlockKeys).toEqual([]);
    expect(getAutoTableTitle(merged, "tShared")).toBe("새 업무명");
    expect(getWriteTableValueForAssignee(merged, "tShared", "u-박용수", "NEXT_SCHEDULE")).toBe("박용수의 향후 일정");
  });
});
