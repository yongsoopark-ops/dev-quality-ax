import { resolveHeadingSection } from "./sectionHeadings";
import { FIELD_KEY_LABELS, MEETING_FIELD_KEY, indexTableRowsByFieldKey, type MeetingFieldKey } from "./fieldSemantics";
import type { AssigneeGroup, SectionGroup, SectionResult, SectionTaskRow } from "./build";
import type { JSONContent } from "@tiptap/core";

/** Step(담당자 View Filter + 안전한 Block 단위 저장) — 담당자 필터 대상
 * 4개 섹션(요청사항 2/6/7: REGULAR_PROJECT/SUB_PROJECT/COMMON/EXCEPTION,
 * BUSINESS_TRIP 제외). View Filter(TemplateRichTextEditor.tsx)와 filtered
 * save(filteredSave.ts) 양쪽이 이 하나의 상수를 공유해 대상 섹션이 어긋나지
 * 않게 한다. */
export const FILTERABLE_MEETING_SECTIONS = new Set<SectionResult["section"]>([
  "REGULAR_PROJECT",
  "SUB_PROJECT",
  "COMMON",
  "EXCEPTION",
]);

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

/** Step(담당자 View Filter + 안전한 Block 단위 저장) — filteredSave.ts가
 * 이 순서 그대로 재사용한다(요청사항 9: "새로운 작성 필드 세트를 중복
 * 구현하지 않는다"). */
export const USER_AI_FIELD_ORDER: MeetingFieldKey[] = [
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

/** Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일, 이후 담당자 View Filter
 * Step에서 sourceTaskIds 배열로 보완) — AUTO Table(아래) 자체가 "이 Task
 * Block이 어디서 시작하는지"를 텍스트 파싱 없이 알려주는 stable anchor다.
 * attachMetadata인 섹션(REGULAR/SUB/COMMON/EXCEPTION — BUSINESS_TRIP 제외,
 * 요청사항 7)에서만 채운다.
 *
 * sourceTaskIds(항상 채움, 배열)가 1순위 식별자다 — PER_TASK는 [taskId]
 * 하나뿐이고, SHARED는 그 Table에 실제로 나타나는 모든 Task.id를 순서
 * 그대로 담는다(중복 제거, 요청사항: "SHARED = 해당 Block에 포함된 모든
 * Task.id"). sourceTaskId(단수, 하위 호환용으로 삭제하지 않고 유지)는
 * Task가 정확히 1건일 때만 채운다 — 이전 Step 코드/문서가 참조하던 값이라
 * 그대로 둔다. assigneeUserIds는 이 Table에 나타나는 모든 Task의 담당자
 * 합집합(요청사항: 복수 값 배열 설계). */
export interface TaskAutoTableMeta {
  sourceTaskIds: string[];
  /** @deprecated 하위 호환용 — sourceTaskIds[0]과 동일(Task가 1건일 때만
   * 채움). 새 코드는 sourceTaskIds를 우선 사용한다. */
  sourceTaskId?: string;
  assigneeUserIds: string[];
  meetingSection: SectionResult["section"];
}

/** Schedule AUTO Table(업무명 | 진행 일정 | 담당자) — 그룹에 속한 Task
 * 1건당 1행, 통째로 새로 만든다(재클릭 시에도 항상 최신 Schedule로 완전히
 * 교체 — "업무명/진행 일정/담당자는 반드시 같은 행에" 요청사항을 만족하려면
 * 부분 수정이 아니라 매번 전체를 다시 만드는 편이 안전하다). attrs.tableRole
 * = "auto"를 표 자체에 태깅해 CSS(app/globals.css)가 이 표를 compact
 * 폭으로 식별하게 한다(TemplateRichTextEditor.tsx의 TableRoleAttribute
 * 주석 참고 — :has() 구조 추론 대신 명시적 attribute를 쓰는 이유). */
function buildTaskAutoTable(tasks: SectionGroup["tasks"], meta?: TaskAutoTableMeta): JSONContent {
  const attrs: Record<string, unknown> = { tableRole: "auto" };
  if (meta) {
    attrs.sourceTaskIds = meta.sourceTaskIds;
    if (meta.sourceTaskId) attrs.sourceTaskId = meta.sourceTaskId;
    attrs.assigneeUserIds = meta.assigneeUserIds;
    attrs.meetingSection = meta.meetingSection;
  }
  return {
    type: "table",
    attrs,
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
 * level이 없다 — 그래서 담당자 구간은 굵은 문단으로 표시한다.
 *
 * Step(Assignee Header Stable Metadata) — 이 문단의 "진짜 판별 기준"은
 * 더 이상 "👤 " 텍스트 접두사가 아니라 명시적 attrs.blockRole="ASSIGNEE_HEADER"
 * 다(요청사항 1/2: "startsWith('👤 ')/정규식/이름 문자열로 담당자 Header를
 * 판정하지 않는다"). "👤 " 텍스트 자체는 여전히 화면에 보이는 표시 문구일
 * 뿐이다 — 우연히 같은 문구로 시작하는 일반 문단과 실제 header를 구조적으로
 * 구별하려면 텍스트가 아니라 이 attrs가 있어야 한다.
 *
 * 다만 이번 Step 이전에 만들어진 Production 문서는 이 attrs가 없다 — 그런
 * legacy 문서를 깨뜨리지 않기 위해 "문서 전체에 ASSIGNEE_HEADER metadata가
 * 단 하나도 없을 때만"(hasStableAssigneeHeaderMetadata) 옛 "👤 " 텍스트
 * 판별로 fallback한다(요청사항 3 — 하위 호환 전용 안전망, 신규 경로에서는
 * 절대 텍스트로 판정하지 않는다: isAssigneeHeaderParagraph 참고). */
const ASSIGNEE_HEADER_PREFIX = "👤 ";
/** paragraph/heading 공용 blockRole global attribute(TemplateRichTextEditor.tsx
 * TaskBlockMetadataAttribute)에 이미 쓰이는 값 중 하나 — 기존 "PROJECT_GROUP"
 * (heading 전용)과 같은 체계를 재사용한다(요청사항 1: "기존 blockRole
 * attribute 체계를 재사용"). */
const ASSIGNEE_HEADER_BLOCK_ROLE = "ASSIGNEE_HEADER";
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

/** Step(담당자 View Filter + 안전한 Block 단위 저장) — "👤 이름" 문단에
 * assigneeUserId를 심는다(요청사항 §1/§14: 필터 option 목록을 "실제 회의록에
 * 포함된 담당자"에서 {id,name}으로 직접 뽑기 위함, 이름 문자열이 아니라
 * id 기준). "공통"/"담당자 미지정" 구간은 항상 null. */
function buildAssigneeHeaderParagraph(label: string, taskCount: number, assigneeUserId: string | null): JSONContent {
  return {
    type: "paragraph",
    attrs: { assigneeUserId, blockRole: ASSIGNEE_HEADER_BLOCK_ROLE },
    content: [
      {
        type: "text",
        text: `${ASSIGNEE_HEADER_PREFIX}${label} · ${taskCount}건`,
        marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "15px" } }],
      },
    ],
  };
}

/** 문서(정확히는 그 top-level 노드 목록) 안에 이미 신규 stable metadata
 * (blockRole="ASSIGNEE_HEADER")가 심어진 담당자 header가 하나라도 있는지.
 * 이 문서가 이미 이번 Step 이후 구조로 최소 한 번 재구성됐다는 뜻이라
 * (담당자 header는 재클릭 때마다 항상 buildAssigneeHeaderParagraph로 새로
 * 만들어지므로, 한 번이라도 재구성된 문서는 모든 담당자 header가 이 metadata를
 * 갖는다 — "일부만 legacy" 상태가 되지 않는다), 이 경우 isAssigneeHeaderParagraph는
 * "👤 " 텍스트 fallback을 쓰지 않는다(요청사항 2/3 — 신규 경로는 텍스트로
 * 판정하지 않는다). 하나도 없으면(이번 Step 이전의 순수 legacy Production
 * 문서) 그때만 fallback을 허용한다. */
export function hasStableAssigneeHeaderMetadata(nodes: JSONContent[]): boolean {
  return nodes.some((node) => node.type === "paragraph" && node.attrs?.blockRole === ASSIGNEE_HEADER_BLOCK_ROLE);
}

/** 담당자 header 판별 우선순위(요청사항 3):
 *   1) attrs.blockRole === "ASSIGNEE_HEADER" — 신규 안정 경로, 텍스트와 무관하게 항상 header.
 *   2) legacyFallbackAllowed(=문서 전체에 위 metadata가 전혀 없음)일 때만,
 *      "👤 " 텍스트 접두사로 legacy header를 인식한다.
 * legacyFallbackAllowed가 false면(이미 신규 구조로 재구성된 문서) 일반
 * 문단의 텍스트가 우연히 "👤 "로 시작해도 절대 header로 오인하지 않는다. */
export function isAssigneeHeaderParagraph(node: JSONContent, legacyFallbackAllowed: boolean): boolean {
  if (node.type !== "paragraph") return false;
  if (node.attrs?.blockRole === ASSIGNEE_HEADER_BLOCK_ROLE) return true;
  if (!legacyFallbackAllowed) return false;
  return extractText(node).startsWith(ASSIGNEE_HEADER_PREFIX);
}

/** Step(담당자 View Filter + 안전한 Block 단위 저장) — 필터 select의 option
 * 목록을 "실제 이번 회의록에 포함된 담당자"에서 직접 뽑는다(요청사항 1/14
 * 1순위: "실제 회의록에 포함된 Task 담당자"). 서버에 새로 쿼리하지 않고
 * 이미 로드된 documentContent를 훑기만 한다 — "👤 이름" 문단의
 * attrs.assigneeUserId(이번 Step에서 새로 심음)를 읽는다. "공통"/"담당자
 * 미지정" 구간(assigneeUserId=null)은 제외한다(그 자체가 특정 한 명이
 * 아니므로 필터 옵션이 될 수 없다). 문서 전체(모든 섹션)를 훑으므로 특정
 * 섹션에만 있는 담당자도 빠짐없이 잡힌다. 이름 문자열이 아니라 id로
 * dedup해 동명이인도 안전하다. */
export function listAssigneeFilterOptions(documentContent: JSONContent): { id: string; name: string }[] {
  const content = Array.isArray(documentContent.content) ? documentContent.content : [];
  const legacyFallbackAllowed = !hasStableAssigneeHeaderMetadata(content);
  const seen = new Set<string>();
  const options: { id: string; name: string }[] = [];
  for (const node of content) {
    if (!isAssigneeHeaderParagraph(node, legacyFallbackAllowed)) continue;
    const id = node.attrs?.assigneeUserId;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, name: extractAssigneeLabelForKey(node) });
  }
  return options;
}

/** "👤 이름 · N건" 표시 문단에서 병합 key로 쓸 순수 이름만 뽑는다(건수
 * 접미사는 위 주석대로 key에서 제외). */
function extractAssigneeLabelForKey(node: JSONContent): string {
  return extractText(node).slice(ASSIGNEE_HEADER_PREFIX.length).replace(ASSIGNEE_COUNT_SUFFIX_RE, "").trim();
}

/** Step(Final Local Fixture UI Validation) — listAssigneeFilterOptions가
 * 빈 배열을 반환했을 때, 그 이유가 "이 문서에 담당자 구간 자체가 없다"
 * (진짜 새 문서, 이번 주 대상 Task가 아직 없음)인지 "예전 방식 '👤 이름'
 * 텍스트는 있지만 id를 뽑을 수 없는 legacy 문서"인지 구분하는 신호다
 * (요청사항 1: "신규 구조 문서에서는 안내가 나타나지 않아야 한다"). id
 * 유무와 무관하게 "👤 " 텍스트로 시작하는 문단이 하나라도 있으면 legacy로
 * 판단한다 — 실제 Production의 마이그레이션 전 Draft가 정확히 이 모양이다
 * (blockRole도 attrs.assigneeUserId도 전혀 없이 "👤 이름 · N건" 텍스트만
 * 있음, Step 3B 검증에서 실측). 문서를 변환하거나 수정하지 않는다 — 순수
 * 판독 전용. */
export function hasUnmigratedAssigneeHeaderText(documentContent: JSONContent): boolean {
  const content = Array.isArray(documentContent.content) ? documentContent.content : [];
  return content.some((node) => node.type === "paragraph" && extractText(node).startsWith(ASSIGNEE_HEADER_PREFIX));
}

/** Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — Task 1건의 독립
 * Block(AUTO Table + 작성 Table). SUB_PROJECT의 PER_TASK 레이아웃이 goalName
 * H3 하나 아래 이 Block을 Task 수만큼 반복해서 만든다 — REGULAR_PROJECT가
 * 쓰는 것과 완전히 같은 AUTO Table/작성 Table 구조를 그대로 재사용한다(요청
 * 사항: "새로운 작성 필드 세트를 중복 구현하지 않는다"). */
function buildTaskBlock(
  task: SectionTaskRow,
  meetingSection: SectionResult["section"],
  existingTaskTablesById: Map<string, JSONContent>,
  consumedTaskIds: Set<string>,
): JSONContent[] {
  const existingUserAiTable = existingTaskTablesById.get(task.taskId) ?? null;
  if (existingUserAiTable) consumedTaskIds.add(task.taskId);
  return [
    buildTaskAutoTable([task], { sourceTaskIds: [task.taskId], sourceTaskId: task.taskId, assigneeUserIds: task.assigneeUserIds, meetingSection }),
    { type: "paragraph" },
    buildUserAiTable(existingUserAiTable),
  ];
}

function buildGroupBlock(
  group: SectionGroup,
  taskLayout: SectionResult["taskLayout"],
  meetingSection: SectionResult["section"],
  attachMetadata: boolean,
  existing: ExistingGroupBlock | undefined,
  existingTaskTablesById: Map<string, JSONContent>,
  consumedTaskIds: Set<string>,
): JSONContent[] {
  const headingAttrs: Record<string, unknown> = { level: 3 };
  if (attachMetadata) {
    headingAttrs.blockRole = "PROJECT_GROUP";
    headingAttrs.meetingSection = meetingSection;
  }
  const heading: JSONContent = { type: "heading", attrs: headingAttrs, content: textNodes(group.title) };

  if (taskLayout === "PER_TASK") {
    // 각 Task가 독립 Block을 갖는다(요청사항: "goalName은 상위 시각적 그룹
    // 으로 유지, Task별 독립 작성 Block"). 기존 내용은 sourceTaskId로 직접
    // 찾는다(1순위) — goalName/담당자 라벨 기반 legacy key는 "어느 Task"인지
    // 특정할 수 없어 여기서는 쓰지 않는다(요청사항 9, 의미 추정 금지).
    const blocks: JSONContent[] = [heading];
    group.tasks.forEach((task, idx) => {
      if (idx > 0) blocks.push({ type: "paragraph" });
      blocks.push(...buildTaskBlock(task, meetingSection, existingTaskTablesById, consumedTaskIds));
    });
    return blocks;
  }

  // SHARED(기존 REGULAR_PROJECT/EXCEPTION/BUSINESS_TRIP/COMMON 그대로) — Task
  // 여러 건이 AUTO Table 한 개, 작성 Table 한 개를 공유한다(구조 변경 없음,
  // 요청사항 7). Task가 정확히 1건이면 그 task의 sourceTaskId로 우선
  // 매칭하고(요청사항 9의 "안전하게 개선"), 그렇지 않으면(0건 또는 여러 건)
  // 기존 담당자 라벨::제목 key 매칭으로 fallback한다.
  const singleTask = group.tasks.length === 1 ? group.tasks[0] : null;
  const byId = singleTask ? existingTaskTablesById.get(singleTask.taskId) : undefined;
  if (byId && singleTask) consumedTaskIds.add(singleTask.taskId);
  const existingUserAiTable = byId ?? existing?.userAiTable ?? null;
  const autoTableMeta: TaskAutoTableMeta | undefined = attachMetadata
    ? {
        // 요청사항 0: SHARED Block의 sourceTaskIds = 그 Block에 포함된 모든
        // Task.id, 중복 제거 후 안정적인 순서(group.tasks 원래 순서)로 저장.
        sourceTaskIds: [...new Set(group.tasks.map((t) => t.taskId))],
        sourceTaskId: singleTask?.taskId,
        assigneeUserIds: [...new Set(group.tasks.flatMap((t) => t.assigneeUserIds))],
        meetingSection,
      }
    : undefined;
  return [heading, buildTaskAutoTable(group.tasks, autoTableMeta), { type: "paragraph" }, buildUserAiTable(existingUserAiTable)];
}

interface ExistingGroupBlock {
  /** "담당자 라벨::프로젝트명" — 재클릭 시 같은 담당자 아래 같은
   * 프로젝트를 정확히 다시 찾기 위한 합성 key다(요청사항: "담당자별 그룹
   * 구조가 바뀌더라도 fieldKey/semantic identity 기준으로 안전하게 보존,
   * 단순 화면 위치/index 기준 병합 금지"). 프로젝트 자체는 이름(title)만
   * 으로 이미 고유하게 식별되지만, 같은 프로젝트가 이번 주와 지난주에
   * 서로 다른 담당자 버킷에 속하게 될 수도 있어 담당자 라벨까지 key에
   * 포함해 정확도를 높인다. 직전에 만난 "👤 " 문단이 아직 없었던(레거시
   * 문서, 담당자 구조 도입 이전) 경우 라벨은 빈 문자열이다.
   *
   * Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — goalName 자체는
   * DB에 안정적인 id가 없는 자유 텍스트라(Task.goalName), 이 그룹(goalName)
   * 수준의 식별은 계속 이 legacy key에 의존한다(요청사항 9: "1순위
   * sourceTaskId, 2순위 legacy key" 중 goalName에는 애초에 1순위를 적용할
   * 대상 id가 없다) — Task 수준 식별은 아래 taggedSourceTaskIds/개별
   * sourceTaskId로 개선됐다. */
  key: string;
  title: string;
  /** heading부터 다음 heading(또는 섹션 끝) 전까지의 노드 전부 — 그룹명이
   * 이번 조회에서 사라졌을 때(orphan) 통째로 그대로 보존하는 데 쓴다. */
  allNodes: JSONContent[];
  /** 이 블록 안에서 두 번째로 나오는 Table — buildGroupBlock이 항상
   * [H3, AUTO Table, 문단, USER/AI Table] 순서로 만들기 때문에, 두 번째
   * Table이 곧 "구분 | 내용"(USER/AI) Table이다. SHARED 레이아웃 기존 블록
   * 전용 필드 — PER_TASK로 이미 전환된 블록은 AUTO Table이 여러 개라 이
   * 필드로는 의미가 없다(existingTaskTablesById를 대신 쓴다). */
  userAiTable: JSONContent | null;
  /** Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — 이 블록 안의 AUTO
   * Table들이 갖고 있던 sourceTaskId 전부. 재클릭 시 이 목록의 모든 id가
   * 다른 새 Block으로 이미 재사용(consumedTaskIds)됐다면 이 블록은 완전히
   * 대체된 것이라 orphan으로 중복 보존하지 않는다. 하나도 없으면(빈 배열)
   * "레거시 shared 블록"(Task별로 안전하게 분해할 수 없는 옛 구조)이라
   * 기존 hasProtectableContent 판단으로만 orphan 여부를 정한다(요청사항 8:
   * "기존 작성 내용에 있으면 orphan 보호 정책으로 그대로 보존, 새 Task별
   * block을 생성", 의미 추정으로 임의 분산하지 않는다). */
  taggedSourceTaskIds: string[];
}

/** 섹션 body를 "프로젝트명 H3로 시작하는 블록들"로 나눈다 — 이 과정에서
 * "👤 이름" 문단(담당자 구간 표시)은 블록으로 만들지 않고, 그 뒤에 나오는
 * H3 블록들의 key 접두사(담당자 라벨)로만 쓴다. buildGroupBlock이 항상
 * 이 모양으로 쓰기 때문에(그룹명 heading 없이 바로 Table이 오는 legacy
 * Template 원본은 애초에 어떤 새 그룹명과도 일치하지 않아 그대로 버려진다
 * — 첫 클릭 때의 정상 동작). */
function splitIntoGroupBlocks(nodes: JSONContent[], legacyFallbackAllowed: boolean): ExistingGroupBlock[] {
  const blocks: ExistingGroupBlock[] = [];
  let current: ExistingGroupBlock | null = null;
  let currentAssigneeLabel = "";

  for (const node of nodes) {
    if (isAssigneeHeaderParagraph(node, legacyFallbackAllowed)) {
      currentAssigneeLabel = extractAssigneeLabelForKey(node);
      continue;
    }
    if (node.type === "heading" && node.attrs?.level === 3) {
      const title = extractText(node).trim();
      current = { key: `${currentAssigneeLabel}::${title}`, title, allNodes: [node], userAiTable: null, taggedSourceTaskIds: [] };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    current.allNodes.push(node);
    if (node.type === "table") {
      if (node.attrs?.tableRole === "auto") {
        if (typeof node.attrs?.sourceTaskId === "string" && node.attrs.sourceTaskId) current.taggedSourceTaskIds.push(node.attrs.sourceTaskId);
      } else if (!current.userAiTable) {
        // SHARED 레이아웃(AUTO Table 1개 + 작성 Table 1개)에서 두 번째로
        // 만나는(=AUTO가 아닌) Table이 작성 Table이다.
        current.userAiTable = node;
      }
    }
  }
  return blocks;
}

/** Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — 섹션 전체(모든 그룹을
 * 통틀어)에서 AUTO Table의 attrs.sourceTaskId → 바로 다음 Table(작성 Table)
 * 을 찾아 매핑한다. goalName/프로젝트명이 바뀌거나(리네임) Task가 다른
 * goalName로 옮겨져도 이 Table id 기반 매핑은 깨지지 않는다(요청사항 9:
 * "sourceTaskId 기반 identity를 우선"). AUTO Table 자체가 "이 자리부터 다음
 * Task Block 시작 전까지"의 경계이므로 텍스트 파싱이 필요 없다. */
function findNextTable(nodes: JSONContent[], fromIndex: number): JSONContent | null {
  for (let i = fromIndex; i < nodes.length; i++) {
    if (nodes[i].type === "table") return nodes[i];
    if (nodes[i].type === "heading") return null;
  }
  return null;
}

function collectExistingTaskTablesById(nodes: JSONContent[]): Map<string, JSONContent> {
  const map = new Map<string, JSONContent>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type !== "table" || node.attrs?.tableRole !== "auto") continue;
    const sourceTaskId = node.attrs?.sourceTaskId;
    if (typeof sourceTaskId !== "string" || !sourceTaskId) continue;
    const userAiTable = findNextTable(nodes, i + 1);
    if (userAiTable) map.set(sourceTaskId, userAiTable);
  }
  return map;
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
function mergeSectionBody(
  existingContentNodes: JSONContent[],
  newAssigneeGroups: AssigneeGroup[],
  taskLayout: SectionResult["taskLayout"],
  meetingSection: SectionResult["section"],
  attachMetadata: boolean,
  legacyFallbackAllowed: boolean,
): JSONContent[] {
  const existingBlocks = splitIntoGroupBlocks(existingContentNodes, legacyFallbackAllowed);
  const existingByKey = new Map<string, ExistingGroupBlock>();
  for (const block of existingBlocks) {
    if (!existingByKey.has(block.key)) existingByKey.set(block.key, block);
  }
  // Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — 섹션 전체를 훑어
  // sourceTaskId 기반 매핑을 한 번만 만든다(요청사항 9의 1순위 — goalName/
  // 프로젝트명이 바뀌어도, 심지어 다른 그룹으로 옮겨져도 깨지지 않는다).
  const existingTaskTablesById = collectExistingTaskTablesById(existingContentNodes);
  // 이번 재구성에서 실제로 재사용된(=다른 새 Block으로 옮겨진) sourceTaskId
  // 목록 — orphan 판정 시 "이 블록의 내용이 이미 다른 곳으로 전부 옮겨졌는지"
  // 확인하는 데 쓴다(아래 orphan 루프 참고).
  const consumedTaskIds = new Set<string>();

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
    nodes.push(buildAssigneeHeaderParagraph(assigneeLabel, taskCount, assigneeGroup.assigneeUserId));

    assigneeGroup.groups.forEach((group) => {
      const key = `${assigneeLabel}::${group.title}`;
      const existingBlock = existingByKey.get(key);
      // Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — PER_TASK 그룹은
      // goalName(=key) 매칭으로 기존 내용을 가져오지 않는다(sourceTaskId가
      // 항상 우선이라, 옛 key 매칭 여부와 무관하게 아래 orphan 루프가
      // consumedTaskIds 기준으로 정확히 판단한다) — 그래서 PER_TASK는 key를
      // "used" 처리하지 않는다. SHARED는 기존 그대로 key 매칭을 쓴다.
      if (taskLayout !== "PER_TASK") usedKeys.add(key);
      nodes.push({ type: "paragraph" }); // 담당자 표시와 첫 프로젝트 사이, 프로젝트 사이 여백
      nodes.push(...buildGroupBlock(group, taskLayout, meetingSection, attachMetadata, existingBlock, existingTaskTablesById, consumedTaskIds));
    });
  }

  // orphan(이번 주 대상에서 사라진 프로젝트, 또는 sourceTaskId 기반으로
  // 이미 다른 Block에 완전히 재사용된 옛 블록) — 어느 담당자 밑에도 다시
  // 넣을 수 없거나 이미 다른 곳에 옮겨졌으면 섹션 맨 끝에 그대로 이어 붙인다.
  for (const block of existingBlocks) {
    if (usedKeys.has(block.key)) continue;
    // Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — 이 블록의
    // sourceTaskId가 하나 이상 있고 전부 다른 새 Block으로 이미 재사용됐다면
    // (=완전히 대체됨) 중복 보존하지 않는다. 태깅된 id가 하나도 없으면(순수
    // 레거시 shared 블록) 기존 hasProtectableContent 판정만으로 orphan 여부를
    // 정한다 — 어느 Task 것인지 추정할 수 없어(요청사항 8/9) 이 경로가 유일한
    // 안전망이다.
    if (block.taggedSourceTaskIds.length > 0 && block.taggedSourceTaskIds.every((id) => consumedTaskIds.has(id))) continue;
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
  // Step(Assignee Header Stable Metadata) — 문서 전체(재구성 전) 기준으로
  // 딱 한 번만 판단한다: 담당자 header는 항상 통째로 다시 만들어지므로
  // (buildAssigneeHeaderParagraph), 이미 한 번이라도 이 Step 이후 구조로
  // 재구성된 문서는 모든 header가 blockRole="ASSIGNEE_HEADER"를 갖고, 그렇지
  // 않은 순수 legacy 문서는 하나도 갖지 않는다 — "섹션마다 따로" 판단할
  // 필요가 없다(§3).
  const legacyFallbackAllowed = !hasStableAssigneeHeaderMetadata(content);

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
    const newNodes = mergeSectionBody(
      existingContentNodes,
      section.assigneeGroups,
      section.taskLayout,
      section.section,
      section.attachMetadata,
      legacyFallbackAllowed,
    );

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
