import { describe, expect, it } from "vitest";
import { buildWeeklySections, type WeeklyTaskInfo } from "./build";
import { hasStableAssigneeHeaderMetadata, isAssigneeHeaderParagraph, listAssigneeFilterOptions, mergeSectionsIntoDocument } from "./injectDocument";
import { resolveHeadingSection } from "./sectionHeadings";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — injectDocument.ts에는
 * 이전까지 전용 단위 테스트가 없었다(build.ts의 순수 그룹핑 로직만
 * 테스트됐고, 실제 Tiptap block 생성/재클릭 병합은 검증되지 않았다). 이번
 * Step이 SUB_PROJECT 구조 자체를 바꾸고 sourceTaskId 기반 재클릭 병합을
 * 새로 추가하므로, 여기서부터 실제 documentContent 왕복(merge)까지 포함해
 * 검증한다 — DB/Prisma 없이 순수 함수만 사용한다(요청사항: "pure document
 * test 우선").
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

/** 실제 Template/Draft 골격을 최소한으로 흉내낸다 — 5개 섹션의 top-level
 * heading(H2, attrs.meetingSection)만 있고 그 아래 내용은 없는 "방금 초기화된
 * 회의록"과 동일한 모양이다. */
function baseDocument(sections: { section: WeeklyTaskInfo["meetingReportSection"]; text: string }[]): JSONContent {
  return {
    type: "doc",
    content: sections.map((s) => ({
      type: "heading",
      attrs: { level: 2, meetingSection: s.section },
      content: [{ type: "text", text: s.text }],
    })),
  };
}

const ALL_SECTIONS = [
  { section: "REGULAR_PROJECT" as const, text: "정규 프로젝트" },
  { section: "SUB_PROJECT" as const, text: "서브 프로젝트" },
  { section: "EXCEPTION" as const, text: "예외 업무" },
  { section: "BUSINESS_TRIP" as const, text: "출장 업무" },
  { section: "COMMON" as const, text: "공통 업무" },
];

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(extractText).join("");
  return "";
}

/** doc.content에서 특정 meetingSection의 top heading 바로 다음부터 다음
 * heading(level!==3) 전까지를 잘라낸다 — 테스트에서 "그 섹션 body만" 보고
 * 싶을 때 쓴다. */
function sectionBody(doc: JSONContent, section: string): JSONContent[] {
  const content = doc.content ?? [];
  // resolveHeadingSection과 동일하게 attrs.meetingSection 우선, 없으면 텍스트
  // fallback으로 판별한다 — legacy(attrs 없는) 문서 테스트(G)에서도 실제
  // 운영 코드(mergeSectionsIntoDocument)가 찾는 것과 동일한 기준으로 검증한다.
  const startIdx = content.findIndex((n) => n.type === "heading" && resolveHeadingSection(n) === section);
  expect(startIdx).toBeGreaterThanOrEqual(0);
  let endIdx = content.length;
  for (let i = startIdx + 1; i < content.length; i++) {
    if (content[i].type === "heading" && content[i].attrs?.level !== 3) {
      endIdx = i;
      break;
    }
  }
  return content.slice(startIdx + 1, endIdx);
}

function findTables(nodes: JSONContent[]): JSONContent[] {
  return nodes.filter((n) => n.type === "table");
}

function findAutoTables(nodes: JSONContent[]): JSONContent[] {
  return findTables(nodes).filter((t) => t.attrs?.tableRole === "auto");
}

function findGroupHeadings(nodes: JSONContent[]): JSONContent[] {
  return nodes.filter((n) => n.type === "heading" && n.attrs?.level === 3);
}

/** 작성(구분|내용) Table의 특정 fieldKey 행 값 셀 텍스트를 직접 채워 넣는다
 * — "기존 작성 내용이 있는 문서"를 시뮬레이션할 때 쓴다. */
function setWriteTableValue(writeTable: JSONContent, fieldKey: string, value: string): void {
  const row = (writeTable.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === fieldKey);
  if (!row) throw new Error(`fieldKey ${fieldKey} row not found`);
  row.content![1] = { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] };
}

describe("mergeSectionsIntoDocument — SUB_PROJECT 업무별 독립 Block + Stable metadata", () => {
  it("A. SUB goalName 하나 + Task 3개 → goalName heading 1개 유지, Task별 독립 작성 Table 3개", () => {
    const tasks = [
      task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무A", assigneeNames: ["철수"], assigneeUserIds: ["u1"] }),
      task({ id: "t2", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무B", assigneeNames: ["철수"], assigneeUserIds: ["u1"] }),
      task({ id: "t3", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무C", assigneeNames: ["철수"], assigneeUserIds: ["u1"] }),
    ];
    const sections = buildWeeklySections(tasks, new Map([["철수", 1]]));
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), sections);
    const body = sectionBody(document, "SUB_PROJECT");

    const groupHeadings = findGroupHeadings(body);
    expect(groupHeadings).toHaveLength(1);
    expect(extractText(groupHeadings[0])).toBe("AI AX 프로젝트");
    expect(groupHeadings[0].attrs?.blockRole).toBe("PROJECT_GROUP");

    const autoTables = findAutoTables(body);
    expect(autoTables).toHaveLength(3); // Task별 독립 AUTO Table 3개(공유 X)
    const writeTables = findTables(body).filter((t) => t.attrs?.tableRole !== "auto");
    expect(writeTables).toHaveLength(3); // Task별 독립 작성 Table 3개
  });

  it("B. 각 Task의 AUTO Table은 서로 다른 sourceTaskId를 갖는다", () => {
    const tasks = [
      task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "G", title: "A" }),
      task({ id: "t2", meetingReportSection: "SUB_PROJECT", goalName: "G", title: "B" }),
    ];
    const sections = buildWeeklySections(tasks, new Map());
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), sections);
    const autoTables = findAutoTables(sectionBody(document, "SUB_PROJECT"));
    expect(autoTables.map((t) => t.attrs?.sourceTaskId)).toEqual(["t1", "t2"]);
  });

  it("C. 복수 담당자 Task → AUTO Table의 assigneeUserIds 배열에 모두 존재한다", () => {
    const tasks = [
      task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "G", assigneeNames: ["철수", "영희"], assigneeUserIds: ["u-철수", "u-영희"] }),
    ];
    const sections = buildWeeklySections(
      tasks,
      new Map([
        ["철수", 1],
        ["영희", 2],
      ]),
    );
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), sections);
    // 담당자별로 중복 표시되는 두 그룹(철수/영희) 모두에서 이 Task의
    // assigneeUserIds는 항상 전체 목록 그대로다(그룹 소속이 목록을 자르지 않는다).
    const allAuto = findTablesAcrossDoc(document).filter((t) => t.attrs?.tableRole === "auto" && t.attrs?.sourceTaskId === "t1");
    expect(allAuto.length).toBe(2);
    for (const t of allAuto) expect(t.attrs?.assigneeUserIds).toEqual(["u-철수", "u-영희"]);
  });

  it("D/E/F. REGULAR_PROJECT/COMMON/EXCEPTION Task에도 sourceTaskId/assigneeUserIds/meetingSection이 생성된다(구조는 SHARED 그대로)", () => {
    const tasks = [
      task({ id: "r1", meetingReportSection: "REGULAR_PROJECT", projectName: "P", assigneeUserIds: ["u1"] }),
      task({ id: "c1", meetingReportSection: "COMMON", title: "공통업무", assigneeUserIds: ["u1"] }),
      task({ id: "e1", meetingReportSection: "EXCEPTION", title: "예외업무", assigneeUserIds: ["u1"] }),
    ];
    const sections = buildWeeklySections(tasks, new Map());
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), sections);

    const regularAuto = findAutoTables(sectionBody(document, "REGULAR_PROJECT"));
    expect(regularAuto).toHaveLength(1);
    expect(regularAuto[0].attrs).toMatchObject({ sourceTaskId: "r1", assigneeUserIds: ["u1"], meetingSection: "REGULAR_PROJECT" });

    const commonAuto = findAutoTables(sectionBody(document, "COMMON"));
    expect(commonAuto[0].attrs).toMatchObject({ sourceTaskId: "c1", assigneeUserIds: ["u1"], meetingSection: "COMMON" });

    const exceptionAuto = findAutoTables(sectionBody(document, "EXCEPTION"));
    expect(exceptionAuto[0].attrs).toMatchObject({ sourceTaskId: "e1", assigneeUserIds: ["u1"], meetingSection: "EXCEPTION" });

    // BUSINESS_TRIP은 이번 필터 대상이 아니므로 메타데이터를 붙이지 않는다(요청사항 7).
    const tripTasks = [task({ id: "b1", meetingReportSection: "BUSINESS_TRIP", title: "출장업무" })];
    const tripSections = buildWeeklySections(tripTasks, new Map());
    const { document: tripDoc } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), tripSections);
    const tripAuto = findAutoTables(sectionBody(tripDoc, "BUSINESS_TRIP"));
    expect(tripAuto[0].attrs?.sourceTaskId).toBeUndefined();
    expect(tripAuto[0].attrs?.meetingSection).toBeUndefined();
  });

  it("G. 기존 metadata(attrs) 없는 legacy 문서도 정상 merge된다(crash 없음, 기존 fallback 동작)", () => {
    // 레거시 문서: SUB_PROJECT heading에 attrs 자체가 없고(legacy fallback
    // 텍스트 매칭 대상), 이미 프로젝트명 H3 + AUTO(공유) + 작성 Table이 있다.
    const legacyDoc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "정규 프로젝트" }] },
        { type: "heading", content: [{ type: "text", text: "서브 프로젝트" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "레거시 프로젝트" }] },
        { type: "table", attrs: { tableRole: "auto" }, content: [] },
        { type: "paragraph" },
        { type: "table", content: [] },
        { type: "heading", content: [{ type: "text", text: "예외 업무" }] },
        { type: "heading", content: [{ type: "text", text: "출장 업무" }] },
        { type: "heading", content: [{ type: "text", text: "공통 업무" }] },
      ],
    };
    const tasks = [task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "새 프로젝트" })];
    const sections = buildWeeklySections(tasks, new Map());
    expect(() => mergeSectionsIntoDocument(legacyDoc, sections)).not.toThrow();
    const { document } = mergeSectionsIntoDocument(legacyDoc, sections);
    const body = sectionBody(document, "SUB_PROJECT");
    expect(findGroupHeadings(body).map((h) => extractText(h))).toContain("새 프로젝트");
  });

  it("H. 기존 SUB shared block(레거시, Task 여러 건 공유)에 작성 내용이 있으면 새 Task별 Block을 만들면서도 유실 없이 orphan으로 보존한다", () => {
    // 1단계: 레거시 shared 구조(현재 Production 실제 모양)를 직접 구성한다 —
    // sourceTaskId가 없는 "구식" AUTO Table(Task 2건 공유) + 값이 채워진
    // 작성 Table.
    const legacyWriteTable: JSONContent = {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableCell", attrs: { fieldKey: "DELIVERABLE" }, content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { fieldKey: "PROGRESS" }, content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { fieldKey: "SPECIAL_NOTE" }, content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { fieldKey: "DECISION" }, content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { fieldKey: "NEXT_SCHEDULE" }, content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] },
      ],
    };
    setWriteTableValue(legacyWriteTable, "PROGRESS", "지난주에 실제로 작성한 중요한 진행 현황 내용");

    const docWithLegacySharedBlock: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, meetingSection: "REGULAR_PROJECT" }, content: [{ type: "text", text: "정규 프로젝트" }] },
        { type: "heading", attrs: { level: 2, meetingSection: "SUB_PROJECT" }, content: [{ type: "text", text: "서브 프로젝트" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "AI AX 프로젝트" }] },
        { type: "table", attrs: { tableRole: "auto" }, content: [] }, // 레거시: Task 2건 공유, sourceTaskId 없음
        { type: "paragraph" },
        legacyWriteTable,
        { type: "heading", attrs: { level: 2, meetingSection: "EXCEPTION" }, content: [{ type: "text", text: "예외 업무" }] },
        { type: "heading", attrs: { level: 2, meetingSection: "BUSINESS_TRIP" }, content: [{ type: "text", text: "출장 업무" }] },
        { type: "heading", attrs: { level: 2, meetingSection: "COMMON" }, content: [{ type: "text", text: "공통 업무" }] },
      ],
    };

    // 2단계: 같은 goalName("AI AX 프로젝트") 아래 Task 2건으로 재조회한다 —
    // 새 PER_TASK 구조가 적용된다.
    const tasks = [
      task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무A" }),
      task({ id: "t2", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무B" }),
    ];
    const sections = buildWeeklySections(tasks, new Map());
    const { document } = mergeSectionsIntoDocument(docWithLegacySharedBlock, sections);
    const body = sectionBody(document, "SUB_PROJECT");

    // 새 Task별 Block 2개가 생성된다(내용은 비어 있다 — 옛 공유 Table에서
    // 어느 Task 것인지 추정할 수 없으므로 임의 분산하지 않는다, 요청사항 8).
    // 옛 레거시 공유 AUTO Table(sourceTaskId 없음)도 orphan으로 함께 남아
    // 있어야 한다(그래서 undefined 하나가 더 있는 것이 정상 — 아래에서 그
    // orphan 블록의 작성 내용이 실제로 보존됐는지 별도로 확인한다).
    expect(findAutoTables(body).map((t) => t.attrs?.sourceTaskId).filter(Boolean)).toEqual(["t1", "t2"]);
    expect(findAutoTables(body).some((t) => t.attrs?.sourceTaskId === undefined)).toBe(true);

    // 옛 shared block(작성 내용 있음)은 orphan으로 통째로 보존된다 — 유실 0건.
    const preservedProgressText = body
      .flatMap((n) => (n.type === "table" ? [n] : []))
      .map((t) => (t.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === "PROGRESS"))
      .filter(Boolean)
      .map((row) => extractText(row!.content![1]))
      .find((text) => text.includes("지난주에 실제로 작성한"));
    expect(preservedProgressText).toBeDefined();
  });

  it("I. sourceTaskId가 있는 기존 Task는 일정 재불러오기 시 작성 Table 내용이 그대로 유지된다", () => {
    const tasks = [task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "G", title: "업무A" })];
    const sections = buildWeeklySections(tasks, new Map());
    const firstDoc = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), sections).document;

    // 사용자가 작성 Table에 실제로 값을 입력한 상태를 시뮬레이션한다.
    const body1 = sectionBody(firstDoc, "SUB_PROJECT");
    const writeTable1 = findTables(body1).find((t) => t.attrs?.tableRole !== "auto")!;
    setWriteTableValue(writeTable1, "DECISION", "사용자가 직접 작성한 결정 내용");

    // 재조회(같은 sourceTaskId, goalName은 그대로 — 두 번째 클릭 시뮬레이션).
    const { document: secondDoc } = mergeSectionsIntoDocument(firstDoc, sections);
    const body2 = sectionBody(secondDoc, "SUB_PROJECT");
    const writeTable2 = findTables(body2).find((t) => t.attrs?.tableRole !== "auto")!;
    const decisionRow = (writeTable2.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === "DECISION")!;
    expect(extractText(decisionRow.content![1])).toBe("사용자가 직접 작성한 결정 내용");
  });

  it("I-2. sourceTaskId 기반 매칭은 goalName이 바뀌어도(다른 프로젝트로 이동) 작성 내용을 계속 찾는다", () => {
    const tasksBefore = [task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "옛 목표", title: "업무A" })];
    const firstDoc = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasksBefore, new Map())).document;
    const body1 = sectionBody(firstDoc, "SUB_PROJECT");
    const writeTable1 = findTables(body1).find((t) => t.attrs?.tableRole !== "auto")!;
    setWriteTableValue(writeTable1, "DELIVERABLE", "옛 목표 시절 작성 내용");

    // 같은 Task(t1)의 goalName이 "새 목표"로 바뀌었다(Schedule에서 목표 재지정).
    const tasksAfter = [task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "새 목표", title: "업무A" })];
    const { document } = mergeSectionsIntoDocument(firstDoc, buildWeeklySections(tasksAfter, new Map()));
    const body2 = sectionBody(document, "SUB_PROJECT");
    expect(findGroupHeadings(body2).map((h) => extractText(h))).toEqual(["새 목표"]);
    const writeTable2 = findTables(body2).find((t) => t.attrs?.tableRole !== "auto")!;
    const deliverableRow = (writeTable2.content ?? []).find((r) => r.content?.[0]?.attrs?.fieldKey === "DELIVERABLE")!;
    expect(extractText(deliverableRow.content![1])).toBe("옛 목표 시절 작성 내용");
  });

  it("J. 동일 goalName 아래 여러 Task → goalName heading은 1개만, Task별 독립 Block으로만 분리된다(중복 생성 없음)", () => {
    const tasks = [
      task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무A" }),
      task({ id: "t2", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무B" }),
      task({ id: "t3", meetingReportSection: "SUB_PROJECT", goalName: "AI AX 프로젝트", title: "업무C" }),
    ];
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasks, new Map()));
    const body = sectionBody(document, "SUB_PROJECT");
    const headings = findGroupHeadings(body).filter((h) => extractText(h) === "AI AX 프로젝트");
    expect(headings).toHaveLength(1);
    expect(findAutoTables(body)).toHaveLength(3);
  });
});

describe("담당자 View Filter Step 0 보완 — sourceTaskIds / assigneeUserId(👤 문단) / listAssigneeFilterOptions", () => {
  it("PER_TASK Block의 sourceTaskIds는 [taskId] 하나(sourceTaskId 하위호환 값도 유지)", () => {
    const tasks = [task({ id: "t1", meetingReportSection: "SUB_PROJECT", goalName: "G" })];
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasks, new Map()));
    const autoTable = findAutoTables(sectionBody(document, "SUB_PROJECT"))[0];
    expect(autoTable.attrs?.sourceTaskIds).toEqual(["t1"]);
    expect(autoTable.attrs?.sourceTaskId).toBe("t1"); // 하위 호환
  });

  it("SHARED Block(REGULAR_PROJECT, Task 2건 공유)의 sourceTaskIds는 포함된 모든 Task.id를 중복 없이 순서대로 담는다", () => {
    const tasks = [
      task({ id: "t1", meetingReportSection: "REGULAR_PROJECT", projectName: "P1", title: "업무A" }),
      task({ id: "t2", meetingReportSection: "REGULAR_PROJECT", projectName: "P1", title: "업무B" }),
    ];
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasks, new Map()));
    const autoTable = findAutoTables(sectionBody(document, "REGULAR_PROJECT"))[0];
    expect(autoTable.attrs?.sourceTaskIds).toEqual(["t1", "t2"]);
    // Task가 2건이라 "어느 한 Task"로 특정 못하므로 단수 sourceTaskId는 비운다(기존 정책 유지).
    expect(autoTable.attrs?.sourceTaskId).toBeUndefined();
  });

  it("BUSINESS_TRIP은 attachMetadata=false라 sourceTaskIds도 붙지 않는다", () => {
    const tasks = [task({ id: "t1", meetingReportSection: "BUSINESS_TRIP", title: "출장" })];
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasks, new Map()));
    const autoTable = findAutoTables(sectionBody(document, "BUSINESS_TRIP"))[0];
    expect(autoTable.attrs?.sourceTaskIds).toBeUndefined();
  });

  it("👤 담당자 문단은 assigneeUserId를 attrs로 갖는다(공통/미지정은 null)", () => {
    const tasks = [
      task({ id: "t1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
      task({ id: "t2", isCommonAssignee: true }),
      task({ id: "t3" }), // 담당자 미지정
    ];
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasks, new Map([["u-철수", 1]])));
    const body = sectionBody(document, "REGULAR_PROJECT");
    const headerParagraphs = body.filter((n) => n.type === "paragraph" && extractText(n).startsWith("👤 "));
    const byLabel = new Map(headerParagraphs.map((p) => [extractText(p), p.attrs?.assigneeUserId]));
    expect(byLabel.get("👤 철수 · 1건")).toBe("u-철수");
    expect(byLabel.get("👤 공통 · 1건")).toBeNull();
    expect(byLabel.get("👤 담당자 미지정 · 1건")).toBeNull();
  });

  it("listAssigneeFilterOptions는 문서 전체(모든 섹션)에서 실제 등장하는 담당자만 {id,name}으로 dedup해 뽑는다(하드코딩 없음)", () => {
    const tasks = [
      task({ id: "t1", meetingReportSection: "REGULAR_PROJECT", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
      task({ id: "t2", meetingReportSection: "SUB_PROJECT", goalName: "G", assigneeNames: ["영희"], assigneeUserIds: ["u-영희"] }),
      // 철수가 두 번째 섹션에도 등장 — dedup 확인.
      task({ id: "t3", meetingReportSection: "COMMON", title: "공통업무X", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] }),
      task({ id: "t4", meetingReportSection: "EXCEPTION", title: "미배정업무", isCommonAssignee: false }),
    ];
    const sortKeys = new Map([
      ["u-철수", 1],
      ["u-영희", 2],
    ]);
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasks, sortKeys));
    const options = listAssigneeFilterOptions(document);
    expect(options).toEqual([
      { id: "u-철수", name: "철수" },
      { id: "u-영희", name: "영희" },
    ]);
    // "담당자 미지정" 문단이 존재하더라도(t4) 그건 옵션에 안 들어간다.
    expect(options.some((o) => o.name.includes("미지정"))).toBe(false);
  });
});

/**
 * Step(Assignee Header Stable Metadata) — 담당자 header 판별을 "👤 " 텍스트
 * 접두사가 아니라 명시적 attrs.blockRole="ASSIGNEE_HEADER"로 바꿨다(요청사항
 * 1/2). 신규로 생성된 문서는 실제로 이 attrs를 갖는지(A), 그 attrs가 없는
 * 일반 문단은 절대 header로 오인되지 않는지(B), 이미 신규 구조인 문서
 * context에서는 우연히 같은 문구로 시작하는 일반 문단도 절대 header로
 * 오인되지 않는지(C, 요청사항 3의 핵심 — legacy fallback은 "문서 전체에
 * metadata가 전혀 없을 때만" 허용), legacy(metadata 없는) 문서는 여전히
 * 기존 "👤 이름" 문단을 header로 정상 인식하는지(D)를 직접 검증한다.
 */
describe("Assignee Header 판별 안정화 — blockRole 우선 + legacy fallback(Step 3B A~D)", () => {
  it("A. 신규 생성 문서의 담당자 header 문단은 blockRole=ASSIGNEE_HEADER를 실제로 갖는다", () => {
    const tasks = [task({ id: "t1", assigneeNames: ["철수"], assigneeUserIds: ["u-철수"] })];
    const { document } = mergeSectionsIntoDocument(baseDocument(ALL_SECTIONS), buildWeeklySections(tasks, new Map([["u-철수", 1]])));
    const body = sectionBody(document, "REGULAR_PROJECT");
    const header = body.find((n) => n.type === "paragraph" && extractText(n).startsWith("👤 "));
    expect(header?.attrs?.blockRole).toBe("ASSIGNEE_HEADER");
    // 신규 문서 전체를 기준으로도 "stable metadata가 있다"고 판정돼야 한다.
    expect(hasStableAssigneeHeaderMetadata(document.content ?? [])).toBe(true);
    expect(isAssigneeHeaderParagraph(header!, false)).toBe(true); // legacyFallbackAllowed=false여도 blockRole만으로 판정된다.
  });

  it("B. blockRole/assigneeUserId 없는(또는 기본값 null인) 일반 문단은 legacyFallbackAllowed 여부와 무관하게 header로 오인되지 않는다", () => {
    const plain: JSONContent = { type: "paragraph", content: [{ type: "text", text: "그냥 문단입니다" }] };
    const emptySpacer: JSONContent = { type: "paragraph" };
    expect(isAssigneeHeaderParagraph(plain, true)).toBe(false);
    expect(isAssigneeHeaderParagraph(plain, false)).toBe(false);
    expect(isAssigneeHeaderParagraph(emptySpacer, true)).toBe(false);
    expect(isAssigneeHeaderParagraph(emptySpacer, false)).toBe(false);
  });

  it("C. 일반 paragraph text가 우연히 '👤 테스트'여도, metadata가 명시된 신규 문서 context(legacyFallbackAllowed=false)에서는 header로 판정되지 않는다", () => {
    const coincidental: JSONContent = { type: "paragraph", content: [{ type: "text", text: "👤 테스트 관련 메모" }] };
    // legacyFallbackAllowed=false — 이미 이 문서에 실제 ASSIGNEE_HEADER metadata가
    // 있어(hasStableAssigneeHeaderMetadata=true) 텍스트 fallback을 쓰지 않는 상황.
    expect(isAssigneeHeaderParagraph(coincidental, false)).toBe(false);
    // legacyFallbackAllowed=true(순수 legacy 문서)였다면 반대로 인식돼야 정상 —
    // 즉 이 결과는 "텍스트만으로는 절대 판정 안 함"이 아니라 "우선순위/조건부"임을 보인다.
    expect(isAssigneeHeaderParagraph(coincidental, true)).toBe(true);
  });

  it("D. legacy 문서(ASSIGNEE_HEADER metadata가 전혀 없는, blockRole 없이 '👤 이름' 텍스트만 있는 옛 구조)의 기존 header는 fallback으로 정상 인식된다", () => {
    const legacyHeader: JSONContent = {
      type: "paragraph",
      attrs: { assigneeUserId: "u-철수" }, // blockRole 없음 — 이번 Step 이전 구조
      content: [{ type: "text", text: "👤 철수 · 2건" }],
    };
    const legacyDoc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, meetingSection: "REGULAR_PROJECT" }, content: [{ type: "text", text: "정규 프로젝트" }] },
        legacyHeader,
      ],
    };
    // 문서 전체에 ASSIGNEE_HEADER metadata가 하나도 없다 — legacy 문서로 판정된다.
    expect(hasStableAssigneeHeaderMetadata(legacyDoc.content ?? [])).toBe(false);
    expect(isAssigneeHeaderParagraph(legacyHeader, true)).toBe(true);

    // listAssigneeFilterOptions도 이 legacy 문서에서 fallback으로 정상 옵션을 뽑는다.
    const options = listAssigneeFilterOptions(legacyDoc);
    expect(options).toEqual([{ id: "u-철수", name: "철수" }]);
  });
});

function findTablesAcrossDoc(doc: JSONContent): JSONContent[] {
  return (doc.content ?? []).filter((n) => n.type === "table");
}
