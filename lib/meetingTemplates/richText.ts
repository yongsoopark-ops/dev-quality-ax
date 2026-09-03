import { BLOCK_TYPE_LABELS } from "./constants";
import type { ListItemNode, MeetingTemplateBlock, MeetingTemplateSchema } from "./types";
import type { JSONContent } from "@tiptap/core";

/**
 * Step 5B-3.3(Rich Text Editor 전환) — Template의 문서 본문을 하나의
 * Tiptap/ProseMirror JSON 문서로 저장한다("Template의 문서 본문을 저장할 수
 * 있도록 현재 JSON schema를 최소 확장하는 방향을 우선 검토한다"는 요청사항에
 * 따라 새 컬럼 하나만 추가했다 — prisma/schema.prisma의 MeetingTemplate.
 * documentContent). 이 파일은 그 문서 JSON을 다루는 두 가지 일:
 * 1) 서버가 신뢰할 수 없는 입력을 가볍게 검증(validateDocumentContent)
 * 2) 5B-3.2까지의 block 배열을 처음 열 때 1회성으로 문서로 변환
 *    (convertBlocksToDocument) — 기존 데이터가 깨지지 않도록 저장 전까지는
 *    원본 templateSchema를 건드리지 않는다.
 */

/** 빈 새 Template을 열었을 때의 시작 문서 — 문단 하나만 있어 사용자가 바로
 * 클릭해서 입력을 시작할 수 있다("+추가"류의 선행 동작이 필요 없다). */
export const EMPTY_DOCUMENT_CONTENT: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** 사고성 초대형 payload만 막는다 — ProseMirror 노드 스키마 자체의 세부
 * 유효성은 어차피 클라이언트 Tiptap 인스턴스가 로드 시점에 검증하므로, 서버가
 * 스키마 전체를 재구현하지 않는다(요청사항: 거대한 문서 플랫폼을 새로 만들지
 * 말 것). */
const MAX_DOCUMENT_CONTENT_BYTES = 500_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Step(회의록 줄간격 + 주간 간트 가독성 개선) — TemplateEditor가 이제
 * documentContent를 객체가 아니라 JSON 문자열로 직렬화해서 Server Action에
 * 넘긴다(실제로 재현/확인한 문제: 같은 attrs 모양이 수십 번 반복되는 큰
 * 문서를 객체 그대로 Server Action 인자로 넘기면, 서버에 도착했을 때 일부
 * 노드의 attrs만 사라지는 현상이 있었다 — 문자열 직렬화로 우회). 문자열이면
 * 파싱하고, 문자열이 아니면(과거 호출부/향후 다른 호출부 호환) 그대로
 * 돌려줘 validateDocumentContent가 이어서 검증한다.
 */
export function parseDocumentContentInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** raw가 "Tiptap 문서 JSON처럼 생겼는지"만 최소한으로 확인한다. */
export function validateDocumentContent(raw: unknown): JSONContent | null {
  if (!isRecord(raw)) return null;
  if (raw.type !== "doc") return null;
  if (!Array.isArray(raw.content)) return null;

  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return null;
  }
  if (serialized.length > MAX_DOCUMENT_CONTENT_BYTES) return null;

  return raw as JSONContent;
}

function textNodes(text: string): JSONContent[] {
  return text ? [{ type: "text", text }] : [];
}

/** 첫 항목보다 depth가 2 이상 급하게 깊어지는 등 손상된 데이터가 들어와도
 * buildListNode가 항상 안전하게 중첩할 수 있도록, 각 항목의 depth를 "바로
 * 앞 항목보다 최대 1단계까지만" 깊어지도록 보정한다. */
function clampListDepths(items: ListItemNode[]): ListItemNode[] {
  let prevDepth = -1;
  return items.map((item) => {
    const depth = Math.max(0, Math.min(item.depth, prevDepth + 1));
    prevDepth = depth;
    return { ...item, depth };
  });
}

/** depth가 있는 flat item 배열을 실제 중첩된 bulletList/orderedList 구조로
 * 만든다. 최상위만 style(글머리표/번호)을 따르고, depth 1 이상은 5B-3.2와
 * 동일한 정책으로 항상 글머리표로 통일한다(번호 목록 아래 하위 항목도
 * 전부 "•"). */
/** Step 5B-9(주간 파트 회의록 Preview 자동입력)에서도 그대로 재사용한다 —
 * "동일 프로젝트명 그룹핑 → depth 있는 중첩 목록" 구조가 이미 이 함수가
 * 하는 일과 정확히 같아서, 새 문서 조립 로직을 따로 만들지 않는다. */
export function buildListNode(items: ListItemNode[], style: "bullet" | "numbered"): JSONContent {
  const rootType = style === "numbered" ? "orderedList" : "bulletList";
  const nestedType = "bulletList";

  type Frame = { depth: number; type: string; items: JSONContent[] };
  const stack: Frame[] = [{ depth: 0, type: rootType, items: [] }];

  function popFrame() {
    const finished = stack.pop();
    if (!finished) return;
    const parent = stack[stack.length - 1];
    const parentItem = parent?.items[parent.items.length - 1];
    if (parentItem) {
      (parentItem.content as JSONContent[]).push({ type: finished.type, content: finished.items });
    }
  }

  for (const item of clampListDepths(items)) {
    while (stack.length > 1 && stack[stack.length - 1].depth > item.depth) popFrame();
    if (stack[stack.length - 1].depth < item.depth) {
      stack.push({ depth: item.depth, type: nestedType, items: [] });
    }
    stack[stack.length - 1].items.push({ type: "listItem", content: [{ type: "paragraph", content: textNodes(item.text) }] });
  }
  while (stack.length > 1) popFrame();

  return { type: stack[0].type, content: stack[0].items };
}

function convertBlock(block: MeetingTemplateBlock): JSONContent[] {
  switch (block.type) {
    case "heading":
      return [{ type: "heading", attrs: { level: block.config.level }, content: textNodes(block.config.text) }];
    case "text":
      return [{ type: "paragraph", content: textNodes(block.config.text ?? "") }];
    case "list": {
      const items = block.config.items ?? [];
      return items.length > 0 ? [buildListNode(items, block.config.style)] : [];
    }
    case "table": {
      const rows = block.config.rows;
      if (rows.length === 0) return [];
      return [
        {
          type: "table",
          content: rows.map((row) => ({
            type: "tableRow",
            content: row.map((cell) => ({ type: "tableCell", content: [{ type: "paragraph", content: textNodes(cell) }] })),
          })),
        },
      ];
    }
    // 5B-3의 구조화 block(레거시) — 정밀 변환 대신, 내용이 유실되지 않도록
    // 최소한의 제목/문단으로 풀어낸다(향후 실제 회의록 자동화가 필요로 할
    // "의미"는 이번 Step 범위 밖이라 다루지 않는다).
    case "meeting-info":
      return [
        { type: "heading", attrs: { level: 2 }, content: textNodes(`${block.config.icon ?? ""} ${BLOCK_TYPE_LABELS[block.type]}`.trim()) },
        ...block.config.fields.map((f): JSONContent => ({ type: "paragraph", content: textNodes(`${f.label}:`) })),
      ];
    case "agenda-list":
    case "project-list":
    case "action-item-list":
    case "review-list":
      return [{ type: "paragraph", content: textNodes(`(${BLOCK_TYPE_LABELS[block.type]})`) }];
    default:
      return [];
  }
}

/** Step 5B-3.2까지의 block 배열을 Rich Text Editor가 열 때 보여줄 문서로
 * 1회성 변환한다. 이 결과를 실제로 documentContent에 반영하려면 사용자가
 * Editor에서 "저장"을 눌러야 하고, 그 전까지 원본 templateSchema는 그대로
 * 남아 있다(요청사항: 기존 Template 데이터가 깨지지 않도록). */
export function convertBlocksToDocument(blocks: MeetingTemplateSchema): JSONContent {
  const content = blocks.flatMap(convertBlock);
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}
