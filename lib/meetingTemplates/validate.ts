import type {
  ListItemNode,
  MeetingTemplateBlock,
  MeetingTemplateBlockSource,
  MeetingTemplateBlockType,
  MeetingTemplateSchema,
} from "./types";

/** Step 5B-3.2.1(목록 들여쓰기) — Tab으로 늘릴 수 있는 최대 깊이(0부터 시작).
 * 2면 0/1/2 세 단계까지 허용한다(요청사항: "최대 depth는 2~3단계 정도로
 * 제한해도 됨"). */
export const MAX_LIST_DEPTH = 2;

/**
 * DB(templateSchema)에 저장하기 전 Client가 보낸 값을 신뢰하지 않고 서버에서
 * 검증한다(lib/sidebar/validateSidebarLayout.ts와 동일한 원칙) — 하나라도
 * 위반하면 전체를 거부한다(부분 저장하지 않음).
 */
const BLOCK_TYPES: readonly MeetingTemplateBlockType[] = [
  "heading",
  "text",
  "list",
  "table",
  "meeting-info",
  "agenda-list",
  "project-list",
  "action-item-list",
  "review-list",
];

const BLOCK_SOURCES: readonly MeetingTemplateBlockSource[] = ["AUTO", "USER", "AI"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
function isString(value: unknown): value is string {
  return typeof value === "string";
}
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || isBoolean(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}
/** Step 5B-3.2.1(목록 들여쓰기) — 새 list item 형식. depth는 0 이상
 * MAX_LIST_DEPTH 이하의 정수여야 한다. */
function isListItemNode(value: unknown): value is ListItemNode {
  return isRecord(value) && isString(value.text) && Number.isInteger(value.depth) && (value.depth as number) >= 0 && (value.depth as number) <= MAX_LIST_DEPTH;
}
function isListItemArray(value: unknown): value is ListItemNode[] {
  return Array.isArray(value) && value.every(isListItemNode);
}
/** 5B-3.2.1 이전에 저장된 list block은 items가 depth 없는 문자열 배열이다 —
 * 읽을 때 전부 depth 0으로 취급해 그대로 받아들인다(하위호환). */
function normalizeListItems(items: string[] | ListItemNode[]): ListItemNode[] {
  return items.map((item) => (typeof item === "string" ? { text: item, depth: 0 } : item));
}
function isTableColumns(value: unknown): value is { key: string; label: string }[] {
  return Array.isArray(value) && value.every((c) => isRecord(c) && isString(c.key) && isString(c.label));
}
function isStringGrid(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(isStringArray);
}

function validateBaseFields(raw: Record<string, unknown>): raw is Record<string, unknown> & {
  id: string;
  type: MeetingTemplateBlockType;
  label: string;
  order: number;
  required: boolean;
  aiEditable: boolean;
  userEditable: boolean;
  source: MeetingTemplateBlockSource;
} {
  return (
    isString(raw.id) &&
    raw.id.trim() !== "" &&
    isString(raw.type) &&
    (BLOCK_TYPES as string[]).includes(raw.type) &&
    isString(raw.label) &&
    isFiniteNumber(raw.order) &&
    isBoolean(raw.required) &&
    isBoolean(raw.aiEditable) &&
    isBoolean(raw.userEditable) &&
    isString(raw.source) &&
    (BLOCK_SOURCES as string[]).includes(raw.source)
  );
}

function validateConfig(type: MeetingTemplateBlockType, config: unknown): boolean {
  if (!isRecord(config)) return false;
  switch (type) {
    case "heading":
      return (config.level === 1 || config.level === 2 || config.level === 3) && isString(config.text) && isOptionalString(config.icon);
    case "text":
      return isOptionalString(config.text) && isOptionalString(config.placeholder);
    case "list":
      return (
        (config.style === "bullet" || config.style === "numbered") &&
        (config.items === undefined || isListItemArray(config.items) || isStringArray(config.items)) &&
        isOptionalString(config.icon)
      );
    case "table":
      return isStringGrid(config.rows);
    case "meeting-info":
      return (
        Array.isArray(config.fields) &&
        config.fields.every((f) => isRecord(f) && isString(f.key) && isString(f.label) && isOptionalString(f.icon)) &&
        isOptionalString(config.icon)
      );
    case "agenda-list":
      return isOptionalBoolean(config.numbered) && isOptionalString(config.icon);
    case "project-list":
    case "action-item-list":
      return isTableColumns(config.columns) && isOptionalString(config.icon);
    case "review-list":
      return isOptionalBoolean(config.accumulatesAcrossMeetings) && isOptionalString(config.icon);
  }
}

/** raw는 JSON.parse 직후(또는 Client가 그대로 보낸) 신뢰할 수 없는 값이다.
 * id 중복, 정의되지 않은 type/source, block별 config 형태까지 전부 확인한 뒤
 * 통과한 값만 MeetingTemplateSchema로 취급한다. */
export function validateMeetingTemplateSchema(raw: unknown): MeetingTemplateSchema | null {
  if (!Array.isArray(raw)) return null;

  const seenIds = new Set<string>();
  const result: MeetingTemplateBlock[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    if (!validateBaseFields(entry)) return null;
    if (seenIds.has(entry.id)) return null;
    seenIds.add(entry.id);
    if (!validateConfig(entry.type, entry.config)) return null;

    // 5B-3.2.1: list block의 items가 예전(depth 없는 문자열) 형식이면 여기서
    // depth 0으로 정규화해, 이후로는 항상 ListItemNode[] 형태만 다루면 되게 한다.
    let config = entry.config as Record<string, unknown>;
    if (entry.type === "list" && Array.isArray(config.items)) {
      config = { ...config, items: normalizeListItems(config.items as string[] | ListItemNode[]) };
    }

    result.push({
      id: entry.id,
      type: entry.type,
      label: entry.label,
      order: entry.order,
      required: entry.required,
      aiEditable: entry.aiEditable,
      userEditable: entry.userEditable,
      source: entry.source,
      config,
    } as MeetingTemplateBlock);
  }

  return result;
}
