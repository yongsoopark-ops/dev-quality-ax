import type { JSONContent } from "@tiptap/core";

/**
 * Step(Schedule/Meeting Minutes V1.1 사용성 개선 — 프로젝트명 일괄 변경) —
 * build.ts는 프로젝트 그룹 병합 key로 projectName(= H3 heading 텍스트)을
 * 그대로 쓴다. Schedule에서 Task.projectName만 바꾸고 끝내면, 다음 "일정
 * 불러오기" 때 기존 이름 H3 블록은 "orphan"으로 그대로 보존되고 새 이름의
 * H3 블록이 새로 생겨 같은 프로젝트가 내용이 갈라진 채 중복 표시된다.
 *
 * 그래서 프로젝트명을 바꿀 때 이 함수로 Meeting Minutes Draft의 H3 heading
 * 텍스트도 함께 맞춰 준다 — H3는 build.ts가 프로젝트/업무명에만 쓰는
 * level이라(회의 규칙/주요 안건/AUTO 5개 섹션은 전부 level 1~2) 이 level
 * 제약 + "텍스트 정확히 일치"만으로 프로젝트명 heading을 안전하게 좁힐 수
 * 있다. heading의 텍스트만 바꾸고 그 아래 AUTO/USER Table 내용은 절대
 * 건드리지 않으므로, "회의록 USER/AI 내용을 잃지 않는 것이 최우선"이라는
 * 요청사항을 만족한다 — Ctrl+H 같은 전체 문자열 치환이 아니다.
 */
export function renameProjectHeadingInDocument(doc: JSONContent, oldName: string, newName: string): { document: JSONContent; changed: boolean } {
  const cloned: JSONContent = JSON.parse(JSON.stringify(doc));
  let changed = false;

  function textOf(node: JSONContent): string {
    if (node.type === "text") return node.text ?? "";
    if (Array.isArray(node.content)) return node.content.map(textOf).join("");
    return "";
  }

  function walk(node: JSONContent) {
    if (node.type === "heading" && node.attrs?.level === 3 && textOf(node).trim() === oldName) {
      node.content = [{ type: "text", text: newName }];
      changed = true;
      return;
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
