import { FIELD_KEY_LABELS, findFieldRow, type MeetingFieldKey } from "./fieldSemantics";
import type { JSONContent } from "@tiptap/core";

/**
 * Step 5B-10(회의록 Preview 기본정보 자동입력) → Step(파트 주간회의 Table
 * UX + AUTO 필드 개편) — 기본정보가 hardBreak로 이어붙인 문단 6줄에서
 * 3행×4열 Table(회의 주차/대상 주간/회의 일시/회의 장소/참석자/미참 인원)
 * 로 바뀌었다. 라벨 문단 텍스트를 찾던 예전 방식 대신, 라벨 셀의 semantic
 * fieldKey(lib/meetingMinutes/fieldSemantics.ts)로 "라벨 | 값" 행을 찾아
 * 바로 옆 값 셀만 교체한다 — Table로 바뀌었다고 다시 표시 텍스트
 * exact-match에 의존하지 않는다(요청사항).
 *
 * 참석자/미참 인원은 실제 참석 기준이라 이번 Step에서도 USER 작성 영역으로
 * 남긴다(요청사항) — 호출부가 이 두 field를 아예 넘기지 않으면 이 함수는
 * 그 두 라벨을 찾지도, 건드리지도 않는다.
 */

export interface MeetingInfoField {
  key: MeetingFieldKey;
  /** null/undefined면 이 필드는 값이 없다는 뜻 — 라벨 행을 찾아도 아무것도
   * 쓰지 않고 건드리지 않는다. */
  value: string | null | undefined;
}

function textNodes(text: string): JSONContent[] {
  return text ? [{ type: "text", text }] : [];
}

export interface MeetingInfoInjectionResult {
  document: JSONContent;
  /** 값이 있어서 실제로 채우려 했는데 그 fieldKey의 라벨 행을 문서에서
   * 못 찾은 필드(사용자에게 보여줄 라벨 이름으로 담는다). */
  missingFields: string[];
  filledFields: string[];
}

/**
 * documentContent를 deep clone한 뒤 그 clone에만 채운다(Template DB는 절대
 * 건드리지 않는다).
 */
export function injectMeetingInfoFields(documentContent: JSONContent, fields: MeetingInfoField[]): MeetingInfoInjectionResult {
  const cloned: JSONContent = JSON.parse(JSON.stringify(documentContent));

  const missingFields: string[] = [];
  const filledFields: string[] = [];

  for (const field of fields) {
    if (!field.value) continue; // 채울 값 자체가 없으면 찾지도, 보고하지도 않는다.

    const label = FIELD_KEY_LABELS.find((d) => d.key === field.key)?.label ?? field.key;
    const ref = findFieldRow(cloned, field.key);
    if (!ref) {
      missingFields.push(label);
      continue;
    }

    const valueCell = ref.row.content?.[ref.valueCellIndex];
    if (!valueCell) {
      missingFields.push(label);
      continue;
    }
    valueCell.content = [{ type: "paragraph", content: textNodes(field.value) }];
    filledFields.push(label);
  }

  return { document: cloned, missingFields, filledFields };
}
