import { describe, expect, it } from "vitest";
import { renameProjectHeadingInDocument } from "./projectRename";
import type { JSONContent } from "@tiptap/core";

function heading(level: number, text: string): JSONContent {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

describe("renameProjectHeadingInDocument", () => {
  it("H3 heading 텍스트가 정확히 일치하면 바꾼다", () => {
    const doc: JSONContent = { type: "doc", content: [heading(2, "정규 프로젝트"), heading(3, "M-서동이"), { type: "paragraph" }] };
    const { document, changed } = renameProjectHeadingInDocument(doc, "M-서동이", "M-쿨러터보 핏");
    expect(changed).toBe(true);
    expect((document.content![1].content![0] as { text: string }).text).toBe("M-쿨러터보 핏");
  });

  it("부분 일치는 바꾸지 않는다", () => {
    const doc: JSONContent = { type: "doc", content: [heading(3, "M-서동이 프로젝트")] };
    const { document, changed } = renameProjectHeadingInDocument(doc, "M-서동이", "M-쿨러터보 핏");
    expect(changed).toBe(false);
    expect((document.content![0].content![0] as { text: string }).text).toBe("M-서동이 프로젝트");
  });

  it("H3가 아닌 heading(예: 회의 규칙/주요 안건 등 level 1~2)은 건드리지 않는다", () => {
    const doc: JSONContent = { type: "doc", content: [heading(2, "M-서동이")] };
    const { changed } = renameProjectHeadingInDocument(doc, "M-서동이", "M-쿨러터보 핏");
    expect(changed).toBe(false);
  });

  it("Table 안(업무명/작성 내용)의 같은 텍스트는 heading이 아니므로 건드리지 않는다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        heading(3, "M-서동이"),
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "M-서동이" }] }] }] }] },
      ],
    };
    const { document } = renameProjectHeadingInDocument(doc, "M-서동이", "M-쿨러터보 핏");
    const tableCellText = (document.content![1].content![0].content![0].content![0].content![0] as { text: string }).text;
    expect(tableCellText).toBe("M-서동이"); // Table 셀 내용은 그대로
  });

  it("일치하는 heading이 없으면 changed:false, 문서는 그대로", () => {
    const doc: JSONContent = { type: "doc", content: [heading(3, "다른 프로젝트")] };
    const { changed, document } = renameProjectHeadingInDocument(doc, "M-서동이", "M-쿨러터보 핏");
    expect(changed).toBe(false);
    expect(document).toEqual(doc);
  });
});
