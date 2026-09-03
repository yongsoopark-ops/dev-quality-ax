import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(파트 주간회의 Table UX + AUTO 필드 개편) — "DOCX 다운로드" 대상은
 * Template 원본이 아니라 지금 화면에 보이는 Draft 문서(JSONContent) 그
 * 자체다(요청사항: "현재 사용자가 보고/편집 중인 Draft"). 그래서 이 파일은
 * Tiptap JSON 트리를 순서대로 훑으며 그대로 대응하는 docx 라이브러리
 * 객체로 바꾸기만 한다 — 별도 파싱/추측 없이 "지금 Editor에 보이는 그대로"
 * 를 목표로 한다.
 *
 * 웹 UI 전용 요소(Toolbar/버튼/warning 배너/접기 상태)는 애초에 이
 * documentContent 안에 없다 — 그것들은 React가 documentContent 밖에서 따로
 * 그리는 것들이라(app/(shell)/meeting-minutes-preview/MeetingMinutesPreviewClient.tsx
 * 참고) DOCX 변환 대상에서 자연히 제외된다(요청사항 그대로 만족).
 *
 * `docx`(dolanmiu/docx) npm 패키지를 그대로 쓴다 — OOXML을 직접 만들지
 * 않는 검증된 방식이다(요청사항: "안전한 방식을 사용").
 */

const HEADER_SHADING = { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" }; // navy-50 톤과 맞춘 연한 배경
const CELL_MARGIN = { top: 100, bottom: 100, left: 120, right: 120 };
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "D9DEE8" };
const TABLE_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
  insideHorizontal: CELL_BORDER,
  insideVertical: CELL_BORDER,
};

const NUMBERING_REFERENCE = "meeting-minutes-ordered-list";

/**
 * Step(AUTO/작성 영역 분리 + 표 열 비율 조정) — 웹(app/globals.css의
 * nth-child(N):last-child 규칙)과 완전히 같은 기준을 여기서도 그대로
 * 쓴다: 2열(구분 | 내용 — 주요 안건/프로젝트 작성 Table)은 20/80. 그
 * 외(기본정보 4열, 미결 업무 6열 등)는 이전과 동일하게 균등 배분한다 —
 * 요청사항이 없었던 열 구성까지 임의로 바꾸지 않는다.
 *
 * Step(AUTO 표 Compact화) — 3열(업무명 | 진행 일정 | 담당자 — Schedule
 * AUTO Table)은 50/30/20에서 1:1:1(균등)로 바뀌었다(요청사항). 이 %는
 * Table 자체의 width(아래 tableWidthPercent) 기준 상대값이므로, 3열
 * Table의 width를 65%로 줄인 상태에서 각 셀을 33.33%씩 나누면 페이지
 * 기준으로는 65% × 1/3 ≈ 21.7%씩 차지해 "compact 표 안에서 균등 3열"이
 * 정확히 재현된다. */
function columnWidthPercents(columnCount: number): number[] {
  if (columnCount === 2) return [20, 80];
  if (columnCount === 3) return [33.33, 33.33, 33.34];
  return Array.from({ length: columnCount }, () => 100 / columnCount);
}

/** Table 자체의 폭(페이지/섹션 폭 기준 %) — Schedule AUTO Table(3열)만
 * "정보 확인용"이라 compact하게 65%로 줄이고(요청사항: "editor/document
 * 전체 폭의 약 60~70%"), 회의 작성 Table(2열)을 포함한 나머지는 기존과
 * 동일하게 100%(wide, 입력 공간 우선)를 유지한다. */
function tableWidthPercent(columnCount: number): number {
  return columnCount === 3 ? 65 : 100;
}

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(extractText).join("");
  return "";
}

/** paragraph/heading 안의 inline content(text/hardBreak)를 TextRun 배열로
 * 바꾼다 — hardBreak는 새 Paragraph가 아니라 같은 문단 안 줄바꿈이어야
 * 하므로 TextRun의 break 옵션을 쓴다(요청사항: "줄바꿈 등이 깨지지 않는지
 * 확인"). */
function inlineRuns(node: JSONContent): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      runs.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    if (child.type !== "text") continue;
    const marks = child.marks ?? [];
    const bold = marks.some((m) => m.type === "bold");
    const italics = marks.some((m) => m.type === "italic");
    const underline = marks.some((m) => m.type === "underline") ? {} : undefined;
    const strike = marks.some((m) => m.type === "strike");
    const textStyleMark = marks.find((m) => m.type === "textStyle");
    const colorAttr = textStyleMark?.attrs?.color as string | undefined;
    const fontSizeAttr = textStyleMark?.attrs?.fontSize as string | undefined;
    runs.push(
      new TextRun({
        text: child.text ?? "",
        bold,
        italics,
        underline,
        strike,
        color: colorAttr ? colorAttr.replace("#", "") : undefined,
        // Tiptap FontSize는 "18px" 형태 — docx는 half-point 단위(pt*2)를
        // 쓴다. px→pt는 대략 0.75 비율(96dpi 기준)로 변환한다.
        size: fontSizeAttr ? Math.round(parseInt(fontSizeAttr, 10) * 0.75 * 2) : undefined,
      }),
    );
  }
  if (runs.length === 0) runs.push(new TextRun({ text: "" }));
  return runs;
}

function paragraphAlignment(node: JSONContent): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const align = node.attrs?.textAlign as string | undefined;
  if (align === "center") return AlignmentType.CENTER;
  if (align === "right") return AlignmentType.RIGHT;
  return undefined;
}

function convertHeading(node: JSONContent): Paragraph {
  const level = (node.attrs?.level as number | undefined) ?? 1;
  const headingLevel = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  return new Paragraph({ heading: headingLevel, alignment: paragraphAlignment(node), children: inlineRuns(node) });
}

function convertParagraph(node: JSONContent, opts?: { bulletLevel?: number; numberedLevel?: number; prefix?: string }): Paragraph {
  const children = inlineRuns(node);
  if (opts?.prefix) children.unshift(new TextRun({ text: opts.prefix }));
  return new Paragraph({
    alignment: paragraphAlignment(node),
    children,
    ...(opts?.bulletLevel !== undefined ? { bullet: { level: opts.bulletLevel } } : {}),
    ...(opts?.numberedLevel !== undefined ? { numbering: { reference: NUMBERING_REFERENCE, level: opts.numberedLevel } } : {}),
  });
}

/** bulletList/orderedList/taskList 안의 listItem들을 재귀적으로 순회한다
 * (nested list 지원). taskList는 체크 여부를 접두 기호로 표시한다 — docx는
 * 네이티브 체크박스 렌더링을 지원하지 않아 가장 안전한 방식(텍스트 기호)을
 * 쓴다. */
function convertList(node: JSONContent, depth: number, ordered: boolean, isTask: boolean): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of node.content ?? []) {
    if (item.type !== "listItem" && item.type !== "taskItem") continue;
    for (const child of item.content ?? []) {
      if (child.type === "paragraph") {
        const prefix = isTask ? (item.attrs?.checked ? "☑ " : "☐ ") : undefined;
        out.push(convertParagraph(child, ordered ? { numberedLevel: depth, prefix } : { bulletLevel: depth, prefix }));
      } else if (child.type === "bulletList") {
        out.push(...convertList(child, depth + 1, false, false));
      } else if (child.type === "orderedList") {
        out.push(...convertList(child, depth + 1, true, false));
      } else if (child.type === "taskList") {
        out.push(...convertList(child, depth + 1, false, true));
      }
    }
  }
  return out;
}

function convertTableCellBlock(node: JSONContent): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const children = node.content ?? [];
  if (children.length === 0) {
    blocks.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
    return blocks;
  }
  for (const child of children) blocks.push(...convertBlock(child));
  return blocks;
}

function convertTableCell(node: JSONContent, isHeader: boolean, widthPercent: number): TableCell {
  return new TableCell({
    children: convertTableCellBlock(node),
    margins: CELL_MARGIN,
    shading: isHeader ? HEADER_SHADING : undefined,
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
  });
}

function convertTable(node: JSONContent): Table {
  const rows: TableRow[] = [];
  const rowNodes = (node.content ?? []).filter((r) => r.type === "tableRow");
  const columnCount = Math.max(1, ...rowNodes.map((r) => (r.content ?? []).length));
  const widths = columnWidthPercents(columnCount);

  for (const row of rowNodes) {
    const cells: TableCell[] = [];
    let colIndex = 0;
    for (const cell of row.content ?? []) {
      if (cell.type !== "tableCell" && cell.type !== "tableHeader") continue;
      cells.push(convertTableCell(cell, cell.type === "tableHeader", widths[colIndex] ?? widths[widths.length - 1]));
      colIndex++;
    }
    rows.push(new TableRow({ children: cells }));
  }
  return new Table({ rows, width: { size: tableWidthPercent(columnCount), type: WidthType.PERCENTAGE }, borders: TABLE_BORDERS });
}

/** doc.content의 최상위 노드 하나를 docx 블록 배열로 바꾼다 — Table 셀
 * 안에도 재귀적으로 쓰인다(convertTableCellBlock). */
function convertBlock(node: JSONContent): (Paragraph | Table)[] {
  switch (node.type) {
    case "heading":
      return [convertHeading(node)];
    case "paragraph":
      return [convertParagraph(node)];
    case "bulletList":
      return convertList(node, 0, false, false);
    case "orderedList":
      return convertList(node, 0, true, false);
    case "taskList":
      return convertList(node, 0, false, true);
    case "table":
      return [convertTable(node)];
    default:
      return [];
  }
}

/** documentContent(Tiptap JSON) 전체를 .docx 바이너리(Buffer)로 만든다.
 * Table 폭/줄바꿈/서식이 실제 Word에서 깨지지 않는지는 완료 보고에서
 * 실제 생성한 파일을 열어 확인한다(요청사항). */
export async function convertMeetingMinutesToDocx(documentContent: JSONContent): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const node of documentContent.content ?? []) {
    children.push(...convertBlock(node));
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: NUMBERING_REFERENCE,
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
