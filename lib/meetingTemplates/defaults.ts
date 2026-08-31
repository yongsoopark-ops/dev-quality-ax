import { BLOCK_TYPE_LABELS } from "./constants";
import type { MeetingTemplateBlock, MeetingTemplateBlockType, MeetingInfoField, TemplateTableColumn } from "./types";

/** Editor에서만 쓰는 내부 id 생성 — Template 안에서만 고유하면 되고, DB PK나
 * 다른 어떤 전역 식별자와도 무관하다. */
export function generateBlockId(): string {
  return `blk_${crypto.randomUUID()}`;
}
export function generateFieldKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

/** "블록 추가" 클릭 시 각 type에 맞는 안전한 기본 config로 새 블록을 만든다.
 * config 자체(제목 텍스트, 필드 목록 등)는 전부 빈 값/기본값이라 실제 양식
 * 내용은 여전히 ADMIN이 Editor에서 채운다 — 여기서 하드코딩하지 않는다. */
export function createDefaultBlock(type: MeetingTemplateBlockType, order: number): MeetingTemplateBlock {
  const base = {
    id: generateBlockId(),
    label: BLOCK_TYPE_LABELS[type],
    order,
    required: false,
    aiEditable: false,
    userEditable: true,
  } as const;

  switch (type) {
    case "heading":
      return { ...base, type, source: "USER", config: { level: 2, text: "새 제목" } };
    case "text":
      return { ...base, type, source: "USER", config: { placeholder: "" } };
    case "list":
      return { ...base, type, source: "USER", config: { style: "bullet", items: [] } };
    case "meeting-info":
      return { ...base, type, source: "AUTO", config: { fields: [] } };
    case "agenda-list":
      return { ...base, type, source: "USER", config: { numbered: true } };
    case "project-list":
      return { ...base, type, source: "AUTO", config: { columns: [] } };
    case "action-item-list":
      return { ...base, type, source: "AI", config: { columns: [] } };
    case "review-list":
      return { ...base, type, source: "AI", config: { accumulatesAcrossMeetings: true } };
  }
}

export function createDefaultMeetingInfoField(): MeetingInfoField {
  return { key: generateFieldKey("field"), label: "새 필드" };
}

export function createDefaultTableColumn(): TemplateTableColumn {
  return { key: generateFieldKey("col"), label: "새 열" };
}
