import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { computeAssigneeFilterDecorations, MeetingSectionAttribute, TableRoleAttribute, TaskBlockMetadataAttribute } from "./TemplateRichTextEditor";
import { buildWeeklySections, type WeeklyTaskInfo } from "@/lib/meetingMinutes/build";
import { mergeSectionsIntoDocument } from "@/lib/meetingMinutes/injectDocument";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(담당자 View Filter + 안전한 Block 단위 저장) — computeAssigneeFilterDecorations는
 * 실제 라이브 Editor의 Decoration 계산에 쓰이는 바로 그 함수다. 이 프로젝트의
 * vitest는 environment:"node"(jsdom 없음, vitest.config.ts 참고)라 실제
 * Editor를 mount하는 대신, @tiptap/core의 getSchema + ProseMirror
 * Node.fromJSON으로 "진짜" ProseMirror 문서를 만들어(DOM 불필요 — ProseMirror
 * model/Decoration 둘 다 DOM 의존성이 없다) 이 함수를 직접 호출/검증한다.
 * documentContent 자체는 build.ts/injectDocument.ts(이미 pure 테스트로 검증됨)
 * 가 실제로 만드는 모양 그대로 재사용해, "진짜와 다른 가짜 fixture라 테스트가
 * 무의미하다"는 위험을 없앤다.
 */

const schema = getSchema([
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  TableKit.configure({ table: { resizable: false } }),
  TextStyle,
  Color,
  FontSize,
  MeetingSectionAttribute,
  TaskBlockMetadataAttribute,
  TableRoleAttribute,
] as never);

function toPMDoc(json: JSONContent): PMNode {
  return PMNode.fromJSON(schema, json);
}

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

/** doc.content top-level 노드 중, decorations가 이 위치(pos)를 hidden 처리했는지.
 * 주의: DecorationSet.find(start,end)는 `span.from <= end && span.to >= start`
 * 조건으로 겹침을 판정한다 — 즉 경계가 정확히 맞닿은("hidden 노드 바로 뒤에
 * visible 노드가 오는") 경우, 그 hidden 노드의 decoration(to === 다음 노드의
 * pos)이 find(pos, pos+1) 쿼리와도 "겹치는" 것으로 잘못 매치된다(양끝
 * inclusive라 인접 decoration까지 걸림). 그래서 겹침이 아니라 "이 노드 자신의
 * decoration인가"(from === pos, Decoration.node(pos, ...)는 항상 자기 pos에서
 * 시작하므로)로 정확히 판별해야 한다. */
function isHiddenAt(doc: PMNode, pos: number, decorations: ReturnType<typeof computeAssigneeFilterDecorations>): boolean {
  const found = decorations.find(pos, pos + 1);
  // Decoration.node(from, to, attrs)의 attrs(class 등 실제 DOM에 적용되는 값)는
  // 공개 API상 decoration.type.attrs로 읽힌다(.spec은 별도의 4번째 인자용 —
  // 여기서는 안 넘겼으므로 항상 {}).
  return found.some(
    (d) =>
      (d as unknown as { from: number }).from === pos &&
      (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class === "am-filter-hidden",
  );
}

/** 특정 텍스트를 담은 top-level heading의 pos를 찾는다(간단한 헬퍼 — 실제
 * 판정은 위치 기반 Decoration이라 pos가 필요하다). */
function findChildPosByText(doc: PMNode, text: string): number | null {
  let found: number | null = null;
  doc.forEach((node, pos) => {
    if (found !== null) return;
    if (node.textContent.includes(text)) found = pos;
  });
  return found;
}

function findAutoTablePosBySourceTaskId(doc: PMNode, taskId: string): number | null {
  let found: number | null = null;
  doc.forEach((node, pos) => {
    if (found !== null) return;
    if (node.type.name !== "table" || node.attrs.tableRole !== "auto") return;
    const ids: string[] = Array.isArray(node.attrs.sourceTaskIds) ? node.attrs.sourceTaskIds : [];
    if (ids.includes(taskId)) found = pos;
  });
  return found;
}

function findAllChildPosByText(doc: PMNode, text: string): number[] {
  const found: number[] = [];
  doc.forEach((node, pos) => {
    if (node.textContent.includes(text)) found.push(pos);
  });
  return found;
}

describe("computeAssigneeFilterDecorations — §16 View Filter 시나리오", () => {
  it("A. 전체(selectedUserId=null) → 아무 Decoration도 생기지 않는다(모든 Block 표시)", () => {
    const tasks = [task({ id: "t1", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map()));
    const doc = toPMDoc(document);
    const decorations = computeAssigneeFilterDecorations(doc, null);
    expect(decorations.find().length).toBe(0);
  });

  it("B/D. 박용수 필터 → 박용수 Block은 보이고 이지민 Block은 hidden", () => {
    const tasks = [
      task({ id: "t1", goalName: "G1", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] }),
      task({ id: "t2", goalName: "G2", assigneeNames: ["이지민"], assigneeUserIds: ["u-이지민"] }),
    ];
    const sortKeys = new Map([
      ["u-박용수", 1],
      ["u-이지민", 2],
    ]);
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, sortKeys));
    const doc = toPMDoc(document);
    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");

    const parkAutoPos = findAutoTablePosBySourceTaskId(doc, "t1")!;
    const leeAutoPos = findAutoTablePosBySourceTaskId(doc, "t2")!;
    expect(parkAutoPos).not.toBeNull();
    expect(leeAutoPos).not.toBeNull();
    expect(isHiddenAt(doc, parkAutoPos, decorations)).toBe(false); // 박용수 자신의 Block은 보인다
    expect(isHiddenAt(doc, leeAutoPos, decorations)).toBe(true); // 이지민 Block은 숨는다
  });

  // Step(복수 담당 Task Filter/Save 안전성 보완) — 이전(Step 3)에는 "두
  // occurrence 모두 hidden 아님"이 목표였으나, 실제로는 그 방식이 같은
  // 화면에 동일 Task를 두 번 보여주는 문제가 있었다(요청사항 §1/§2). 새
  // 정책은 "선택 담당자 자신의 구역에서 딱 1번만" 보이고, 다른 담당자
  // 구역의 동일 Task occurrence는 숨는다 — 아래 §11 A/B 테스트가 이를
  // 검증한다(이 파일의 "복수 담당 Task 안전성 보완(§11)" describe 참고).
  it("C. 복수 담당 Task → 선택한 담당자 자신의 구역 occurrence만 보이고, 다른 담당자 구역의 동일 Task occurrence는 숨는다", () => {
    const tasks = [task({ id: "t1", assigneeNames: ["박용수", "이지민"], assigneeUserIds: ["u-박용수", "u-이지민"] })];
    const sortKeys = new Map([
      ["u-박용수", 1],
      ["u-이지민", 2],
    ]);
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, sortKeys));
    const doc = toPMDoc(document);

    const autoTablePositions: number[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name === "table" && node.attrs.tableRole === "auto" && Array.isArray(node.attrs.sourceTaskIds) && node.attrs.sourceTaskIds.includes("t1")) {
        autoTablePositions.push(pos);
      }
    });
    expect(autoTablePositions).toHaveLength(2); // 두 담당자 구역에 각각 occurrence가 있다(§1 확인)

    const decorationsForPark = computeAssigneeFilterDecorations(doc, "u-박용수");
    const hiddenForPark = autoTablePositions.map((pos) => isHiddenAt(doc, pos, decorationsForPark));
    expect(hiddenForPark.filter((h) => !h)).toHaveLength(1); // 박용수 구역 occurrence 딱 1개만 visible
    expect(hiddenForPark.filter((h) => h)).toHaveLength(1); // 이지민 구역 occurrence는 hidden

    const decorationsForLee = computeAssigneeFilterDecorations(doc, "u-이지민");
    const hiddenForLee = autoTablePositions.map((pos) => isHiddenAt(doc, pos, decorationsForLee));
    expect(hiddenForLee.filter((h) => !h)).toHaveLength(1); // 이지민 구역 occurrence 딱 1개만 visible
    expect(hiddenForLee.filter((h) => h)).toHaveLength(1);
  });

  it("E/F. SUB goalName 아래 matching Task가 있으면 goal heading은 보이고, 전부 없으면 goal heading도 hidden", () => {
    const tasks = [
      task({ id: "t1", goalName: "GoalA", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] }),
      task({ id: "t2", goalName: "GoalB", assigneeNames: ["이지민"], assigneeUserIds: ["u-이지민"] }),
    ];
    const sortKeys = new Map([
      ["u-박용수", 1],
      ["u-이지민", 2],
    ]);
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, sortKeys));
    const doc = toPMDoc(document);
    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");

    const goalAHeadingPos = findChildPosByText(doc, "GoalA")!;
    const goalBHeadingPos = findChildPosByText(doc, "GoalB")!;
    expect(isHiddenAt(doc, goalAHeadingPos, decorations)).toBe(false); // 박용수 Task가 있는 GoalA는 보인다
    expect(isHiddenAt(doc, goalBHeadingPos, decorations)).toBe(true); // 박용수 Task가 없는 GoalB는 숨는다
  });

  it("G. filter on/off와 무관하게 doc 자체(getJSON 대응물)는 전혀 바뀌지 않는다 — Decoration만 계산될 뿐", () => {
    const tasks = [task({ id: "t1", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map()));
    const doc = toPMDoc(document);
    const beforeJSON = JSON.stringify(doc.toJSON());

    computeAssigneeFilterDecorations(doc, "u-박용수");
    computeAssigneeFilterDecorations(doc, null);

    expect(JSON.stringify(doc.toJSON())).toBe(beforeJSON); // 순수 함수 — 입력 doc을 전혀 변형하지 않는다
  });

  it("REGULAR_PROJECT/COMMON/EXCEPTION도 동일하게 필터 적용되고, BUSINESS_TRIP은 Focus mode에서 섹션째 숨는다(요청사항 5)", () => {
    const tasks = [
      task({ id: "r1", meetingReportSection: "REGULAR_PROJECT", projectName: "P", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] }),
      task({ id: "c1", meetingReportSection: "COMMON", title: "공통업무", assigneeNames: ["이지민"], assigneeUserIds: ["u-이지민"] }),
      task({ id: "e1", meetingReportSection: "EXCEPTION", title: "예외업무", assigneeNames: ["이지민"], assigneeUserIds: ["u-이지민"] }),
      task({ id: "b1", meetingReportSection: "BUSINESS_TRIP", title: "출장업무", assigneeNames: ["이지민"], assigneeUserIds: ["u-이지민"] }),
    ];
    const sortKeys = new Map([
      ["u-박용수", 1],
      ["u-이지민", 2],
    ]);
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, sortKeys));
    const doc = toPMDoc(document);
    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");

    expect(isHiddenAt(doc, findAutoTablePosBySourceTaskId(doc, "r1")!, decorations)).toBe(false);
    expect(isHiddenAt(doc, findAutoTablePosBySourceTaskId(doc, "c1")!, decorations)).toBe(true);
    expect(isHiddenAt(doc, findAutoTablePosBySourceTaskId(doc, "e1")!, decorations)).toBe(true);
    // BUSINESS_TRIP은 attachMetadata=false라 sourceTaskIds 자체가 없어
    // findAutoTablePosBySourceTaskId로는 Task를 못 찾지만(정상), 특정 담당자
    // filter에서는 요청사항 5(Focus mode)에 따라 "출장 업무" 섹션 heading
    // 자체가 통째로 숨어야 한다.
    expect(findAutoTablePosBySourceTaskId(doc, "b1")).toBeNull();
    const businessTripHeadingPos = findChildPosByText(doc, "출장 업무")!;
    expect(isHiddenAt(doc, businessTripHeadingPos, decorations)).toBe(true);
  });
});

/**
 * Step(복수 담당 Task Filter/Save 안전성 보완) — §11 A~E. 필터 1차 기준을
 * "Task의 assigneeUserIds"에서 "이 occurrence가 물리적으로 어느 담당자
 * 구역(👤 헤더) 아래에 있는가"로 바꾼 재설계를 §11이 요구하는 정확한 문구
 * 그대로 검증한다.
 */
describe("computeAssigneeFilterDecorations — 복수 담당 Task 안전성 보완(§11 A~E)", () => {
  function sharedTaskDoc(sortKeys = new Map([["u-A", 1], ["u-B", 2]])) {
    const tasks = [
      task({ id: "tShared", title: "공동업무", goalName: "공동 프로젝트", assigneeNames: ["USER_A", "USER_B"], assigneeUserIds: ["u-A", "u-B"] }),
    ];
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, sortKeys));
    return toPMDoc(document);
  }

  it("A. USER_A 필터 → USER_A header + Task A 1개만 visible, USER_B header/occurrence는 hidden", () => {
    const doc = sharedTaskDoc();
    const decorations = computeAssigneeFilterDecorations(doc, "u-A");

    const headerPositions = findAllChildPosByText(doc, "👤");
    expect(headerPositions).toHaveLength(2); // USER_A/USER_B 구역 header 2개
    const headerHidden = headerPositions.map((pos) => isHiddenAt(doc, pos, decorations));
    expect(headerHidden.filter((h) => !h)).toHaveLength(1); // 하나만 visible(USER_A 자신)
    expect(headerHidden.filter((h) => h)).toHaveLength(1); // 나머지(USER_B)는 hidden

    const autoTablePositions: number[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name === "table" && node.attrs.tableRole === "auto") autoTablePositions.push(pos);
    });
    expect(autoTablePositions).toHaveLength(2);
    const tableHidden = autoTablePositions.map((pos) => isHiddenAt(doc, pos, decorations));
    expect(tableHidden.filter((h) => !h)).toHaveLength(1); // Task A는 딱 1개만 visible
  });

  it("B. USER_B 필터 → 반대로 USER_B 구역만 visible", () => {
    const doc = sharedTaskDoc();
    const decorations = computeAssigneeFilterDecorations(doc, "u-B");

    const headerPositions = findAllChildPosByText(doc, "👤");
    const headerHidden = headerPositions.map((pos) => isHiddenAt(doc, pos, decorations));
    expect(headerHidden.filter((h) => !h)).toHaveLength(1);

    // USER_A 구역이 hidden인지 구체적으로 확인(반대 방향도 대칭적으로 동작하는지).
    // "USER_A"/"USER_B" 텍스트만으로 찾으면 AUTO Table의 "담당자" 셀
    // ("USER_A, USER_B")도 매치되어 버리므로, "👤 " 접두사까지 포함해
    // 실제 header 문단만 정확히 찾는다.
    const userAHeaderPos = findAllChildPosByText(doc, "👤 USER_A")[0];
    expect(isHiddenAt(doc, userAHeaderPos, decorations)).toBe(true);
    const userBHeaderPos = findAllChildPosByText(doc, "👤 USER_B")[0];
    expect(isHiddenAt(doc, userBHeaderPos, decorations)).toBe(false);
  });

  it("C. 비선택 담당자의 header가 빈 상태로 남지 않는다 — header와 그 구역 내용이 함께 숨는다", () => {
    const doc = sharedTaskDoc();
    const decorations = computeAssigneeFilterDecorations(doc, "u-A");

    // USER_B header 자신뿐 아니라, 그 구역의 goalName heading/AUTO Table/작성
    // Table까지 전부 hidden이어야 한다(header만 남고 내용은 보이는 식의
    // 잔여 UI가 없어야 한다).
    // ("USER_B" 텍스트만 찾으면 AUTO Table의 "담당자" 셀도 매치되므로 "👤 "
    // 접두사까지 포함해 실제 header 문단만 찾는다.)
    const userBHeaderPos = findAllChildPosByText(doc, "👤 USER_B")[0];
    expect(isHiddenAt(doc, userBHeaderPos, decorations)).toBe(true);

    let sawVisibleAfterHiddenHeader = false;
    let afterHeader = false;
    doc.forEach((node, pos) => {
      if (pos === userBHeaderPos) {
        afterHeader = true;
        return;
      }
      if (!afterHeader) return;
      if (node.type.name === "heading" && node.attrs.level !== 3) {
        afterHeader = false; // 다음 top-level 섹션으로 넘어감 — USER_B 구역 끝
        return;
      }
      if (!isHiddenAt(doc, pos, decorations)) sawVisibleAfterHiddenHeader = true;
    });
    expect(sawVisibleAfterHiddenHeader).toBe(false);
  });

  it("D. 특정 담당자 filter → 주요 안건/출장/기타 공용영역 hidden(전체 filter는 영향 없음)", () => {
    // 실제 Template 골격처럼 회의 기본정보/회의 규칙/주요 안건/미결 업무
    // 등 "필터 대상 4개 섹션이 아닌" heading도 함께 포함한 문서로 검증한다.
    const withNonFilterableSections: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "🗓️ 주간 업무 회의록" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "🎯 주요 안건" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "안건 1" }] },
        ...baseDocument().content!,
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "⏳ 미결 업무" }] },
      ],
    };
    const tasks = [task({ id: "t1", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const { document } = mergeSectionsIntoDocument(withNonFilterableSections, buildWeeklySections(tasks, new Map()));
    const doc = toPMDoc(document);

    const agendaHeadingPos = findChildPosByText(doc, "주요 안건")!;
    const pendingHeadingPos = findChildPosByText(doc, "미결 업무")!;
    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");
    expect(isHiddenAt(doc, agendaHeadingPos, decorations)).toBe(true);
    expect(isHiddenAt(doc, pendingHeadingPos, decorations)).toBe(true);

    // 전체("null") filter는 이 섹션들에 전혀 영향을 주지 않는다.
    const noFilterDecorations = computeAssigneeFilterDecorations(doc, null);
    expect(noFilterDecorations.find().length).toBe(0);
  });

  it("E. 전체 filter로 되돌리면(null) 원문 전체가 다시 visible이고, doc은 전혀 바뀌지 않는다", () => {
    const doc = sharedTaskDoc();
    const beforeJSON = JSON.stringify(doc.toJSON());
    computeAssigneeFilterDecorations(doc, "u-A"); // 필터를 걸어봤다가
    const decorations = computeAssigneeFilterDecorations(doc, null); // 다시 전체로
    expect(decorations.find().length).toBe(0);
    expect(JSON.stringify(doc.toJSON())).toBe(beforeJSON);
  });
});

/**
 * Step(Assignee Header Stable Metadata) — computeAssigneeFilterDecorations의
 * 담당자 구역 판정 기준을 "👤 " 텍스트 접두사에서 attrs.blockRole=
 * "ASSIGNEE_HEADER"로 바꿨다(요청사항 1/2). 신규 문서는 실제로 이 값을
 * 갖는 header만 있고(A), attrs가 없는 일반 문단은 절대 header로 오인되지
 * 않으며(B), 이미 신규 구조(metadata 있음)인 문서 안에서 우연히 같은
 * 문구로 시작하는 일반 문단도 절대 header로 오인되지 않고(C), legacy(이번
 * Step 이전, metadata 없이 "👤 이름" 텍스트만 있는) 문서는 여전히 fallback
 * 으로 정상 인식되는지(D)를 실제 Decoration 계산 결과로 검증한다.
 */
describe("computeAssigneeFilterDecorations — Header 판별 안정화(Step 3B A~D)", () => {
  it("A. 신규 문서에서 담당자 header는 blockRole=ASSIGNEE_HEADER로 만들어지고, 그 기준으로 필터가 정상 동작한다", () => {
    const tasks = [task({ id: "t1", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map()));
    const doc = toPMDoc(document);

    const headerPos = findChildPosByText(doc, "👤 박용수")!;
    let headerNode: PMNode | null = null;
    doc.forEach((node, pos) => {
      if (pos === headerPos) headerNode = node;
    });
    expect(headerNode!.attrs.blockRole).toBe("ASSIGNEE_HEADER");

    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");
    expect(isHiddenAt(doc, headerPos, decorations)).toBe(false); // 자기 자신의 header는 visible
  });

  it("B. blockRole/assigneeUserId가 기본값(null)인 일반 spacer 문단은 담당자 구역 경계로 오인되지 않는다(구역 추적이 끊기지 않는다)", () => {
    // REGULAR_PROJECT에 Task 1건을 넣으면 injectDocument.ts가 담당자 header
    // 다음/AUTO Table 다음 등에 여러 빈 paragraph({type:"paragraph"}, attrs
    // 없음 — 즉 모든 global attribute가 기본값 null)를 실제로 끼워 넣는다.
    // 이 문단들 때문에 "지금 담당자 구역"이 null로 잘못 리셋되면 그 뒤 AUTO
    // Table까지 통째로 숨어버린다(예전 hasOwnProperty 버그 재발 방지 회귀 검증).
    const tasks = [task({ id: "t1", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map()));
    const doc = toPMDoc(document);
    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");
    const autoTablePos = findAutoTablePosBySourceTaskId(doc, "t1")!;
    expect(isHiddenAt(doc, autoTablePos, decorations)).toBe(false);
  });

  it("C. 일반 paragraph text가 우연히 '👤 테스트'로 시작해도, 이미 ASSIGNEE_HEADER metadata가 있는 신규 문서에서는 담당자 구역 경계로 취급되지 않는다", () => {
    const tasks = [task({ id: "t1", assigneeNames: ["박용수"], assigneeUserIds: ["u-박용수"] })];
    const { document } = mergeSectionsIntoDocument(baseDocument(), buildWeeklySections(tasks, new Map()));
    // 담당자 header 바로 다음에, blockRole 없이 우연히 "👤 " 로 시작하는 평범한
    // 메모 문단을 하나 끼워 넣는다(신규 문서에 실제 코드가 만들 리 없는 문단이지만,
    // "혹시 사용자가 직접 이런 텍스트를 입력하면" 시나리오를 시뮬레이션한다).
    const content = document.content as JSONContent[];
    const headerIdx = content.findIndex((n) => n.type === "paragraph" && n.attrs?.blockRole === "ASSIGNEE_HEADER");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    content.splice(headerIdx + 1, 0, { type: "paragraph", content: [{ type: "text", text: "👤 테스트 관련 개인 메모" }] });

    const doc = toPMDoc(document);
    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");
    const memoPos = findChildPosByText(doc, "👤 테스트 관련 개인 메모")!;
    // 이 문단이 진짜 header였다면 currentAssigneeUserId가 null로 리셋돼 그
    // 뒤(AUTO Table 등)까지 전부 숨겨진다 — 실제로는 blockRole이 없으므로
    // 무시되고, 여전히 "u-박용수" 구역 안이라 이 문단 자신도 visible이어야 한다.
    expect(isHiddenAt(doc, memoPos, decorations)).toBe(false);
    const autoTablePos = findAutoTablePosBySourceTaskId(doc, "t1")!;
    expect(isHiddenAt(doc, autoTablePos, decorations)).toBe(false);
  });

  it("D. legacy 문서(ASSIGNEE_HEADER metadata 없이 '👤 이름' 텍스트만 있는 옛 구조)에서는 fallback으로 정상 필터링된다", () => {
    const legacyDoc: JSONContent = {
      type: "doc",
      content: [
        ...ALL_SECTIONS.map((s) => ({
          type: "heading" as const,
          attrs: { level: 2, meetingSection: s.section },
          content: [{ type: "text" as const, text: s.text }],
        })),
      ],
    };
    // REGULAR_PROJECT heading 바로 다음에 legacy 담당자 header(blockRole 없음)를 직접 끼워 넣는다.
    const regularIdx = legacyDoc.content!.findIndex((n) => n.type === "heading" && n.attrs?.meetingSection === "REGULAR_PROJECT");
    legacyDoc.content!.splice(
      regularIdx + 1,
      0,
      { type: "paragraph", attrs: { assigneeUserId: "u-박용수" }, content: [{ type: "text", text: "👤 박용수 · 1건" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "레거시 프로젝트" }] },
      { type: "table", attrs: { tableRole: "auto" }, content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "업무명" }] }] }] }] },
    );

    const doc = toPMDoc(legacyDoc);
    const headerPos = findChildPosByText(doc, "👤 박용수")!;
    const decorations = computeAssigneeFilterDecorations(doc, "u-박용수");
    expect(isHiddenAt(doc, headerPos, decorations)).toBe(false); // fallback으로 header 인식 → 자기 구역이라 visible

    const otherUserDecorations = computeAssigneeFilterDecorations(doc, "u-다른사람");
    expect(isHiddenAt(doc, headerPos, otherUserDecorations)).toBe(true); // 다른 담당자 필터에서는 hidden
  });
});
