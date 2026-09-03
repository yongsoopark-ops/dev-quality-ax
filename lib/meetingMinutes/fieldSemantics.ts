import { normalizeHeadingText } from "./sectionHeadings";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(파트 주간회의 Table UX + AUTO 필드 개편) — 문서를 Table 기반으로
 * 바꿔도 다시 표시 텍스트 exact-match에 의존하지 않는다(요청사항). heading의
 * meetingSection과 완전히 같은 철학으로, Table의 "라벨 셀"(구분 열)에
 * 사용자에게 보이지 않는 내부 attribute(attrs.fieldKey)를 부여해 식별한다.
 * heading normalize 로직(normalizeHeadingText)을 그대로 재사용한다 — "맨 앞
 * 이모지/기호 제거 후 정규화된 텍스트 비교"라는 규칙이 heading과 Table 라벨
 * 셀 모두에 동일하게 적용된다.
 */

export const MEETING_FIELD_KEY = {
  // 회의 기본정보 3x4 Table
  MEETING_WEEK: "MEETING_WEEK",
  TARGET_RANGE: "TARGET_RANGE",
  MEETING_DATETIME: "MEETING_DATETIME",
  MEETING_LOCATION: "MEETING_LOCATION",
  ATTENDEES: "ATTENDEES",
  ABSENTEES: "ABSENTEES",
  // Step(AUTO/작성 영역 분리 + 표 열 비율 조정) — 담당자는 이제 "구분 |
  // 내용" 작성 Table의 행이 아니라 Schedule AUTO Table(업무명 | 진행 일정 |
  // 담당자)의 열 헤더다. AUTO Table은 매번 통째로 재생성되어 보존이
  // 필요 없으므로 그 헤더 셀 자체에는 fieldKey를 붙이지 않는다. 다만 이
  // 문서 전체를 훑는 자동 태깅(attachMissingFieldKeyAttributes)이 텍스트
  // "담당자"만 보고 그 헤더 셀에도 OWNER를 붙일 수 있는데, 그 값을 실제로
  // 읽는 코드가 없어(AUTO Table은 fieldKey를 보지 않고 통째로 교체) 무해한
  // 잔여물일 뿐이다. OWNER 키 자체는 과거 구조의 흔적이자 향후 "구분 |
  // 내용" 형태 Table에 담당자 행이 다시 필요해질 경우를 위해 남겨 둔다.
  OWNER: "OWNER",
  DELIVERABLE: "DELIVERABLE",
  PROGRESS: "PROGRESS",
  SPECIAL_NOTE: "SPECIAL_NOTE",
  DECISION: "DECISION",
  NEXT_SCHEDULE: "NEXT_SCHEDULE",
  // Step(주요 안건 세로형 구조 개편) — 안건 1개 = "구분 | 내용" Table(프로젝트
  // Table과 같은 모양). 향후 Clova TXT + AI/carry-forward가 이 값들을 쓸 수
  // 있게 지금부터 semantic key를 부여한다(요청사항: "동일 구조를 사용할 수
  // 있게").
  AGENDA_TITLE: "AGENDA_TITLE",
  AGENDA_CONTENT: "AGENDA_CONTENT",
  AGENDA_DECISION: "AGENDA_DECISION",
  AGENDA_OWNER: "AGENDA_OWNER",
  AGENDA_DONE: "AGENDA_DONE",
} as const;

export type MeetingFieldKey = (typeof MEETING_FIELD_KEY)[keyof typeof MEETING_FIELD_KEY];

/** 라벨 셀의 정규화된 표시 텍스트 ↔ semantic key 대응표. 저장 시 자동 태깅
 * (attachMissingFieldKeyAttributes)과 legacy fallback 조회(resolveFieldKey)
 * 양쪽에서 쓴다. */
export const FIELD_KEY_LABELS: { key: MeetingFieldKey; label: string }[] = [
  { key: MEETING_FIELD_KEY.MEETING_WEEK, label: "회의 주차" },
  { key: MEETING_FIELD_KEY.TARGET_RANGE, label: "대상 주간" },
  { key: MEETING_FIELD_KEY.MEETING_DATETIME, label: "회의 일시" },
  { key: MEETING_FIELD_KEY.MEETING_LOCATION, label: "회의 장소" },
  { key: MEETING_FIELD_KEY.ATTENDEES, label: "참석자" },
  { key: MEETING_FIELD_KEY.ABSENTEES, label: "미참 인원" },
  { key: MEETING_FIELD_KEY.OWNER, label: "담당자" },
  { key: MEETING_FIELD_KEY.DELIVERABLE, label: "산출물" },
  { key: MEETING_FIELD_KEY.PROGRESS, label: "진행 현황" },
  { key: MEETING_FIELD_KEY.SPECIAL_NOTE, label: "특이 사항" },
  { key: MEETING_FIELD_KEY.DECISION, label: "결정 내용" },
  { key: MEETING_FIELD_KEY.NEXT_SCHEDULE, label: "향후 일정" },
  { key: MEETING_FIELD_KEY.AGENDA_TITLE, label: "안건명" },
  { key: MEETING_FIELD_KEY.AGENDA_CONTENT, label: "주요 내용" },
  { key: MEETING_FIELD_KEY.AGENDA_DECISION, label: "결정사항" },
  { key: MEETING_FIELD_KEY.AGENDA_DONE, label: "완료 여부" },
  // AGENDA_OWNER는 일부러 여기 등록하지 않는다 — 안건 Table의 "담당자"
  // 라벨이 프로젝트 Table의 "담당자"(OWNER)와 문자열이 완전히 같아서,
  // 텍스트 fallback만으로는 둘을 구분할 방법이 없다. 그래서 안건 Table을
  // 만들 때(이 파일이 아니라 실제 Template 저장 시점)는 항상 attrs.fieldKey
  // = "AGENDA_OWNER"를 명시적으로 미리 넣어 두고, attachMissingFieldKeyAttributes
  // 는 "이미 유효한 fieldKey가 있으면 절대 덮어쓰지 않는다"는 규칙대로 그
  // 값을 그대로 유지한다 — 텍스트 fallback 조회는 이 key에 한해서만 쓰지
  // 않는다(현재 이 값을 프로그램적으로 읽는 로직이 없어 당장 영향도 없다).
];

const VALID_FIELD_KEYS = new Set<string>(Object.values(MEETING_FIELD_KEY));

function extractCellText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(extractCellText).join("");
  return "";
}

export function matchFieldKeyByLabel(rawText: string): MeetingFieldKey | null {
  const normalized = normalizeHeadingText(rawText);
  return FIELD_KEY_LABELS.find((d) => d.label === normalized)?.key ?? null;
}

/** tableCell/tableHeader 노드 하나의 semantic field key를 판별한다 —
 * attrs.fieldKey가 유효하면 최우선, 없으면 정규화된 셀 텍스트로 legacy
 * fallback한다. */
export function resolveFieldKey(cellNode: JSONContent): MeetingFieldKey | null {
  const attrValue = cellNode.attrs?.fieldKey;
  if (typeof attrValue === "string" && VALID_FIELD_KEYS.has(attrValue)) {
    return attrValue as MeetingFieldKey;
  }
  return matchFieldKeyByLabel(extractCellText(cellNode));
}

/** documentContent 전체를 재귀 순회하며, semantic attribute가 아직 없는
 * 라벨 셀에 한해서만 정규화 텍스트로 추론해 attrs.fieldKey를 채워 넣는다.
 * meetingSection의 attachMissingMeetingSectionAttributes와 완전히 같은
 * 정책이다 — Template을 강제로 일괄 마이그레이션하지 않고, 다음 저장부터
 * 자연스럽게 채워진다. */
export function attachMissingFieldKeyAttributes(documentContent: JSONContent): JSONContent {
  const cloned: JSONContent = JSON.parse(JSON.stringify(documentContent));

  function walk(node: JSONContent) {
    if (node.type === "tableCell" || node.type === "tableHeader") {
      const already = node.attrs?.fieldKey;
      if (!(typeof already === "string" && VALID_FIELD_KEYS.has(already))) {
        const inferred = matchFieldKeyByLabel(extractCellText(node));
        if (inferred) {
          node.attrs = { ...(node.attrs ?? {}), fieldKey: inferred };
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  }

  walk(cloned);
  return cloned;
}

export interface FieldRowRef {
  row: JSONContent;
  labelCellIndex: number;
  valueCellIndex: number;
}

/** 문서(또는 Table 하나) 안에서 라벨 셀이 key로 판별되는 첫 행을 찾는다 —
 * "라벨 | 값"이 같은 행에서 바로 옆 칸이라는 규칙(회의 기본정보 3x4 Table,
 * 프로젝트 "구분 | 내용" Table 둘 다 이 규칙을 따른다)에 기반한다. */
export function findFieldRow(root: JSONContent, key: MeetingFieldKey): FieldRowRef | null {
  let found: FieldRowRef | null = null;

  function walk(node: JSONContent) {
    if (found) return;
    if (node.type === "tableRow" && Array.isArray(node.content)) {
      for (let i = 0; i < node.content.length; i++) {
        const cell = node.content[i];
        if ((cell.type === "tableCell" || cell.type === "tableHeader") && resolveFieldKey(cell) === key) {
          if (i + 1 < node.content.length) found = { row: node, labelCellIndex: i, valueCellIndex: i + 1 };
          return;
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  }

  walk(root);
  return found;
}

/** Table 하나(프로젝트 "구분 | 내용" Table)의 행들을, 첫 칸(라벨 셀)이
 * 판별하는 field key로 색인한다 — 재클릭 병합 시 "이 프로젝트에 이미 있던
 * 행"을 찾는 데 쓴다(injectDocument.ts). */
export function indexTableRowsByFieldKey(table: JSONContent): Map<MeetingFieldKey, JSONContent> {
  const map = new Map<MeetingFieldKey, JSONContent>();
  for (const row of table.content ?? []) {
    if (row.type !== "tableRow" || !Array.isArray(row.content) || row.content.length === 0) continue;
    const key = resolveFieldKey(row.content[0]);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}
