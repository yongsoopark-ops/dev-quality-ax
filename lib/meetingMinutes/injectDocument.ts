import { resolveHeadingSection } from "./sectionHeadings";
import { FIELD_KEY_LABELS, MEETING_FIELD_KEY, indexTableRowsByFieldKey, type MeetingFieldKey } from "./fieldSemantics";
import type { AssigneeGroup, SectionGroup, SectionResult } from "./build";
import type { JSONContent } from "@tiptap/core";

/**
 * Step 5B-9(주간 파트 회의록 Preview) → Step(파트 주간회의 Table UX + AUTO
 * 필드 개편) — 문서에서 heading을 찾아 그 섹션(그 heading부터 바로 다음
 * 섹션 heading 전까지)의 내용을 실제 데이터로 반영한다. 대상은 정규
 * 프로젝트/서브 프로젝트/예외 업무/출장 업무/공통 업무 5개 섹션뿐이고, 그
 * 외(회의 규칙/주요 안건/미결 업무 등)는 이 함수가 인덱스조차 계산하지
 * 않으므로 절대 손대지 않는다.
 *
 * 이번 Step에서 프로젝트/업무 하나당 구조가 "문단 나열"에서 다음 Table
 * 기반 구조로 바뀌었다:
 *   H3(프로젝트명)
 *   Table(AUTO) — 업무명 | 진행 일정 | 담당자, Schedule Task 1건당 1행
 *   Table(작성) — 구분 | 내용, 산출물/진행 현황/특이 사항(USER)/결정 내용/
 *                 향후 일정(AI 향후 작성) 5행 고정
 *
 * Step(AUTO/작성 영역 분리 + 표 열 비율 조정) — 담당자가 "구분 | 내용"
 * Table의 행에서 AUTO Table의 열로 옮겨갔다(요청사항: "Schedule AUTO
 * 영역과 회의 작성 영역을 시각적으로 분리" + "업무명/진행일정/담당자는
 * 같은 행의 한 세트"). 그래서 작성 Table은 이제 항상 AUTO 값(담당자) 없이
 * 순수 USER/AI 5행만 담고, 재클릭 시 통째로 새로 만드는 AUTO Table과
 * 달리 이 5행은 fieldKey로 찾아 원본 그대로 옮긴다.
 *
 * 재클릭 병합 정책은 그대로 유지된다: 그룹명(H3)이 같으면 AUTO Table은
 * 통째로 새로 만들고(Schedule 원본 그대로 — 업무명/진행 일정/담당자 세
 * 값 모두 매번 최신으로 교체), 작성 Table의 5행은 라벨 셀의 semantic
 * fieldKey로 찾아 원본 그대로 옮긴다(절대 덮어쓰지 않음). 그룹명이
 * 사라졌지만(이번 주 대상에서 빠짐) 사용자가 실제로 뭔가 적어 둔 프로젝트는
 * 두 Table 전체를 그대로 맨 뒤에 보존한다.
 */

const USER_AI_FIELD_ORDER: MeetingFieldKey[] = [
  MEETING_FIELD_KEY.DELIVERABLE,
  MEETING_FIELD_KEY.PROGRESS,
  MEETING_FIELD_KEY.SPECIAL_NOTE,
  MEETING_FIELD_KEY.DECISION,
  MEETING_FIELD_KEY.NEXT_SCHEDULE,
];

function fieldLabel(key: MeetingFieldKey): string {
  return FIELD_KEY_LABELS.find((d) => d.key === key)?.label ?? key;
}

function textNodes(text: string): JSONContent[] {
  return text ? [{ type: "text", text }] : [];
}

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(extractText).join("");
  return "";
}

function paragraphCell(text: string, attrs?: Record<string, unknown>): JSONContent {
  return { type: "tableCell", ...(attrs ? { attrs } : {}), content: [{ type: "paragraph", content: textNodes(text) }] };
}

function headerCell(text: string): JSONContent {
  return { type: "tableHeader", content: [{ type: "paragraph", content: textNodes(text) }] };
}

/** Schedule AUTO Table(업무명 | 진행 일정 | 담당자) — 그룹에 속한 Task
 * 1건당 1행, 통째로 새로 만든다(재클릭 시에도 항상 최신 Schedule로 완전히
 * 교체 — "업무명/진행 일정/담당자는 반드시 같은 행에" 요청사항을 만족하려면
 * 부분 수정이 아니라 매번 전체를 다시 만드는 편이 안전하다). attrs.tableRole
 * = "auto"를 표 자체에 태깅해 CSS(app/globals.css)가 이 표를 compact
 * 폭으로 식별하게 한다(TemplateRichTextEditor.tsx의 TableRoleAttribute
 * 주석 참고 — :has() 구조 추론 대신 명시적 attribute를 쓰는 이유). */
function buildTaskAutoTable(tasks: SectionGroup["tasks"]): JSONContent {
  return {
    type: "table",
    attrs: { tableRole: "auto" },
    content: [
      { type: "tableRow", content: [headerCell("업무명"), headerCell("진행 일정"), headerCell("담당자")] },
      ...tasks.map(
        (t) =>
          ({
            type: "tableRow",
            content: [paragraphCell(t.title), paragraphCell(t.period), paragraphCell(t.assignees.length > 0 ? t.assignees.join(", ") : "미지정")],
          }) as JSONContent,
      ),
    ],
  };
}

function buildFieldRow(key: MeetingFieldKey, value: string): JSONContent {
  return {
    type: "tableRow",
    content: [paragraphCell(fieldLabel(key), { fieldKey: key }), paragraphCell(value)],
  };
}

/** "구분 | 내용" 작성 Table — 담당자는 더 이상 여기 없다(AUTO Table의
 * 열로 이동). 맨 위에 "구분 | 내용" header 행을 두고(요청사항: "header
 * row가 누락돼 있다, 반드시 추가"), 그 아래 5행(산출물/진행 현황/특이
 * 사항/결정 내용/향후 일정)은 기존 Table에 있던 행을 fieldKey로 찾아
 * 그대로(서식 포함) 옮기고, 기존 Table 자체가 없으면(새 프로젝트) 전부
 * 빈 값으로 새로 만든다 — AUTO Table과 달리 이 Table은 재클릭해도 절대
 * 덮어쓰지 않는다. header 행의 "구분"/"내용" 셀은 어떤 fieldKey로도
 * 판별되지 않으므로(FIELD_KEY_LABELS에 없음) indexTableRowsByFieldKey가
 * 자동으로 건너뛴다 — 매번 새로 만들어도 무방하다. */
function buildUserAiTable(existingTable: JSONContent | null): JSONContent {
  const existingRows = existingTable ? indexTableRowsByFieldKey(existingTable) : new Map<MeetingFieldKey, JSONContent>();
  const headerRow: JSONContent = { type: "tableRow", content: [headerCell("구분"), headerCell("내용")] };
  const rows = USER_AI_FIELD_ORDER.map((key) => {
    const existing = existingRows.get(key);
    return existing ? (JSON.parse(JSON.stringify(existing)) as JSONContent) : buildFieldRow(key, "");
  });
  return { type: "table", content: [headerRow, ...rows] };
}

/** 담당자 구간 표시("👤 이름") — 진짜 heading이 아니라 굵은 문단이다.
 * heading level은 1~3만 쓰기로 정해져 있어(TemplateRichTextEditor.tsx)
 * "업무구분(H2) → 담당자 → 프로젝트(H3)" 3단 구조에 쓸 수 있는 heading
 * level이 없다 — 그래서 담당자 구간은 굵은 문단으로 표시한다. AUTO
 * 영역이라 항상 통째로 재생성되므로(재클릭해도 절대 보존할 필요가 없는
 * 영역) fieldKey 같은 semantic attribute도 필요 없고, "👤 " 접두사
 * 텍스트만으로 다음 재클릭 때 "이 문단은 담당자 구간 표시였다"를 다시
 * 인식하면 충분하다(isAssigneeHeaderParagraph). */
const ASSIGNEE_HEADER_PREFIX = "👤 ";
const UNASSIGNED_LABEL = "담당자 미지정";
/** Step(V1 Fix — 회의록 공통 일정 그룹 분리) — Schedule의 "공통" assigneeMode
 * 라벨("직접 지정"/"공통"/"내 일정" 중 하나, TaskDetailPanel.tsx MODE_LABELS)
 * 과 동일한 표기를 그대로 쓴다. "담당자 미지정"과 겹치지 않는 별도 문자열이라
 * 재클릭 병합 key("라벨::프로젝트명")도 서로 충돌하지 않는다. */
const COMMON_LABEL = "공통";

/** AssigneeGroup 하나의 표시 라벨을 계산한다 — assigneeName이 있으면 그
 * 이름, 없으면 isCommon 여부로 "공통"/"담당자 미지정"을 구분한다(요청사항
 * 3: visible label만으로 판단하지 않는다 — 여기서는 반대로 semantic
 * 필드에서 label을 만드는 방향이라 label 자체가 항상 isCommon과 일치한다). */
function resolveAssigneeGroupLabel(group: Pick<AssigneeGroup, "assigneeName" | "isCommon">): string {
  if (group.assigneeName) return group.assigneeName;
  return group.isCommon ? COMMON_LABEL : UNASSIGNED_LABEL;
}
/** Step(일정 관리 + 회의록 UI Polish) — 담당자 header에 업무 건수를 덧붙인다
 * (요청사항 11: "👤 박용수 · 3건"). 이 접미사는 매 재클릭마다 최신 건수로
 * 다시 계산되는 "표시용" 정보일 뿐이라, 재클릭 병합의 key로는 절대 쓰면
 * 안 된다 — 건수가 바뀔 때마다 key가 달라지면 담당자 라벨이 매번 "새
 * 담당자"로 오인되어 작성 Table의 fieldKey 보존이 깨진다. 그래서
 * splitIntoGroupBlocks가 key를 계산할 때는 이 접미사를 반드시 먼저
 * 제거한다(아래 정규식). */
const ASSIGNEE_COUNT_SUFFIX_RE = / · \d+건$/;

function buildAssigneeHeaderParagraph(label: string, taskCount: number): JSONContent {
  return {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: `${ASSIGNEE_HEADER_PREFIX}${label} · ${taskCount}건`,
        marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "15px" } }],
      },
    ],
  };
}

function isAssigneeHeaderParagraph(node: JSONContent): boolean {
  return node.type === "paragraph" && extractText(node).startsWith(ASSIGNEE_HEADER_PREFIX);
}

/** "👤 이름 · N건" 표시 문단에서 병합 key로 쓸 순수 이름만 뽑는다(건수
 * 접미사는 위 주석대로 key에서 제외). */
function extractAssigneeLabelForKey(node: JSONContent): string {
  return extractText(node).slice(ASSIGNEE_HEADER_PREFIX.length).replace(ASSIGNEE_COUNT_SUFFIX_RE, "").trim();
}

function buildGroupBlock(group: SectionGroup, existing: ExistingGroupBlock | undefined): JSONContent[] {
  return [
    { type: "heading", attrs: { level: 3 }, content: textNodes(group.title) },
    buildTaskAutoTable(group.tasks),
    { type: "paragraph" },
    buildUserAiTable(existing?.userAiTable ?? null),
  ];
}

interface ExistingGroupBlock {
  /** "담당자 라벨::프로젝트명" — 재클릭 시 같은 담당자 아래 같은
   * 프로젝트를 정확히 다시 찾기 위한 합성 key다(요청사항: "담당자별 그룹
   * 구조가 바뀌더라도 fieldKey/semantic identity 기준으로 안전하게 보존,
   * 단순 화면 위치/index 기준 병합 금지"). 프로젝트 자체는 이름(title)만
   * 으로 이미 고유하게 식별되지만, 같은 프로젝트가 이번 주와 지난주에
   * 서로 다른 담당자 버킷에 속하게 될 수도 있어 담당자 라벨까지 key에
   * 포함해 정확도를 높인다. 직전에 만난 "👤 " 문단이 아직 없었던(레거시
   * 문서, 담당자 구조 도입 이전) 경우 라벨은 빈 문자열이다. */
  key: string;
  title: string;
  /** heading부터 다음 heading(또는 섹션 끝) 전까지의 노드 전부 — 그룹명이
   * 이번 조회에서 사라졌을 때(orphan) 통째로 그대로 보존하는 데 쓴다. */
  allNodes: JSONContent[];
  /** 이 블록 안에서 두 번째로 나오는 Table — buildGroupBlock이 항상
   * [H3, AUTO Table, 문단, USER/AI Table] 순서로 만들기 때문에, 두 번째
   * Table이 곧 "구분 | 내용"(USER/AI) Table이다. */
  userAiTable: JSONContent | null;
}

/** 섹션 body를 "프로젝트명 H3로 시작하는 블록들"로 나눈다 — 이 과정에서
 * "👤 이름" 문단(담당자 구간 표시)은 블록으로 만들지 않고, 그 뒤에 나오는
 * H3 블록들의 key 접두사(담당자 라벨)로만 쓴다. buildGroupBlock이 항상
 * 이 모양으로 쓰기 때문에(그룹명 heading 없이 바로 Table이 오는 legacy
 * Template 원본은 애초에 어떤 새 그룹명과도 일치하지 않아 그대로 버려진다
 * — 첫 클릭 때의 정상 동작). */
function splitIntoGroupBlocks(nodes: JSONContent[]): ExistingGroupBlock[] {
  const blocks: ExistingGroupBlock[] = [];
  let current: ExistingGroupBlock | null = null;
  let tablesSeen = 0;
  let currentAssigneeLabel = "";

  for (const node of nodes) {
    if (isAssigneeHeaderParagraph(node)) {
      currentAssigneeLabel = extractAssigneeLabelForKey(node);
      continue;
    }
    if (node.type === "heading" && node.attrs?.level === 3) {
      const title = extractText(node).trim();
      current = { key: `${currentAssigneeLabel}::${title}`, title, allNodes: [node], userAiTable: null };
      tablesSeen = 0;
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    current.allNodes.push(node);
    if (node.type === "table") {
      tablesSeen += 1;
      if (tablesSeen === 2) current.userAiTable = node;
    }
  }
  return blocks;
}

/** 작성(구분 | 내용) Table에 실제로 값이 채워진 행이 하나라도 있는지 —
 * 전부 빈 라벨뿐이면(한 번도 값이 채워진 적 없는 legacy placeholder 등)
 * 보존할 가치가 없다고 본다. 담당자는 이제 이 Table에 없으므로(AUTO
 * Table로 이동) 제외할 필요도 없다. */
function hasProtectableContent(table: JSONContent | null): boolean {
  if (!table) return false;
  const rowsByKey = indexTableRowsByFieldKey(table);
  for (const [, row] of rowsByKey) {
    const valueCell = row.content?.[1];
    if (valueCell && extractText(valueCell).trim().length > 0) return true;
  }
  return false;
}

/**
 * 섹션 하나의 기존 body(existingContentNodes)와 이번에 새로 조회한 담당자별
 * 그룹(newAssigneeGroups)을 "담당자 라벨::프로젝트명" key 기준으로 병합한다
 * (요청사항: "단순 화면 위치/index 기준 병합 금지"). 첫 클릭/재클릭을 구분
 * 하는 별도 분기는 없다 — 첫 클릭 시 기존 그룹명은 Template의 "프로젝트명"
 * 예시뿐이라 실제 Schedule 그룹명과 절대 같을 수 없으므로 자연히 전부 새로
 * 채워진다.
 */
function mergeSectionBody(existingContentNodes: JSONContent[], newAssigneeGroups: AssigneeGroup[]): JSONContent[] {
  const existingBlocks = splitIntoGroupBlocks(existingContentNodes);
  const existingByKey = new Map<string, ExistingGroupBlock>();
  for (const block of existingBlocks) {
    if (!existingByKey.has(block.key)) existingByKey.set(block.key, block);
  }

  const usedKeys = new Set<string>();
  const nodes: JSONContent[] = [];
  let wroteAny = false;

  for (const assigneeGroup of newAssigneeGroups) {
    if (assigneeGroup.groups.length === 0) continue;
    const assigneeLabel = resolveAssigneeGroupLabel(assigneeGroup);
    const taskCount = assigneeGroup.groups.reduce((sum, g) => sum + g.tasks.length, 0);

    // Step(일정 관리 + 회의록 UI Polish) — 담당자 그룹 사이 여백 확대
    // (요청사항 11: "충분한 여백") — 문단 하나(스타일상 한 줄 정도)로는
    // 부족해 빈 문단 2개로 이전 Step보다 더 뚜렷하게 띄운다.
    if (wroteAny) {
      nodes.push({ type: "paragraph" });
      nodes.push({ type: "paragraph" });
    }
    wroteAny = true;
    nodes.push(buildAssigneeHeaderParagraph(assigneeLabel, taskCount));

    assigneeGroup.groups.forEach((group) => {
      const key = `${assigneeLabel}::${group.title}`;
      usedKeys.add(key);
      nodes.push({ type: "paragraph" }); // 담당자 표시와 첫 프로젝트 사이, 프로젝트 사이 여백
      nodes.push(...buildGroupBlock(group, existingByKey.get(key)));
    });
  }

  // orphan(이번 주 대상에서 사라진 프로젝트) — 어느 담당자 밑에도 다시
  // 넣을 수 없으므로(이번 주 데이터에 없다) 섹션 맨 끝에 그대로 이어 붙인다.
  for (const block of existingBlocks) {
    if (usedKeys.has(block.key)) continue;
    if (!hasProtectableContent(block.userAiTable)) continue;
    if (wroteAny) nodes.push({ type: "paragraph" });
    wroteAny = true;
    nodes.push(...block.allNodes);
  }

  return nodes;
}

/** headingIndex+1부터 찾아, laterSections(이 섹션 다음 순서의 AUTO 섹션들)
 * 중 하나로 판별되는 heading이 나오면 그 index를 경계로 삼는다. 그런 heading
 * 이 전혀 없으면(마지막 AUTO 섹션) "다음에 나오는 아무 heading"으로
 * fallback한다 — 문서 끝까지 아무 heading도 없으면 content.length. 프로젝트
 * 명(H3)은 어떤 meetingSection으로도 판별되지 않으므로 1차 탐색(다음 순서의
 * AUTO 섹션 찾기)에서는 자연히 건너뛴다.
 *
 * 실제로 재현한 버그: 마지막 AUTO 섹션(예: 공통 업무)은 laterSections가
 * 비어 있어 항상 2차(fallback) 탐색을 타는데, 이전 버전은 "다음에 나오는
 * 아무 heading"에서 멈춰서, 그 섹션 자기 자신의 프로젝트명 H3(예: 공통
 * 업무 예시의 "업무명")에서 멈춰버렸다 — 결과적으로 그 섹션 자기 내용을
 * 하나도 못 찾은 것으로 처리돼 전혀 치환되지 않았다. H3(프로젝트/업무명)는
 * 항상 attrs.level===3이고 문서의 다른 모든 heading(회의 규칙/주요 안건/
 * 5개 AUTO 섹션/미결 업무)은 항상 level 1~2이므로, "H3가 아닌 다음
 * heading"으로 fallback 조건을 바꿔 이 문제를 근본적으로 막는다. */
function findSectionEndIndex(
  content: JSONContent[],
  fromIndex: number,
  laterSections: SectionResult["section"][],
): number {
  for (let i = fromIndex; i < content.length; i++) {
    if (content[i].type !== "heading") continue;
    const resolved = resolveHeadingSection(content[i]);
    if (resolved && laterSections.includes(resolved)) return i;
  }
  for (let i = fromIndex; i < content.length; i++) {
    if (content[i].type === "heading" && content[i].attrs?.level !== 3) return i;
  }
  return content.length;
}

export interface InjectionResult {
  document: JSONContent;
  /** heading을 못 찾았지만 그 섹션에 채울 데이터는 있었던 경우만 담는다. */
  missingHeadings: string[];
  /** heading을 찾아 실제로 처리한 섹션 이름. */
  processedHeadings: string[];
}

/**
 * documentContent를 deep clone한 뒤 그 clone에만 처리한다(요청사항: Template
 * DB는 절대 건드리지 않는다). documentContent는 Template 원본이 아니라
 * "지금 사용자가 보고/편집 중인 현재 문서"다 — `일정 불러오기`를 몇 번을
 * 누르든 항상 이 문서를 기준으로 병합한다.
 */
export function mergeSectionsIntoDocument(documentContent: JSONContent, sections: SectionResult[]): InjectionResult {
  const cloned: JSONContent = JSON.parse(JSON.stringify(documentContent));
  const content: JSONContent[] = Array.isArray(cloned.content) ? cloned.content : [];

  const missingHeadings: string[] = [];
  const processedHeadings: string[] = [];
  const replacements: { headingIndex: number; deleteCount: number; newNodes: JSONContent[] }[] = [];

  sections.forEach((section, idx) => {
    const headingIndex = content.findIndex((node) => node.type === "heading" && resolveHeadingSection(node) === section.section);
    if (headingIndex === -1) {
      if (section.assigneeGroups.some((g) => g.groups.length > 0)) missingHeadings.push(section.headingText);
      return;
    }

    const laterSections = sections.slice(idx + 1).map((s) => s.section);
    const nextHeadingIndex = findSectionEndIndex(content, headingIndex + 1, laterSections);
    const existingContentNodes = content.slice(headingIndex + 1, nextHeadingIndex);
    const newNodes = mergeSectionBody(existingContentNodes, section.assigneeGroups);

    replacements.push({ headingIndex, deleteCount: nextHeadingIndex - (headingIndex + 1), newNodes });
    processedHeadings.push(section.headingText);
  });

  // 뒤쪽 index부터 처리해야 앞쪽에서 계산해 둔 index가 밀리지 않는다.
  replacements.sort((a, b) => b.headingIndex - a.headingIndex);
  for (const { headingIndex, deleteCount, newNodes } of replacements) {
    content.splice(headingIndex + 1, deleteCount, ...newNodes);
  }

  cloned.content = content;
  return { document: cloned, missingHeadings, processedHeadings };
}
