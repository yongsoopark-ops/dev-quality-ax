import { AGENDA_DONE_LABEL, extractText, normalizeAgendaDoneText } from "./agendaStatus";
import { indexTableRowsByFieldKey, MEETING_FIELD_KEY } from "./fieldSemantics";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(Schedule/Meeting Minutes V1.1 사용성 개선 — 미결 안건 이월) — "주요
 * 안건" 섹션은 injectDocument.ts의 AUTO 병합 대상이 아닌 순수 사용자 편집
 * 영역이라(코드 주석으로 확인) 별도 식별 방법이 필요하다. AUTO 5개 섹션과
 * 달리 meetingSection attribute가 없으므로, heading 텍스트("🎯 주요 안건")로
 * 직접 경계를 찾는다 — 그 heading부터 다음 level<=2 heading(또는 문서 끝)
 * 전까지가 이 섹션의 범위다(build.ts의 findSectionEndIndex와 같은 규칙,
 * H3는 항상 안건 하나의 시작이라 level<=2만 경계로 본다).
 */
const AGENDA_SECTION_MARKER = "주요 안건";

function findAgendaSectionRange(content: JSONContent[]): { start: number; end: number } | null {
  const start = content.findIndex((n) => n.type === "heading" && extractText(n).includes(AGENDA_SECTION_MARKER));
  if (start === -1) return null;
  let end = content.length;
  for (let i = start + 1; i < content.length; i++) {
    const level = (content[i].attrs?.level as number | undefined) ?? 1;
    if (content[i].type === "heading" && level <= 2) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export interface CapturedAgendaItem {
  title: string;
  content: string;
  decision: string;
  owner: string;
}

function fieldText(rows: Map<string, JSONContent>, key: string): string {
  const row = rows.get(key);
  const valueCell = row?.content?.[1];
  return valueCell ? extractText(valueCell).trim() : "";
}

/**
 * 문서의 "주요 안건" 섹션에서 안건 블록(H3 + Table)마다 AGENDA_DONE이
 * 미결인 것만 뽑는다 — 완료는 이월 대상에서 제외한다(요청사항: "완료 →
 * 다음 회의로 이월하지 않음"). Template 골격 그대로(모든 필드가 빈)인
 * 안건은 이월할 내용이 없으므로 건너뛴다.
 */
export function extractPendingAgendaItems(doc: JSONContent): CapturedAgendaItem[] {
  const content: JSONContent[] = Array.isArray(doc.content) ? doc.content : [];
  const range = findAgendaSectionRange(content);
  if (!range) return [];

  const items: CapturedAgendaItem[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const node = content[i];
    if (node.type !== "table") continue;
    const rows = indexTableRowsByFieldKey(node);
    const doneText = fieldText(rows, MEETING_FIELD_KEY.AGENDA_DONE);
    if (normalizeAgendaDoneText(doneText) === AGENDA_DONE_LABEL.DONE) continue;

    const title = fieldText(rows, MEETING_FIELD_KEY.AGENDA_TITLE);
    const agendaContent = fieldText(rows, MEETING_FIELD_KEY.AGENDA_CONTENT);
    const decision = fieldText(rows, MEETING_FIELD_KEY.AGENDA_DECISION);
    const owner = fieldText(rows, MEETING_FIELD_KEY.AGENDA_OWNER);
    if (!title && !agendaContent && !decision && !owner) continue;

    items.push({ title, content: agendaContent, decision, owner });
  }
  return items;
}

/** 캡처 시점 문서의 "회의 일시" 필드 값 — pending Row의 sourceLabel(어느
 * 회의에서 이월됐는지 표시용)로만 쓰고, 병합/중복방지 로직은 이 값을 읽지
 * 않는다. */
export function extractMeetingDateTimeLabel(doc: JSONContent): string | null {
  const content: JSONContent[] = Array.isArray(doc.content) ? doc.content : [];
  for (const node of content) {
    if (node.type !== "table") continue;
    const rows = indexTableRowsByFieldKey(node);
    const text = fieldText(rows, MEETING_FIELD_KEY.MEETING_DATETIME);
    if (text) return text;
  }
  return null;
}

function paragraphCell(text: string, fieldKey?: string): JSONContent {
  return { type: "tableCell", ...(fieldKey ? { attrs: { fieldKey } } : {}), content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
}
function headerCell(text: string): JSONContent {
  return { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function buildAgendaTable(item: CapturedAgendaItem): JSONContent {
  return {
    type: "table",
    content: [
      { type: "tableRow", content: [headerCell("구분"), headerCell("내용")] },
      { type: "tableRow", content: [paragraphCell("안건명", MEETING_FIELD_KEY.AGENDA_TITLE), paragraphCell(item.title)] },
      { type: "tableRow", content: [paragraphCell("주요 내용", MEETING_FIELD_KEY.AGENDA_CONTENT), paragraphCell(item.content)] },
      { type: "tableRow", content: [paragraphCell("결정사항", MEETING_FIELD_KEY.AGENDA_DECISION), paragraphCell(item.decision)] },
      { type: "tableRow", content: [paragraphCell("담당자", MEETING_FIELD_KEY.AGENDA_OWNER), paragraphCell(item.owner)] },
      { type: "tableRow", content: [paragraphCell("완료 여부", MEETING_FIELD_KEY.AGENDA_DONE), paragraphCell(AGENDA_DONE_LABEL.PENDING)] },
    ],
  };
}

function collectPendingAgendaIds(nodes: JSONContent[]): Set<string> {
  const ids = new Set<string>();
  function walk(node: JSONContent) {
    if (node.type === "heading" && typeof node.attrs?.pendingAgendaId === "string") ids.add(node.attrs.pendingAgendaId);
    if (Array.isArray(node.content)) for (const child of node.content) walk(child);
  }
  for (const n of nodes) walk(n);
  return ids;
}

export interface PendingAgendaRow extends CapturedAgendaItem {
  id: string;
}

/**
 * pending Row들을 "주요 안건" 섹션 끝에 새 안건 블록으로 추가한다. 이미
 * 문서 안에 있는 pendingAgendaId(heading attrs, TemplateRichTextEditor.tsx
 * PendingAgendaIdAttribute가 저장/재편집을 거쳐도 사라지지 않게 지킨다)는
 * 건너뛰어 재클릭해도 중복 삽입되지 않는다(요청사항: "동일 미결 안건이
 * 여러 번 중복 삽입되지 않아야 한다"). "주요 안건" heading 자체가 없으면
 * (Template에서 통째로 지워진 극단적 경우) 안전하게 아무것도 넣지 않는다.
 */
export function insertPendingAgendaBlocks(doc: JSONContent, rows: PendingAgendaRow[]): { document: JSONContent; insertedIds: string[] } {
  const cloned: JSONContent = JSON.parse(JSON.stringify(doc));
  const content: JSONContent[] = Array.isArray(cloned.content) ? cloned.content : [];

  const existingIds = collectPendingAgendaIds(content);
  const toInsert = rows.filter((r) => !existingIds.has(r.id));
  if (toInsert.length === 0) return { document: cloned, insertedIds: [] };

  const range = findAgendaSectionRange(content);
  if (!range) return { document: cloned, insertedIds: [] };

  let maxNum = 0;
  for (let i = range.start + 1; i < range.end; i++) {
    const node = content[i];
    if (node.type === "heading" && node.attrs?.level === 3) {
      const match = /^안건\s*(\d+)$/.exec(extractText(node).trim());
      if (match) maxNum = Math.max(maxNum, Number(match[1]));
    }
  }

  const newNodes: JSONContent[] = [];
  toInsert.forEach((row, idx) => {
    newNodes.push({ type: "heading", attrs: { level: 3, pendingAgendaId: row.id }, content: [{ type: "text", text: `안건 ${maxNum + idx + 1}` }] });
    newNodes.push(buildAgendaTable(row));
  });

  content.splice(range.end, 0, ...newNodes);
  cloned.content = content;
  return { document: cloned, insertedIds: toInsert.map((r) => r.id) };
}
