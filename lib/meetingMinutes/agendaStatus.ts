import { MEETING_FIELD_KEY, resolveFieldKey } from "./fieldSemantics";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(Schedule/Meeting Minutes V1.1 사용성 개선 — 주요 안건 완료/미결) —
 * "완료 여부" 값 셀은 실제 DB를 조회해 확인한 결과 인터랙티브 체크박스가
 * 아니라 그냥 고정 텍스트("☐")였다 — 클릭해도 반응이 없던 원인. checkbox
 * 표현을 완전히 없애고 "완료"|"미결" 텍스트 중 하나로 통일한다. 이 값을
 * 여전히 평범한 tableCell 안의 paragraph 텍스트로만 저장하므로(새 Tiptap
 * Node/NodeView를 만들지 않는다) 기존 문서 구조·DOCX 변환(docx.ts는 셀
 * 텍스트를 그대로 옮길 뿐이라 별도 처리가 필요 없다) 어느 쪽도 바뀌지
 * 않는다 — "새로운 대규모 구조 개편은 하지 않는다"는 원칙을 따른다.
 */
export const AGENDA_DONE_LABEL = { DONE: "완료", PENDING: "미결" } as const;
export type AgendaDoneLabel = (typeof AGENDA_DONE_LABEL)[keyof typeof AGENDA_DONE_LABEL];

export function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(extractText).join("");
  return "";
}

/** 기존 checkbox 시절 값("☑"/"☐"/빈 값)과 신규 값("완료"/"미결")을 전부
 * "완료"|"미결" 중 하나로 정규화한다 — "☑"만 완료로 보고, 그 외(체크
 * 안 된 "☐", 빈 문자열, 그 밖의 임의 텍스트)는 전부 미결로 본다(안전한
 * 기본값 — 상태를 알 수 없으면 아직 해결 안 된 것으로 취급). */
export function normalizeAgendaDoneText(rawText: string): AgendaDoneLabel {
  const trimmed = rawText.trim();
  return trimmed === AGENDA_DONE_LABEL.DONE || trimmed === "☑" ? AGENDA_DONE_LABEL.DONE : AGENDA_DONE_LABEL.PENDING;
}

function agendaDoneValueCellOf(row: JSONContent): JSONContent | null {
  if (row.type !== "tableRow" || !Array.isArray(row.content) || row.content.length < 2) return null;
  if (resolveFieldKey(row.content[0]) !== MEETING_FIELD_KEY.AGENDA_DONE) return null;
  return row.content[1];
}

/**
 * documentContent 전체를 훑어 모든 AGENDA_DONE 값 셀의 텍스트를 정규화한다
 * (요청사항: "기존 checkbox 기반 Draft 호환") — Draft를 읽어올 때마다(조회/
 * 초기화 직후) 호출해, DB를 별도로 일괄 migration하지 않고도 다음 조회부터
 * 자연스럽게 새 표기로 보이게 한다(attachMissingFieldKeyAttributes와 같은
 * "다음 저장부터 자연히 채워짐" 정책). 그 외 셀/텍스트는 전혀 건드리지
 * 않는다.
 */
export function normalizeAgendaDoneCells(doc: JSONContent): { document: JSONContent; changed: boolean } {
  const cloned: JSONContent = JSON.parse(JSON.stringify(doc));
  let changed = false;

  function walk(node: JSONContent) {
    if (node.type === "tableRow") {
      const valueCell = agendaDoneValueCellOf(node);
      if (valueCell) {
        const current = extractText(valueCell).trim();
        const normalized = normalizeAgendaDoneText(current);
        if (current !== normalized) {
          valueCell.content = [{ type: "paragraph", content: [{ type: "text", text: normalized }] }];
          changed = true;
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  }

  if (Array.isArray(cloned.content)) {
    for (const node of cloned.content) walk(node);
  }
  return { document: cloned, changed };
}
