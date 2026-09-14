import { describe, expect, it } from "vitest";
import {
  AGENDA_ORIGIN,
  appendManualAgendaBlocks,
  buildManualAgendaBlockNodes,
  extractManualAgendaBlocks,
  extractMeetingDateTimeLabel,
  extractPendingAgendaItems,
  insertPendingAgendaBlocks,
  planManualAgendaInsertion,
  type PendingAgendaRow,
} from "./pendingAgenda";
import { normalizeAgendaDoneCells } from "./agendaStatus";
import type { JSONContent } from "@tiptap/core";

function labelCell(text: string, fieldKey: string): JSONContent {
  return { type: "tableCell", attrs: { fieldKey }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
function valueCell(text: string): JSONContent {
  return { type: "tableCell", content: text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [{ type: "paragraph" }] };
}
function agendaTable(opts: { title?: string; content?: string; decision?: string; owner?: string; done?: string }): JSONContent {
  return {
    type: "table",
    content: [
      { type: "tableRow", content: [{ type: "tableHeader" }, { type: "tableHeader" }] },
      { type: "tableRow", content: [labelCell("안건명", "AGENDA_TITLE"), valueCell(opts.title ?? "")] },
      { type: "tableRow", content: [labelCell("주요 내용", "AGENDA_CONTENT"), valueCell(opts.content ?? "")] },
      { type: "tableRow", content: [labelCell("결정사항", "AGENDA_DECISION"), valueCell(opts.decision ?? "")] },
      { type: "tableRow", content: [labelCell("담당자", "AGENDA_OWNER"), valueCell(opts.owner ?? "")] },
      { type: "tableRow", content: [labelCell("완료 여부", "AGENDA_DONE"), valueCell(opts.done ?? "미결")] },
    ],
  };
}
function heading(level: number, text: string, extraAttrs: Record<string, unknown> = {}): JSONContent {
  return { type: "heading", attrs: { level, ...extraAttrs }, content: [{ type: "text", text }] };
}

function buildDoc(agendaBlocks: JSONContent[]): JSONContent {
  return {
    type: "doc",
    content: [heading(1, "🗓️ 주간 업무 회의록"), heading(2, "🎯 주요 안건"), ...agendaBlocks, heading(2, "🏗️ 정규 프로젝트")],
  };
}

describe("extractPendingAgendaItems", () => {
  it("미결 안건만 뽑고 완료 안건은 제외한다", () => {
    const doc = buildDoc([
      heading(3, "안건 1"),
      agendaTable({ title: "A", content: "내용A", done: "미결" }),
      heading(3, "안건 2"),
      agendaTable({ title: "B", content: "내용B", done: "완료" }),
    ]);
    const items = extractPendingAgendaItems(doc);
    expect(items).toEqual([{ title: "A", content: "내용A", decision: "", owner: "" }]);
  });

  it("완전히 빈 안건(Template 골격)은 이월하지 않는다", () => {
    const doc = buildDoc([heading(3, "안건 1"), agendaTable({ done: "미결" })]);
    expect(extractPendingAgendaItems(doc)).toEqual([]);
  });

  it("레거시 체크박스(☑)로 표시된 완료 안건도 이월하지 않는다", () => {
    const doc = buildDoc([heading(3, "안건 1"), agendaTable({ title: "A", done: "☑" })]);
    expect(extractPendingAgendaItems(doc)).toEqual([]);
  });

  it("레거시 체크박스(☐)는 미결로 취급해 이월한다", () => {
    const doc = buildDoc([heading(3, "안건 1"), agendaTable({ title: "A", done: "☐" })]);
    expect(extractPendingAgendaItems(doc)).toEqual([{ title: "A", content: "", decision: "", owner: "" }]);
  });

  it("주요 안건 heading이 없으면 빈 배열", () => {
    const doc: JSONContent = { type: "doc", content: [heading(1, "제목")] };
    expect(extractPendingAgendaItems(doc)).toEqual([]);
  });

  it("다른 AUTO 섹션(정규 프로젝트)의 Table은 안건으로 취급하지 않는다", () => {
    const doc = buildDoc([]);
    doc.content!.push({ type: "table", content: [] }); // 주요 안건 섹션 밖
    expect(extractPendingAgendaItems(doc)).toEqual([]);
  });
});

describe("extractMeetingDateTimeLabel", () => {
  it("MEETING_DATETIME 필드 값을 찾는다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [{ type: "tableRow", content: [labelCell("회의 일시", "MEETING_DATETIME"), valueCell("2026-09-07 10:00 ~ 11:20")] }],
        },
      ],
    };
    expect(extractMeetingDateTimeLabel(doc)).toBe("2026-09-07 10:00 ~ 11:20");
  });

  it("없으면 null", () => {
    expect(extractMeetingDateTimeLabel({ type: "doc", content: [] })).toBeNull();
  });
});

describe("insertPendingAgendaBlocks", () => {
  const rows: PendingAgendaRow[] = [{ id: "p1", title: "미결 안건 A", content: "내용", decision: "", owner: "" }];

  it("주요 안건 섹션 끝에 새 안건 블록을 추가하고 pendingAgendaId를 심는다", () => {
    const doc = buildDoc([heading(3, "안건 1"), agendaTable({ title: "기존" })]);
    const { document, insertedIds } = insertPendingAgendaBlocks(doc, rows);
    expect(insertedIds).toEqual(["p1"]);
    const headings = document.content!.filter((n) => n.type === "heading" && n.attrs?.level === 3);
    expect(headings).toHaveLength(2);
    expect(headings[1].attrs?.pendingAgendaId).toBe("p1");
    expect((headings[1].content![0] as { text: string }).text).toBe("안건 2");
  });

  it("이미 같은 pendingAgendaId가 문서에 있으면 다시 넣지 않는다(재클릭 안전)", () => {
    const doc = buildDoc([
      { type: "heading", attrs: { level: 3, pendingAgendaId: "p1" }, content: [{ type: "text", text: "안건 1" }] },
      agendaTable({ title: "미결 안건 A" }),
    ]);
    const { insertedIds, document } = insertPendingAgendaBlocks(doc, rows);
    expect(insertedIds).toEqual([]);
    const headings = document.content!.filter((n) => n.type === "heading" && n.attrs?.level === 3);
    expect(headings).toHaveLength(1); // 중복 삽입 없음
  });

  it("두 번 연달아 호출해도(같은 documentContent로) 두 번째는 삽입하지 않는다", () => {
    const doc = buildDoc([heading(3, "안건 1"), agendaTable({ title: "기존" })]);
    const first = insertPendingAgendaBlocks(doc, rows);
    const second = insertPendingAgendaBlocks(first.document, rows);
    expect(second.insertedIds).toEqual([]);
    const headings = second.document.content!.filter((n) => n.type === "heading" && n.attrs?.level === 3);
    expect(headings).toHaveLength(2); // 처음 삽입된 1개만 유지, 추가되지 않음
  });

  it("주요 안건 섹션이 없으면 아무것도 넣지 않는다", () => {
    const doc: JSONContent = { type: "doc", content: [heading(1, "제목")] };
    const { insertedIds } = insertPendingAgendaBlocks(doc, rows);
    expect(insertedIds).toEqual([]);
  });
});

describe("normalizeAgendaDoneCells (legacy checkbox 호환)", () => {
  it("☑는 완료로, ☐/빈 값은 미결로 정규화한다", () => {
    const doc = buildDoc([
      heading(3, "안건 1"),
      agendaTable({ done: "☑" }),
      heading(3, "안건 2"),
      agendaTable({ done: "☐" }),
      heading(3, "안건 3"),
      agendaTable({ done: "" }),
    ]);
    const { document, changed } = normalizeAgendaDoneCells(doc);
    expect(changed).toBe(true);
    const tables = document.content!.filter((n) => n.type === "table");
    const doneTextOf = (t: JSONContent) => (t.content![5].content![1].content![0].content![0] as { text: string }).text;
    expect(doneTextOf(tables[0])).toBe("완료");
    expect(doneTextOf(tables[1])).toBe("미결");
    expect(doneTextOf(tables[2])).toBe("미결");
  });

  it("이미 완료/미결이면 changed:false", () => {
    const doc = buildDoc([heading(3, "안건 1"), agendaTable({ done: "완료" })]);
    const { changed } = normalizeAgendaDoneCells(doc);
    expect(changed).toBe(false);
  });
});

// Step(주요 안건 신규 추가분 보존 정책 — Follow-up) — MANUAL origin이
// extractPendingAgendaItems/extractManualAgendaBlocks/insertPendingAgendaBlocks
// 사이에서 요구사항 §3의 정책 표(TEMPLATE/CARRIED/MANUAL × 완료/미결)대로
// 정확히 갈라지는지 검증한다.

describe("extractPendingAgendaItems — MANUAL origin 제외", () => {
  it("MANUAL 안건은 완료 여부와 무관하게 이 함수의 결과에서 제외된다(별도 경로로 처리)", () => {
    const doc = buildDoc([
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "manual-pending", done: "미결" }),
      heading(3, "안건 2", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "manual-done", done: "완료" }),
    ]);
    expect(extractPendingAgendaItems(doc)).toEqual([]);
  });

  it("origin이 없는(기존 문서) 안건은 그대로 TEMPLATE 취급되어 기존 정책(미결만 이월)이 적용된다", () => {
    const doc = buildDoc([
      heading(3, "안건 1"), // origin attrs 없음 — 기존 문서 호환
      agendaTable({ title: "legacy-pending", done: "미결" }),
    ]);
    expect(extractPendingAgendaItems(doc)).toEqual([{ title: "legacy-pending", content: "", decision: "", owner: "" }]);
  });

  it("CARRIED origin은 TEMPLATE과 동일하게 완료면 제외, 미결이면 이월된다(요청사항: CARRIED+완료 → 기존 정책상 완료 처리 가능)", () => {
    const doc = buildDoc([
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.CARRIED, pendingAgendaId: "old-1" }),
      agendaTable({ title: "carried-done", done: "완료" }),
    ]);
    expect(extractPendingAgendaItems(doc)).toEqual([]);
  });
});

describe("extractManualAgendaBlocks / appendManualAgendaBlocks", () => {
  it("MANUAL origin 블록만 원본 그대로(heading+table) 뽑는다", () => {
    const doc = buildDoc([
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "manual-A" }),
      heading(3, "안건 2"), // TEMPLATE(origin 없음) — 뽑히면 안 됨
      agendaTable({ title: "template-B" }),
    ]);
    const blocks = extractManualAgendaBlocks(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].attrs?.agendaOrigin).toBe(AGENDA_ORIGIN.MANUAL);
    expect(blocks[1].type).toBe("table");
  });

  it("MANUAL 블록이 없으면 빈 배열", () => {
    const doc = buildDoc([heading(3, "안건 1"), agendaTable({ title: "template-only" })]);
    expect(extractManualAgendaBlocks(doc)).toEqual([]);
  });

  it("appendManualAgendaBlocks — 주요 안건 섹션 끝에 원본 그대로 이어붙인다(텍스트 재구성 없음)", () => {
    const freshTemplateDoc = buildDoc([]); // reset 직후 clone된 빈 template 가정
    const manualBlocks = [
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "보존되어야 함", content: "서식/내용 원본 그대로" }),
    ];
    const result = appendManualAgendaBlocks(freshTemplateDoc, manualBlocks);
    const headings = result.content!.filter((n) => n.type === "heading" && n.attrs?.level === 3);
    expect(headings).toHaveLength(1);
    expect(headings[0].attrs?.agendaOrigin).toBe(AGENDA_ORIGIN.MANUAL);
    const tables = result.content!.filter((n) => n.type === "table");
    expect((tables[0].content![1].content![1].content![0].content![0] as { text: string }).text).toBe("보존되어야 함");
  });

  it("주요 안건 섹션이 없으면 아무것도 넣지 않는다(insertPendingAgendaBlocks와 동일 안전장치)", () => {
    const doc: JSONContent = { type: "doc", content: [heading(1, "제목")] };
    const result = appendManualAgendaBlocks(doc, [heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.MANUAL })]);
    expect(result).toEqual(doc);
  });
});

describe("planManualAgendaInsertion", () => {
  it("3/4. '주요 안건' 섹션 뒤에 다른 섹션(정규 업무)이 있어도, 커서 위치와 무관하게 항상 '주요 안건' 섹션의 마지막 안건 뒤에 삽입 위치를 정한다", () => {
    // buildDoc은 항상 [🗓️ 제목, 🎯 주요 안건, ...안건블록, 🏗️ 정규 프로젝트]
    // 형태다 — "정규 프로젝트" 섹션이 있는 이 케이스가 곧 요청사항 3번
    // (커서가 정규업무 영역에 있어도 주요 안건 영역에 생성)의 구조적 근거다.
    // 이 함수는 커서 개념 자체를 받지 않으므로("주요 안건" 섹션 경계만으로
    // 계산) 커서 위치가 애초에 결과에 영향을 줄 수 없다.
    const content = buildDoc([heading(3, "안건 1"), agendaTable({ title: "기존" })]).content!;
    const plan = planManualAgendaInsertion(content);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    // insertAtIndex는 "정규 프로젝트" heading의 배열 index를 가리켜야 한다
    // (그 앞, 즉 주요 안건 섹션의 마지막 안건 바로 뒤).
    expect(content[plan.insertAtIndex]).toEqual(heading(2, "🏗️ 정규 프로젝트"));
  });

  it("4. '주요 안건'이 문서의 마지막 섹션(뒤에 다른 섹션 없음)이어도 문서 끝 index를 가리킨다", () => {
    const content: JSONContent[] = [heading(1, "제목"), heading(2, "🎯 주요 안건"), heading(3, "안건 1"), agendaTable({ title: "기존" })];
    const plan = planManualAgendaInsertion(content);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.insertAtIndex).toBe(content.length);
  });

  it("6. 주요 안건 섹션 내부 기존 최대 번호가 3이면 다음 번호는 4다", () => {
    const content = buildDoc([
      heading(3, "안건 1"),
      agendaTable({ title: "A" }),
      heading(3, "안건 3"), // 중간 번호가 비어 있어도(1, 3만 존재) 최댓값 기준
      agendaTable({ title: "B" }),
    ]).content!;
    const plan = planManualAgendaInsertion(content);
    expect("error" in plan).toBe(false);
    if (!("error" in plan)) expect(plan.agendaNumber).toBe(4);
  });

  it("7. 주요 안건 섹션 밖에 '안건 99' 문자열이 있어도 번호 산정에 영향을 주지 않는다", () => {
    const content = buildDoc([heading(3, "안건 1"), agendaTable({ title: "A" })]).content!;
    content.push(heading(3, "안건 99")); // "정규 프로젝트" 섹션 안(주요 안건 밖)의 우연한 문자열
    const plan = planManualAgendaInsertion(content);
    expect("error" in plan).toBe(false);
    if (!("error" in plan)) expect(plan.agendaNumber).toBe(2); // 99+1이 아니라 1+1
  });

  it("'주요 안건' heading 자체가 없으면 임의 위치 대신 에러를 반환한다", () => {
    const content: JSONContent[] = [heading(1, "제목")];
    const plan = planManualAgendaInsertion(content);
    expect("error" in plan).toBe(true);
  });
});

describe("buildManualAgendaBlockNodes", () => {
  it("agendaOrigin=MANUAL, 완료 여부 기본값 미결인 빈 안건 블록을 만든다", () => {
    const nodes = buildManualAgendaBlockNodes("안건 3");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].attrs?.agendaOrigin).toBe(AGENDA_ORIGIN.MANUAL);
    expect((nodes[0].content![0] as { text: string }).text).toBe("안건 3");
    const doneCell = nodes[1].content![5].content![1];
    expect((doneCell.content![0].content![0] as { text: string }).text).toBe("미결");
  });
});

describe("insertPendingAgendaBlocks — CARRIED origin stamping", () => {
  it("새로 삽입하는 안건 heading에 agendaOrigin=CARRIED를 함께 심는다(기존 pendingAgendaId 유지)", () => {
    const doc = buildDoc([]);
    const rows: PendingAgendaRow[] = [{ id: "row-1", title: "이월됨", content: "", decision: "", owner: "" }];
    const { document } = insertPendingAgendaBlocks(doc, rows);
    const inserted = document.content!.find((n) => n.type === "heading" && n.attrs?.level === 3)!;
    expect(inserted.attrs?.pendingAgendaId).toBe("row-1");
    expect(inserted.attrs?.agendaOrigin).toBe(AGENDA_ORIGIN.CARRIED);
  });
});

/**
 * lib/meetingMinutes/draft.ts의 resetMeetingMinutesDraftAction과 정확히 같은
 * 순서로 순수 함수만 조합해 reset을 흉내낸다(Prisma 없이) — 요청사항 §9의
 * A~G 테스트 케이스를 전부 이 한 곳에서 검증한다. carriedRows의 id는 실제로는
 * DB가 생성하지만, 여기서는 고정 문자열로 대체한다(로직 자체는 id 값에
 * 의존하지 않는다).
 */
function simulateReset(existingDoc: JSONContent, freshTemplateDoc: JSONContent): JSONContent {
  const manualBlocks = extractManualAgendaBlocks(existingDoc);
  const pendingItems = extractPendingAgendaItems(existingDoc);
  const carriedRows: PendingAgendaRow[] = pendingItems.map((item, i) => ({ id: `carried-${i}`, ...item }));

  let doc = appendManualAgendaBlocks(freshTemplateDoc, manualBlocks);
  if (carriedRows.length > 0) {
    doc = insertPendingAgendaBlocks(doc, carriedRows).document;
  }
  return doc;
}

function headingTexts(doc: JSONContent): string[] {
  return doc
    .content!.filter((n) => n.type === "heading" && n.attrs?.level === 3)
    .map((n) => (n.content?.[0] as { text: string } | undefined)?.text ?? "");
}

describe("주요 안건 초기화 — 최종 정책(TEMPLATE/CARRIED/MANUAL × 완료/미결)", () => {
  const freshTemplate = buildDoc([]); // 활성 Template을 새로 clone한 직후의 빈 "주요 안건" 섹션

  it("A. TEMPLATE(origin 없음) 안건 + 완료 → reset 후 삭제", () => {
    const existing = buildDoc([heading(3, "안건 1"), agendaTable({ title: "template-done", done: "완료" })]);
    const result = simulateReset(existing, freshTemplate);
    expect(headingTexts(result)).toEqual([]);
  });

  it("B. TEMPLATE(origin 없음) 안건 + 미결 → reset 후 유지(자동 이월)", () => {
    const existing = buildDoc([heading(3, "안건 1"), agendaTable({ title: "template-pending", done: "미결" })]);
    const result = simulateReset(existing, freshTemplate);
    expect(headingTexts(result)).toEqual(["안건 1"]);
    const tables = result.content!.filter((n) => n.type === "table");
    expect((tables[0].content![1].content![1].content![0].content![0] as { text: string }).text).toBe("template-pending");
  });

  it("C. MANUAL 안건 + 미결 → 유지", () => {
    const existing = buildDoc([
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "manual-pending", done: "미결" }),
    ]);
    const result = simulateReset(existing, freshTemplate);
    expect(headingTexts(result)).toEqual(["안건 1"]);
    const tables = result.content!.filter((n) => n.type === "table");
    expect((tables[0].content![1].content![1].content![0].content![0] as { text: string }).text).toBe("manual-pending");
  });

  it("D. MANUAL 안건 + 완료 → 반드시 유지(핵심 요구사항)", () => {
    const existing = buildDoc([
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "manual-done", done: "완료" }),
    ]);
    const result = simulateReset(existing, freshTemplate);
    expect(headingTexts(result)).toEqual(["안건 1"]);
    const tables = result.content!.filter((n) => n.type === "table");
    expect((tables[0].content![1].content![1].content![0].content![0] as { text: string }).text).toBe("manual-done");
  });

  it("E. CARRIED 안건 — 기존 pending 정책(완료 삭제/미결 유지) 그대로 회귀 없음", () => {
    const existingPending = buildDoc([
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.CARRIED, pendingAgendaId: "prev-1" }),
      agendaTable({ title: "carried-pending", done: "미결" }),
    ]);
    const pendingResult = simulateReset(existingPending, freshTemplate);
    expect(headingTexts(pendingResult)).toEqual(["안건 1"]);

    const existingDone = buildDoc([
      heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.CARRIED, pendingAgendaId: "prev-2" }),
      agendaTable({ title: "carried-done", done: "완료" }),
    ]);
    const doneResult = simulateReset(existingDone, freshTemplate);
    expect(headingTexts(doneResult)).toEqual([]);
  });

  it("F. 기존 metadata(agendaOrigin) 없는 문서 — 정상적으로 reset 가능(에러 없음, TEMPLATE 취급)", () => {
    const legacyDoc = buildDoc([heading(3, "안건 1"), agendaTable({ title: "legacy", done: "미결" })]);
    expect(() => simulateReset(legacyDoc, freshTemplate)).not.toThrow();
    expect(headingTexts(simulateReset(legacyDoc, freshTemplate))).toEqual(["안건 1"]);
  });

  it("G. 뒤섞인 문서(TEMPLATE 완료 + TEMPLATE 미결 + MANUAL 완료 + MANUAL 미결)를 한 번에 올바르게 분류한다", () => {
    const existing = buildDoc([
      heading(3, "안건 1"),
      agendaTable({ title: "template-done", done: "완료" }),
      heading(3, "안건 2"),
      agendaTable({ title: "template-pending", done: "미결" }),
      heading(3, "안건 3", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "manual-done", done: "완료" }),
      heading(3, "안건 4", { agendaOrigin: AGENDA_ORIGIN.MANUAL }),
      agendaTable({ title: "manual-pending", done: "미결" }),
    ]);
    const result = simulateReset(existing, freshTemplate);
    const tables = result.content!.filter((n) => n.type === "table");
    const titles = tables.map((t) => (t.content![1].content![1].content![0]?.content![0] as { text: string } | undefined)?.text);
    // template-done만 사라지고 나머지 3건(template-pending/manual-done/manual-pending)은 전부 남는다.
    expect(titles).not.toContain("template-done");
    expect(titles).toEqual(expect.arrayContaining(["template-pending", "manual-done", "manual-pending"]));
    expect(titles).toHaveLength(3);
  });
});

describe("reset 2회 연속 — 중복 삽입 없음(요청사항 §9-G)", () => {
  it("MANUAL 안건은 두 번째 reset에서도 정확히 1건만 유지된다(원본을 그대로 이어붙일 뿐 재삽입하지 않으므로 중복 자체가 발생하지 않는 구조)", () => {
    const freshTemplate = buildDoc([]);
    const afterFirstReset = simulateReset(
      buildDoc([heading(3, "안건 1", { agendaOrigin: AGENDA_ORIGIN.MANUAL }), agendaTable({ title: "manual", done: "미결" })]),
      freshTemplate,
    );
    // 두 번째 reset 때는 "지금 Draft"(afterFirstReset)가 곧 existingBeforeReset이 된다.
    const afterSecondReset = simulateReset(afterFirstReset, freshTemplate);
    expect(headingTexts(afterSecondReset)).toEqual(["안건 1"]);
  });

  it("CARRIED 안건은 pendingAgendaId 덕분에 두 번째 reset에서도 중복 삽입되지 않는다(기존 회귀 없음)", () => {
    const freshTemplate = buildDoc([]);
    const original = buildDoc([heading(3, "안건 1"), agendaTable({ title: "미결 이슈", done: "미결" })]);
    const afterFirstReset = simulateReset(original, freshTemplate);
    expect(headingTexts(afterFirstReset)).toEqual(["안건 1"]);

    const afterSecondReset = simulateReset(afterFirstReset, freshTemplate);
    // 여전히 미결이므로 계속 이월되지만, 매번 새 carriedRow(새 id)로 처리되므로
    // "안건 1" 하나만 유지된다(같은 이슈가 중복으로 쌓이지 않는다 — 기존
    // "매번 새 Row를 만든다" 정책과 무관하게 화면에는 항상 최신 1건만 보임).
    expect(headingTexts(afterSecondReset)).toEqual(["안건 1"]);
  });
});
