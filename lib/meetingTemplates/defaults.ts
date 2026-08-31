import { BLOCK_TYPE_LABELS } from "./constants";
import type { MeetingInfoField, MeetingTemplateBlock, MeetingTemplateBlockType, TemplateTableColumn } from "./types";

/** Editor에서만 쓰는 내부 id 생성 — Template 안에서만 고유하면 되고, DB PK나
 * 다른 어떤 전역 식별자와도 무관하다. */
export function generateBlockId(): string {
  return `blk_${crypto.randomUUID()}`;
}
export function generateFieldKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

/** type에 맞는 안전한 기본 config로 새 block을 만든다. config 자체(제목
 * 텍스트, 항목 등)는 전부 빈 값이라 실제 내용은 사용자가 Editor에서 직접
 * 채운다 — 여기서 하드코딩하지 않는다. meeting-info/agenda-list/
 * project-list/action-item-list/review-list는 Step 5B-3.2부터 Editor의
 * "+ 추가" 메뉴에서 더 이상 만들 수 없지만(요청사항: block type을 사용자가
 * 선택하지 않게 한다), 함수 자체는 exhaustive하게 유지한다(타입/데이터
 * 구조를 당장 삭제하지 않는다는 요청사항). */
export function createDefaultBlock(type: MeetingTemplateBlockType, order: number): MeetingTemplateBlock {
  const base = {
    id: generateBlockId(),
    label: BLOCK_TYPE_LABELS[type],
    order,
    required: false,
    // 향후 시스템/Gemini가 문서 내용을 분석해 의미를 자동 분류할 수 있어야
    // 하므로(요청사항) 기본값을 true로 둔다 — 사용자가 이 값을 직접 설정할
    // UI는 이제 없다.
    aiEditable: true,
    userEditable: true,
  } as const;

  switch (type) {
    case "heading":
      return { ...base, type, source: "USER", config: { level: 2, text: "" } };
    case "text":
      return { ...base, type, source: "USER", config: { text: "" } };
    case "list":
      return { ...base, type, source: "USER", config: { style: "bullet", items: [] } };
    case "table":
      return {
        ...base,
        type,
        source: "USER",
        config: {
          rows: [
            ["", ""],
            ["", ""],
          ],
        },
      };
    case "meeting-info":
      return { ...base, type, source: "AUTO", config: { fields: [], icon: "📅" } };
    case "agenda-list":
      return { ...base, type, source: "USER", config: { numbered: true, icon: "📌" } };
    case "project-list":
      return { ...base, type, source: "AUTO", config: { columns: [], icon: "📦" } };
    case "action-item-list":
      return { ...base, type, source: "AI", config: { columns: [], icon: "✅" } };
    case "review-list":
      return { ...base, type, source: "AI", config: { accumulatesAcrossMeetings: true, icon: "🔁" } };
  }
}

export function createDefaultMeetingInfoField(): MeetingInfoField {
  return { key: generateFieldKey("field"), label: "새 필드" };
}

export function createDefaultTableColumn(): TemplateTableColumn {
  return { key: generateFieldKey("col"), label: "새 열" };
}

/**
 * Step 5B-3.2(자유 문서 Editor) — 사용자가 실제로 고르는 유일한 메뉴.
 * "회의록 내부 block type을 사용자가 선택하지 않게 한다"는 요청사항에 따라
 * meeting-info/agenda-list/project-list/action-item-list/review-list는
 * 이 메뉴에 없다 — 오직 일반 문서 요소(제목/본문/글머리표/번호목록/표)만
 * 고른다. "글머리표 목록"과 "번호 목록"은 내부적으로 같은 type="list"이고
 * config.style만 다르다.
 */
export const FREE_BLOCK_MENU_ITEMS: {
  key: string;
  label: string;
  icon: string;
  create: (order: number) => MeetingTemplateBlock;
}[] = [
  { key: "heading", label: "제목", icon: "🔠", create: (order) => createDefaultBlock("heading", order) },
  { key: "text", label: "본문", icon: "📝", create: (order) => createDefaultBlock("text", order) },
  {
    key: "bullet-list",
    label: "글머리표 목록",
    icon: "•",
    create: (order) => {
      const block = createDefaultBlock("list", order);
      return block.type === "list" ? { ...block, config: { ...block.config, style: "bullet" } } : block;
    },
  },
  {
    key: "numbered-list",
    label: "번호 목록",
    icon: "1.",
    create: (order) => {
      const block = createDefaultBlock("list", order);
      return block.type === "list" ? { ...block, config: { ...block.config, style: "numbered" } } : block;
    },
  },
  { key: "table", label: "표", icon: "▦", create: (order) => createDefaultBlock("table", order) },
];
