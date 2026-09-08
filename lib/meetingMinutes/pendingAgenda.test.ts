import { describe, expect, it } from "vitest";
import { extractMeetingDateTimeLabel, extractPendingAgendaItems, insertPendingAgendaBlocks, type PendingAgendaRow } from "./pendingAgenda";
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
function heading(level: number, text: string): JSONContent {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
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
