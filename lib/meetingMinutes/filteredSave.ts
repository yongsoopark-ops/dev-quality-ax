import { FILTERABLE_MEETING_SECTIONS, USER_AI_FIELD_ORDER, hasStableAssigneeHeaderMetadata, isAssigneeHeaderParagraph } from "./injectDocument";
import { FIELD_KEY_LABELS, indexTableRowsByFieldKey, type MeetingFieldKey } from "./fieldSemantics";
import { resolveHeadingSection } from "./sectionHeadings";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(담당자 View Filter + 안전한 Block 단위 저장) — 담당자 필터 모드에서
 * "전체 document overwrite"가 아니라 "선택 담당자의 필터 대상 Block만
 * 병합"하기 위한 순수 로직(DB/Prisma 의존 없음, build.ts/injectDocument.ts와
 * 같은 설계 원칙). 실제 DB read/write는 draft.ts의
 * saveMeetingMinutesDraftFilteredAction이 담당하고, 이 파일은 세 문서
 * (server 최신본 / client가 편집을 시작한 base본 / client의 지금 편집본)를
 * 받아 "무엇을 병합해도 안전한지"만 판단한다.
 *
 * 핵심 원칙(요청사항 7/8/9/10):
 *   - 병합 단위는 Block(AUTO Table 1개 + 그 바로 다음 작성 Table)이고,
 *     Block 식별은 AUTO Table의 sourceTaskIds(세트, 순서 무관 비교)로만
 *     한다 — 담당자명/H3 텍스트로 식별하지 않는다.
 *   - AUTO Table(업무명/진행 일정/담당자/metadata)은 항상 server 최신값을
 *     그대로 두고 절대 교체하지 않는다 — client가 편집하는 대상은 오직
 *     작성 Table(산출물/진행 현황/특이 사항/결정 내용/향후 일정) 5개
 *     필드뿐이다(요청사항 9).
 *   - 어떤 Block을 "이번에 병합해도 되는지"는 base(=client가 마지막으로
 *     안전하게 봤던 상태)와 server 최신 상태의 작성 Table 값을 비교해
 *     판정한다 — 같으면(그 사이 아무도 안 건드림) client 값 적용, 다르면
 *     (다른 사용자가 같은 Block을 그 사이 고침) 그 Block은 conflict로
 *     표시하고 server 값을 그대로 유지한다(절대 덮어쓰지 않는다).
 *   - sourceTaskIds/assigneeUserIds가 아예 없는 legacy Block(이번 Step
 *     이전에 만들어진 documentContent)은 이 필터 병합 대상에서 자연히
 *     제외된다 — assigneeUserIds가 없으니 어떤 selectedUserId와도 매치될
 *     수 없다(임의 담당자 추정 금지, 요청사항 15). "일정 불러오기"로
 *     metadata가 채워진 뒤부터 정상적으로 필터 대상이 된다.
 */

export interface FilterableBlock {
  /** 이 Block(AUTO Table)의 sourceTaskIds. 비어 있으면 legacy(metadata
   * 없음) Block — assigneeUserIds도 항상 비어 있어 필터 매칭 대상이 될 수
   * 없다. */
  taskIds: string[];
  /** 이 Task의 담당자 전체(관계/검증용 metadata, 삭제하지 않는다 — 요청사항
   * 2). 복수 담당 Task는 모든 occurrence에서 이 값이 동일하다. */
  assigneeUserIds: string[];
  /** Step(복수 담당 Task Filter/Save 안전성 보완) — 이 occurrence가 물리적으로
   * 어느 "👤 담당자" 구역 아래에 있는지(그 구역 heading paragraph의
   * attrs.assigneeUserId). "공통"/"담당자 미지정" 구역이거나 담당자 구역
   * 자체를 못 찾았으면 null. Block 식별의 1차 기준은 이제 assigneeUserIds가
   * 아니라 이 값이다(요청사항 2/6) — occurrence 선택/충돌 검사 전부 이
   * 필드로 구분한다. */
  sectionAssigneeUserId: string | null;
  section: string;
  autoTable: JSONContent;
  writeTable: JSONContent | null;
}

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(extractText).join("");
  return "";
}

/** documentContent의 top-level content 배열을 훑어 필터 대상 4개 섹션
 * (REGULAR_PROJECT/SUB_PROJECT/COMMON/EXCEPTION)의 Task Block을 전부
 * 나열한다. heading(level!==3)을 만날 때마다 "지금 어느 섹션인지"를
 * 갱신하고, 그 섹션이 필터 대상일 때만 AUTO Table(tableRole="auto")을
 * Block의 시작으로 인식한다 — injectDocument.ts의 Task Block 경계 정의와
 * 동일하다(다음 AUTO Table 또는 다음 heading 전까지, 그 사이 첫 번째
 * AUTO가 아닌 Table이 작성 Table이다). */
export function listFilterableBlocks(content: JSONContent[]): FilterableBlock[] {
  const blocks: FilterableBlock[] = [];
  let currentSection: string | null = null;
  // Step(복수 담당 Task Filter/Save 안전성 보완, 이후 Assignee Header Stable
  // Metadata Step에서 blockRole="ASSIGNEE_HEADER" 우선 판정으로 교체) —
  // 담당자 구간 표시 문단(injectDocument.ts의 buildAssigneeHeaderParagraph/
  // isAssigneeHeaderParagraph와 동일한 기준을 그대로 재사용한다 — 두 판정이
  // 어긋나면 필터 판정과 저장 병합이 서로 다른 구역 경계를 볼 위험이 있다)을
  // 만날 때마다 갱신한다. 이 값이 null이면 "공통"/"담당자 미지정" 구역이거나
  // 아직 어떤 담당자 구역도 만나지 않은 상태다.
  let currentAssigneeUserId: string | null = null;
  const legacyFallbackAllowed = !hasStableAssigneeHeaderMetadata(content);

  for (let i = 0; i < content.length; i++) {
    const node = content[i];
    if (isAssigneeHeaderParagraph(node, legacyFallbackAllowed)) {
      currentAssigneeUserId = typeof node.attrs?.assigneeUserId === "string" ? node.attrs.assigneeUserId : null;
      continue;
    }
    if (node.type === "heading" && node.attrs?.level !== 3) {
      const attrValue = node.attrs?.meetingSection;
      currentSection = typeof attrValue === "string" && attrValue ? attrValue : resolveHeadingSection(node);
      continue;
    }
    if (node.type !== "table" || node.attrs?.tableRole !== "auto") continue;
    if (!currentSection || !FILTERABLE_MEETING_SECTIONS.has(currentSection as never)) continue;

    const taskIds: string[] = Array.isArray(node.attrs?.sourceTaskIds)
      ? node.attrs.sourceTaskIds
      : typeof node.attrs?.sourceTaskId === "string" && node.attrs.sourceTaskId
        ? [node.attrs.sourceTaskId]
        : [];
    const assigneeUserIds: string[] = Array.isArray(node.attrs?.assigneeUserIds) ? node.attrs.assigneeUserIds : [];

    let writeTable: JSONContent | null = null;
    for (let j = i + 1; j < content.length; j++) {
      if (content[j].type === "heading") break;
      if (content[j].type === "table") {
        if (content[j].attrs?.tableRole !== "auto") writeTable = content[j];
        break;
      }
    }

    blocks.push({ taskIds, assigneeUserIds, sectionAssigneeUserId: currentAssigneeUserId, section: currentSection, autoTable: node, writeTable });
  }
  return blocks;
}

/** taskIds 순서 무관 비교를 위한 안정 key. 빈 배열(legacy)은 서로 다른
 * legacy Block끼리도 절대 매칭되지 않도록 매번 다른 값을 반환한다 —
 * legacy Block은 애초에 필터 매칭 대상이 아니라는 정책(위 파일 설명)과
 * 일관되게, "우연히 둘 다 비어 있으니 같은 Block" 같은 오판을 막는다. */
let legacyKeySeq = 0;
function blockKey(block: Pick<FilterableBlock, "taskIds">): string {
  if (block.taskIds.length === 0) return `__legacy_no_match_${legacyKeySeq++}__`;
  return [...block.taskIds].sort().join(",");
}

/** 작성 Table 5개 필드의 현재 텍스트 값만 뽑는다(fieldKey 기반, 라벨 텍스트
 * 비교 없음) — base/server/client 세 시점의 내용을 비교하는 유일한 대상. */
export function extractWriteTableFieldValues(writeTable: JSONContent | null): Record<MeetingFieldKey, string> {
  const rowsByKey = writeTable ? indexTableRowsByFieldKey(writeTable) : new Map<MeetingFieldKey, JSONContent>();
  const result = {} as Record<MeetingFieldKey, string>;
  for (const key of USER_AI_FIELD_ORDER) {
    const row = rowsByKey.get(key);
    const valueCell = row?.content?.[1];
    result[key] = valueCell ? extractText(valueCell).trim() : "";
  }
  return result;
}

/** 두 필드 값 집합이 같은지 — 단순 구조 비교(비결정적 JSON.stringify
 * 순서에 의존하지 않는다, 요청사항 10). USER_AI_FIELD_ORDER 고정 순서로
 * 하나씩 비교한다. */
export function fieldValuesEqual(a: Record<MeetingFieldKey, string>, b: Record<MeetingFieldKey, string>): boolean {
  return USER_AI_FIELD_ORDER.every((key) => (a[key] ?? "") === (b[key] ?? ""));
}

function fieldLabel(key: MeetingFieldKey): string {
  return FIELD_KEY_LABELS.find((d) => d.key === key)?.label ?? key;
}

/** writeTable(server 최신본, cloned 문서 안의 실제 노드)의 필드 값 셀만
 * fieldValues로 교체한다 — 라벨 셀(attrs.fieldKey)과 header 행은 그대로
 * 두고 값 셀만 새로 만든다. writeTable이 null이면(server에 작성 Table
 * 자체가 없는 비정상 상태) 아무것도 하지 않는다 — 위치를 추정해 새로
 * 만들지 않는다(구조 자체가 어긋난 상태를 임의로 봉합하지 않는다). */
function applyFieldValues(writeTable: JSONContent | null, fieldValues: Record<MeetingFieldKey, string>): void {
  if (!writeTable || !Array.isArray(writeTable.content)) return;
  const rowsByKey = indexTableRowsByFieldKey(writeTable);
  for (const key of USER_AI_FIELD_ORDER) {
    const row = rowsByKey.get(key);
    if (!row || !Array.isArray(row.content) || row.content.length < 2) continue;
    row.content[1] = { type: "tableCell", content: [{ type: "paragraph", content: fieldValues[key] ? [{ type: "text", text: fieldValues[key] }] : [] }] };
  }
}

export interface MergeFilteredSaveResult {
  /** server 최신 문서를 deep clone한 뒤, conflict 없는 Block만 client 값으로
   * 교체한 결과. conflict가 하나라도 있으면(conflictedBlockKeys.length>0)
   * 이 값을 저장하지 않는다(요청사항: "conflict 발생 → 저장하지 않음") —
   * 호출부(draft.ts)가 그 판단을 한다. */
  merged: JSONContent;
  /** 이번 요청이 편집하려던 Block 중, server가 그 사이 이미 바뀐(=base와
   * 다른) Block들의 key(정렬된 taskIds 목록). 비어 있으면 conflict 없음. */
  conflictedBlockKeys: string[];
}

/** key가 같은 Block(occurrence)을 전부 모은다 — 복수 담당자 Task는 "중복
 * 표시" 정책(build.ts)에 따라 담당자마다 자기 섹션 아래 같은 Task의 Block이
 * 별도로(문서 안에 물리적으로 여러 번) 나타난다. Step(복수 담당 Task
 * Filter/Save 안전성 보완) 이전에는 첫 occurrence 하나만 기준으로 삼았으나
 * (toFirstOccurrenceByKey), 그러면 두 번째 이후 occurrence가 서버에서
 * 바뀐 경우를 놓친다(요청사항 7 "첫 occurrence만 보고 통과하면 안 된다") —
 * 그래서 occurrence 목록 전체를 그대로 넘긴다. */
function groupByKey(blocks: FilterableBlock[]): Map<string, FilterableBlock[]> {
  const map = new Map<string, FilterableBlock[]>();
  for (const block of blocks) {
    const key = blockKey(block);
    const list = map.get(key);
    if (list) list.push(block);
    else map.set(key, [block]);
  }
  return map;
}

/** occurrence 목록 전체가 작성 필드 기준으로 서로 완전히 같은지 — 하나라도
 * 다르면 false(요청사항 9: "이미 서로 달라진 duplicate는 정답을 추정하지
 * 않고 conflict"). 빈 목록/단일 occurrence는 항상 true. */
function allWriteValuesEqual(occurrences: FilterableBlock[]): boolean {
  if (occurrences.length <= 1) return true;
  const first = extractWriteTableFieldValues(occurrences[0].writeTable);
  return occurrences.slice(1).every((occ) => fieldValuesEqual(extractWriteTableFieldValues(occ.writeTable), first));
}

const EMPTY_FIELD_VALUES: Record<MeetingFieldKey, string> = extractWriteTableFieldValues(null);

/** 담당자 필터 저장의 핵심 병합 — DB 없이 세 JSONContent만으로 계산 가능한
 * 순수 함수(요청사항 19: "DB 없는 pure merge test 우선"). Step(복수 담당
 * Task Filter/Save 안전성 보완) 이후 흐름:
 *
 *   1) sourceTaskIds가 같은 모든 occurrence를 server/base/current 각각에서
 *      모은다(occurrence 하나만 보지 않는다, 요청사항 7).
 *   2) server 자신의 occurrence들끼리, base 자신의 occurrence들끼리 먼저
 *      서로 일치하는지 확인한다 — 이미 벌어져 있으면(요청사항 9) 어느 쪽도
 *      정답으로 추정하지 않고 곧장 conflict.
 *   3) 그다음에만 "server 대표값 vs base 대표값"을 비교한다(요청사항 7) —
 *      다르면 그 사이 누군가 바꾼 것이므로 conflict.
 *   4) 안전하면, selectedUserId 자신의 담당자 구역(sectionAssigneeUserId)
 *      아래에 있는 current occurrence 하나만 골라(요청사항 6 — 문서 전체
 *      첫 occurrence가 아니라 반드시 이 사용자 자신의 구역) 그 작성값을
 *      server의 모든 occurrence에 동일하게 반영한다(요청사항 8 — 사본들이
 *      서로 다른 내용으로 갈라지지 않게).
 */
export function mergeFilteredSave(
  serverDocument: JSONContent,
  baseDocument: JSONContent,
  currentDocument: JSONContent,
  selectedUserId: string,
): MergeFilteredSaveResult {
  const baseBlocksByKey = groupByKey(listFilterableBlocks(Array.isArray(baseDocument.content) ? baseDocument.content : []));
  const currentBlocksByKey = groupByKey(listFilterableBlocks(Array.isArray(currentDocument.content) ? currentDocument.content : []));

  const cloned: JSONContent = JSON.parse(JSON.stringify(serverDocument));
  const clonedContent: JSONContent[] = Array.isArray(cloned.content) ? cloned.content : [];
  const clonedServerBlocks = listFilterableBlocks(clonedContent); // writeTable 참조가 cloned 안의 실제 노드를 가리킨다 — applyFieldValues가 그대로 mutate.
  const serverBlocksByKey = groupByKey(clonedServerBlocks);

  const conflictedBlockKeys: string[] = [];

  for (const [key, serverOccurrences] of serverBlocksByKey) {
    if (serverOccurrences[0].taskIds.length === 0) continue; // legacy Block — 필터 매칭 대상 아님(위 설명)
    if (!serverOccurrences.some((occ) => occ.assigneeUserIds.includes(selectedUserId))) continue; // 이 담당자의 Block이 아니다

    // 요청사항 6: 문서 전체 첫 occurrence가 아니라, 반드시 선택한 담당자
    // 자신의 "👤" 구역 아래에 있는 occurrence에서 편집값을 가져온다.
    const currentOccurrenceForUser = (currentBlocksByKey.get(key) ?? []).find((occ) => occ.sectionAssigneeUserId === selectedUserId);
    if (!currentOccurrenceForUser) continue; // client 문서에 이 사용자 구역의 occurrence가 없다 — 편집 대상 아님, 손대지 않는다

    const baseOccurrences = baseBlocksByKey.get(key) ?? [];

    // 요청사항 9 — server 쪽, base 쪽 각각 내부적으로 이미 갈라져 있는지 먼저 확인한다.
    if (!allWriteValuesEqual(serverOccurrences) || !allWriteValuesEqual(baseOccurrences)) {
      conflictedBlockKeys.push(key);
      continue;
    }

    // 요청사항 7 — (내부적으로 일관된) server 대표값과 base 대표값을 비교한다.
    const serverValues = extractWriteTableFieldValues(serverOccurrences[0].writeTable);
    const baseValues = baseOccurrences.length > 0 ? extractWriteTableFieldValues(baseOccurrences[0].writeTable) : EMPTY_FIELD_VALUES;
    if (!fieldValuesEqual(serverValues, baseValues)) {
      // base 이후 server가 이미 바뀌었다 — 다른 사용자(또는 동일 Block을
      // 편집한 다른 담당자)가 그 사이 저장했다는 뜻. 이 Block은 절대
      // 덮어쓰지 않는다.
      conflictedBlockKeys.push(key);
      continue;
    }

    const currentValues = extractWriteTableFieldValues(currentOccurrenceForUser.writeTable);
    if (fieldValuesEqual(currentValues, serverValues)) continue; // client가 이 Block을 실제로 바꾸지 않았다 — no-op

    // 요청사항 8 — 같은 key를 가진 server의 모든 occurrence(공동업무 사본
    // 전부)에 동일하게 반영해, 사본들이 서로 다른 내용으로 갈라지지 않게 한다.
    for (const occ of serverOccurrences) applyFieldValues(occ.writeTable, currentValues);
  }

  return { merged: cloned, conflictedBlockKeys: [...new Set(conflictedBlockKeys)] };
}
