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

/**
 * Step(주요 안건 신규 추가분 보존 정책) — 안건 heading(H3)에 심는 origin
 * 식별자. TemplateRichTextEditor.tsx의 AgendaOriginAttribute(heading global
 * attribute)가 documentContent JSON에 그대로 저장/복원한다(DB schema 변경
 * 없음 — 기존 pendingAgendaId와 동일한 방식).
 *
 * - TEMPLATE: Template/초기 구조에 원래 있던 안건. **attrs가 아예 없는 기존
 *   문서(이 기능 이전 데이터)도 전부 TEMPLATE으로 취급한다**(기본값) — 그래야
 *   기존 문서가 깨지지 않고 기존 완료/미결 정책이 그대로 적용된다(요청사항:
 *   "기존 문서 호환").
 * - CARRIED: 이전 회의에서 미결로 이월된 안건 — insertPendingAgendaBlocks가
 *   찍는다(자동 이월/수동 "미결 안건 불러오기" 공용).
 * - MANUAL: 사용자가 회의록 운영 중 "안건 추가" 버튼으로 신규 추가한 안건 —
 *   완료 여부와 무관하게 항상 보존 대상이다(요청사항).
 */
export const AGENDA_ORIGIN = {
  TEMPLATE: "TEMPLATE",
  CARRIED: "CARRIED",
  MANUAL: "MANUAL",
} as const;
export type AgendaOrigin = (typeof AGENDA_ORIGIN)[keyof typeof AGENDA_ORIGIN];

/**
 * Step(MANUAL 안건 생성 범위 제한) — "주요 안건" 섹션의 배열 index 경계를
 * 찾는 이 함수를 TemplateRichTextEditor.tsx("안건 추가" 버튼)에서도 그대로
 * 재사용한다(새 parser를 만들지 않는다는 요청사항). 반환하는 {start, end}는
 * documentContent의 최상위 content 배열 index 기준이며, end는 "그 다음
 * level<=2 heading의 index(또는 배열 길이)"다 — 호출부가 ProseMirror 위치로
 * 변환해서 쓴다.
 */
export function findAgendaSectionRange(content: JSONContent[]): { start: number; end: number } | null {
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
 *
 * Step(주요 안건 신규 추가분 보존 정책) — agendaOrigin=MANUAL인 블록은
 * 완료 여부와 무관하게 항상 원본 그대로 보존해야 하는 별도 경로
 * (extractManualAgendaBlocks/appendManualAgendaBlocks)로 처리한다 — 여기서
 * 함께 뽑아 텍스트로 분해해버리면 서식이 사라지고, MANUAL 전용 보존 경로와
 * 중복 삽입될 수 있어 이 함수에서는 명시적으로 제외한다.
 */
export function extractPendingAgendaItems(doc: JSONContent): CapturedAgendaItem[] {
  const content: JSONContent[] = Array.isArray(doc.content) ? doc.content : [];
  const range = findAgendaSectionRange(content);
  if (!range) return [];

  const items: CapturedAgendaItem[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const node = content[i];
    if (node.type !== "table") continue;
    if (content[i - 1]?.attrs?.agendaOrigin === AGENDA_ORIGIN.MANUAL) continue;

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

/**
 * Step(주요 안건 신규 추가분 보존 정책) — "주요 안건" 섹션에서
 * agendaOrigin=MANUAL인 블록(heading+table 쌍)을 원본 JSON 그대로(텍스트로
 * 분해하지 않고) 뽑아낸다. 완료/미결 텍스트를 전혀 읽지 않는다 — MANUAL은
 * 상태와 무관하게 항상 보존 대상이므로 이 함수 자체가 필터링할 필요가 없다.
 */
export function extractManualAgendaBlocks(doc: JSONContent): JSONContent[] {
  const content: JSONContent[] = Array.isArray(doc.content) ? doc.content : [];
  const range = findAgendaSectionRange(content);
  if (!range) return [];

  const blocks: JSONContent[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const heading = content[i];
    if (heading.type !== "heading" || heading.attrs?.agendaOrigin !== AGENDA_ORIGIN.MANUAL) continue;
    blocks.push(heading);
    const table = content[i + 1];
    if (table?.type === "table") blocks.push(table);
  }
  return blocks;
}

/**
 * extractManualAgendaBlocks로 뽑은 블록들을 새로 clone한 문서의 "주요 안건"
 * 섹션 끝에 원본 그대로 이어붙인다. "주요 안건" heading 자체가 없으면(극단적
 * 경우) insertPendingAgendaBlocks와 동일하게 안전하게 아무것도 넣지 않는다.
 */
export function appendManualAgendaBlocks(doc: JSONContent, blocks: JSONContent[]): JSONContent {
  if (blocks.length === 0) return doc;
  const cloned: JSONContent = JSON.parse(JSON.stringify(doc));
  const content: JSONContent[] = Array.isArray(cloned.content) ? cloned.content : [];
  const range = findAgendaSectionRange(content);
  if (!range) return cloned;

  content.splice(range.end, 0, ...(JSON.parse(JSON.stringify(blocks)) as JSONContent[]));
  cloned.content = content;
  return cloned;
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
 * Step(MANUAL 안건 생성 범위 제한) — "안건 추가" 버튼이 실제로 어디에(문서
 * 최상위 content 배열 index 기준) 몇 번으로 새 블록을 넣어야 할지 계산하는
 * 순수 함수. ProseMirror Editor 객체가 전혀 필요 없어(문서 JSON 배열만
 * 받는다) DOM 없이 그대로 unit test할 수 있다 — 실제 삽입(배열 index →
 * ProseMirror 위치 변환, editor.chain().insertContentAt)은 호출부
 * (TemplateRichTextEditor.tsx)의 얇은 글루 코드가 담당한다(요청사항: 새
 * parser를 중복 구현하지 않고 findAgendaSectionRange를 그대로 재사용).
 *
 * 커서 위치는 전혀 참고하지 않는다 — 항상 "주요 안건" 섹션의 마지막 안건
 * 뒤(range.end)에 삽입 위치를 정한다. 번호도 그 섹션 범위(range.start+1~
 * range.end) 안의 "안건 N" heading만 스캔한다 — 섹션 밖에 우연히 같은
 * 패턴의 문자열이 있어도 영향받지 않는다. "주요 안건" heading 자체를
 * 찾지 못하면 임의 위치에 넣지 않고 에러 메시지를 반환한다.
 */
export function planManualAgendaInsertion(
  content: JSONContent[],
): { insertAtIndex: number; agendaNumber: number } | { error: string } {
  const range = findAgendaSectionRange(content);
  if (!range) {
    return {
      error: '"주요 안건" 영역을 찾을 수 없어 안건을 추가하지 못했습니다. 문서에 "주요 안건" 제목이 있는지 확인해 주세요.',
    };
  }

  let maxNum = 0;
  for (let i = range.start + 1; i < range.end; i++) {
    const node = content[i];
    if (node.type === "heading" && node.attrs?.level === 3) {
      const match = /^안건\s*(\d+)$/.exec(extractText(node).trim());
      if (match) maxNum = Math.max(maxNum, Number(match[1]));
    }
  }

  return { insertAtIndex: range.end, agendaNumber: maxNum + 1 };
}

/**
 * Step(주요 안건 신규 추가분 보존 정책) — "안건 추가" 버튼(TemplateRichTextEditor.tsx)이
 * 에디터 커서 위치에 그대로 삽입할 빈 안건 블록(heading+table) 1건을 만든다.
 * agendaOrigin=MANUAL로 stamping해 reset 시 완료 여부와 무관하게 항상
 * 보존되게 한다(요청사항) — 다른 필드는 buildAgendaTable의 기존 빈 안건
 * 골격과 동일(완료 여부 기본값 "미결")하다.
 */
export function buildManualAgendaBlockNodes(agendaLabel: string): JSONContent[] {
  return [
    { type: "heading", attrs: { level: 3, agendaOrigin: AGENDA_ORIGIN.MANUAL }, content: [{ type: "text", text: agendaLabel }] },
    buildAgendaTable({ title: "", content: "", decision: "", owner: "" }),
  ];
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
    // Step(주요 안건 신규 추가분 보존 정책) — agendaOrigin=CARRIED로도 함께
    // stamping한다(기존 pendingAgendaId는 그대로 유지 — 재클릭 중복 방지
    // 용도가 그대로 필요하다). 이후 이 안건이 다시 완료되면 extractPendingAgendaItems가
    // (origin과 무관하게) 그대로 걸러내 삭제 대상이 된다 — "CARRIED+완료 →
    // 기존 정책상 완료 처리 가능"과 정합.
    newNodes.push({
      type: "heading",
      attrs: { level: 3, pendingAgendaId: row.id, agendaOrigin: AGENDA_ORIGIN.CARRIED },
      content: [{ type: "text", text: `안건 ${maxNum + idx + 1}` }],
    });
    newNodes.push(buildAgendaTable(row));
  });

  content.splice(range.end, 0, ...newNodes);
  cloned.content = content;
  return { document: cloned, insertedIds: toInsert.map((r) => r.id) };
}
