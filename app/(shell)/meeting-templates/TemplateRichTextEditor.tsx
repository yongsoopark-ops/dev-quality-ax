"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import TextAlign from "@tiptap/extension-text-align";
import { AGENDA_DONE_LABEL } from "@/lib/meetingMinutes/agendaStatus";
import { MEETING_FIELD_KEY } from "@/lib/meetingMinutes/fieldSemantics";
import { buildManualAgendaBlockNodes, planManualAgendaInsertion } from "@/lib/meetingMinutes/pendingAgenda";
import { EMPTY_DOCUMENT_CONTENT } from "@/lib/meetingTemplates/richText";

/**
 * Step 5B-3.3(Rich Text Editor 전환) — Monday Docs/Word처럼 하나의 문서를
 * 자유롭게 쓰는 Editor. 사용자는 block type을 몰라도 된다: 빈 문서를 열면
 * 바로 첫 문단에 커서가 있고, 문단 스타일(H1/H2/H3)·서식(Bold/Italic/
 * Underline/Strike)·목록(글머리표/번호/체크리스트, Tab/Shift+Tab 들여쓰기)·
 * 정렬·글자 크기/색상·링크(Ctrl+K)·표·Undo/Redo는 모두 Toolbar에서 "현재
 * 커서 위치"에 바로 적용한다(요청사항: "제목 block 추가"를 먼저 할 필요가
 * 없어야 한다).
 *
 * 프레임워크는 Tiptap(React 19 공식 지원, 이미 app/(shell)/schedule/
 * RichTextEditor.tsx에서 같은 버전을 쓰고 있어 새 프레임워크를 들이지 않음).
 * Bold/Italic/Underline/Strike/BulletList·OrderedList(Tab/Shift+Tab 포함)/
 * Link/Undo-Redo는 StarterKit 기본 포함, 체크리스트(TaskList/TaskItem)와
 * 텍스트 정렬(TextAlign)도 검증된 공식 Tiptap Extension을 그대로 쓴다 —
 * 새로 만든 구조는 없다(요청사항: "기존 Tiptap extension으로 안전하게 지원
 * 가능하면 그것을 사용").
 */

/**
 * Step(Template/Preview 분리 검증 + Rich Text 매핑 안정화) — 실제로 재현/
 * 확인한 문제: 노드 전체 텍스트를 트리플 클릭 등으로 한 번에 선택한 뒤 다시
 * 타이핑하면, 브라우저가 그 contenteditable 블록의 DOM 요소 자체를 다시
 * 그리면서 커스텀 attribute(data-* / style)를 DOM에서 지워버리고, ProseMirror는
 * (attrs를 직접 관리하는 게 아니라) 바뀐 DOM을 그대로 반영하므로 그 attrs가
 * 기본값으로 리셋돼 버린다. heading의 meetingSection(표시명이 바뀌어도
 * identity 유지)에서 실제로 재현했고, 문단의 lineHeight도 같은 DOM 재작성
 * 경로를 타므로 동일한 위험이 있어 두 attribute 모두 이 안전장치를 쓴다 —
 * 모든 transaction 이후 "바로 이전 상태에서 그 attribute가 있던 노드가
 * 지금도 같은 자리(위치 매핑 기준)에서 같은 타입이라면 그 값을 그대로
 * 복원"한다. Tiptap 커뮤니티에서 "sticky node id"에 흔히 쓰는 것과 같은
 * 패턴(oldState 순회 + tr.mapping으로 새 위치 추적)이다.
 */
function createStickyAttributePlugin(pluginName: string, nodeTypeNames: string[], attributeName: string) {
  return new Plugin({
    key: new PluginKey(pluginName),
    appendTransaction: (transactions, oldState, newState) => {
      if (!transactions.some((t) => t.docChanged)) return null;

      let tr: Transaction | null = null;
      oldState.doc.descendants((node, oldPos) => {
        if (!nodeTypeNames.includes(node.type.name)) return;
        const oldValue = node.attrs[attributeName] as string | null;
        if (!oldValue) return;

        let newPos = oldPos;
        for (const transaction of transactions) newPos = transaction.mapping.map(newPos);
        if (newPos < 0 || newPos >= newState.doc.content.size) return;

        const newNode = newState.doc.nodeAt(newPos);
        if (newNode && nodeTypeNames.includes(newNode.type.name) && newNode.attrs[attributeName] !== oldValue) {
          tr = (tr ?? newState.tr).setNodeAttribute(newPos, attributeName, oldValue);
        }
      });
      return tr;
    },
  });
}

/**
 * heading에 "사용자에게 보이지 않는 내부 attribute"(meetingSection)를
 * 하나 더 붙인다(요청사항). Toolbar/메뉴 어디에도 노출하지 않고, 사용자는
 * 이 값을 보거나 설정할 필요가 없다(lib/meetingMinutes/sectionHeadings.ts가
 * Template 저장 시점에 자동으로 채운다). addGlobalAttributes로 기존 heading
 * node에 속성 하나만 얹는 방식이라 heading 자체의 동작(H1/H2/H3 등 기존
 * UX)은 전혀 바뀌지 않는다.
 */
/** Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일) — meetingSection을
 * heading뿐 아니라 AUTO Table(table, attrs.tableRole="auto")에도 붙인다.
 * "이 Table이 어느 업무구분(REGULAR/SUB/COMMON/EXCEPTION)의 것인지"를 상위
 * heading까지 거슬러 올라가 찾지 않고, Table 자기 자신의 attrs만으로 즉시
 * 판별하기 위함이다(요청사항: "텍스트 parsing이 필요 없어야 한다"). 같은
 * attribute 이름을 heading/table 두 타입에 재사용할 뿐 별도 개념이 아니다
 * ("이 노드가 속한 회의록 섹션"이라는 의미는 두 타입 모두 동일). */
const MEETING_SECTION_ATTRIBUTE_TYPES = ["heading", "table"];

export const MeetingSectionAttribute = Extension.create({
  name: "meetingSectionAttribute",
  addGlobalAttributes() {
    return [
      {
        types: MEETING_SECTION_ATTRIBUTE_TYPES,
        attributes: {
          meetingSection: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-meeting-section"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.meetingSection;
              return value ? { "data-meeting-section": value } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [createStickyAttributePlugin("meetingSectionSticky", MEETING_SECTION_ATTRIBUTE_TYPES, "meetingSection")];
  },
});

/** JSON 배열 attribute 공용 정의(sourceTaskIds/assigneeUserIds가 같은
 * data-* 직렬화 패턴을 공유한다 — parseHTML은 JSON.parse 실패 시 null). */
function jsonArrayAttribute(dataAttrName: string) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute(dataAttrName);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as string[];
      } catch {
        return null;
      }
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[dataAttrName];
      return Array.isArray(value) ? { [dataAttrName]: JSON.stringify(value) } : {};
    },
  };
}

/**
 * Step(담당자별 작성 필터 + 서브 프로젝트 구조 통일, 이후 담당자 View
 * Filter Step에서 sourceTaskIds/assigneeUserId 보완) — 향후 담당자 View
 * Filter/Block 단위 저장을 위한 stable metadata 전부를 여기 모은다.
 *
 * - AUTO Table(그 Task Block의 시작을 알리는 anchor, tableRoleAttribute
 *   참고): sourceTaskIds(항상, 이 Table에 나타나는 모든 Task.id 배열 —
 *   요청사항 0의 1순위 식별자)/sourceTaskId(단수, Task 1건일 때만, 하위
 *   호환용으로 유지)/assigneeUserIds(항상, 담당자 id 배열)/meetingSection.
 * - 프로젝트/goalName 그룹 heading(H3): blockRole="PROJECT_GROUP" — "이
 *   heading은 안건(H3)이 아니라 프로젝트/goalName 그룹 heading이다"를
 *   텍스트 비교 없이 판별(요청사항 6).
 * - "👤 이름" 담당자 구간 문단: assigneeUserId(단수, 그 구간이 특정
 *   담당자면 id, "공통"/"미지정"이면 null) — 필터 option 목록을
 *   documentContent에서 직접 뽑을 때(listAssigneeFilterOptions) 쓴다.
 *
 * 전부 같은 패턴(addGlobalAttributes + sticky 보존) — 값 자체는 전부
 * lib/meetingMinutes/injectDocument.ts가 채워 넣는다.
 */
export const TaskBlockMetadataAttribute = Extension.create({
  name: "taskBlockMetadataAttribute",
  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          sourceTaskIds: jsonArrayAttribute("data-source-task-ids"),
          sourceTaskId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-source-task-id"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.sourceTaskId;
              return value ? { "data-source-task-id": value } : {};
            },
          },
          assigneeUserIds: jsonArrayAttribute("data-assignee-user-ids"),
        },
      },
      {
        // Step(Assignee Header Stable Metadata) — blockRole을 paragraph에도
        // 부여한다: 담당자 header 문단("👤 이름")도 이제 "PROJECT_GROUP"
        // heading과 같은 체계로 blockRole="ASSIGNEE_HEADER"를 갖는다(요청사항
        // 1: "기존 blockRole attribute 체계를 재사용"). 값 자체는 heading과
        // paragraph에서 서로 다른 의미(PROJECT_GROUP/ASSIGNEE_HEADER)로
        // 쓰이지만 attribute 정의(data-block-role round-trip) 자체는 동일하다.
        types: ["heading", "paragraph"],
        attributes: {
          blockRole: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-block-role"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.blockRole;
              return value ? { "data-block-role": value } : {};
            },
          },
        },
      },
      {
        types: ["paragraph"],
        attributes: {
          assigneeUserId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-assignee-user-id"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.assigneeUserId;
              return value ? { "data-assignee-user-id": value } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      createStickyAttributePlugin("sourceTaskIdsSticky", ["table"], "sourceTaskIds"),
      createStickyAttributePlugin("sourceTaskIdSticky", ["table"], "sourceTaskId"),
      createStickyAttributePlugin("assigneeUserIdsSticky", ["table"], "assigneeUserIds"),
      createStickyAttributePlugin("blockRoleSticky", ["heading", "paragraph"], "blockRole"),
      createStickyAttributePlugin("assigneeUserIdSticky", ["paragraph"], "assigneeUserId"),
    ];
  },
});

/** 필터 대상 섹션(REGULAR_PROJECT/SUB_PROJECT/COMMON/EXCEPTION) — 출장은
 * 제외(lib/meetingMinutes/injectDocument.ts의 FILTERABLE_MEETING_SECTIONS와
 * 반드시 같은 값을 유지해야 한다. Client 번들에서 그 모듈을 직접 import하면
 * "use server" 경계를 넘게 되므로, 여기서는 같은 5개 값을 그대로 복제해
 * 둔다). */
const FILTERABLE_SECTIONS_FOR_FILTER = new Set(["REGULAR_PROJECT", "SUB_PROJECT", "COMMON", "EXCEPTION"]);

export const ASSIGNEE_FILTER_PLUGIN_KEY = new PluginKey<{ selectedUserId: string | null; decorations: DecorationSet }>("assigneeFilter");

/**
 * Step(복수 담당 Task Filter/Save 안전성 보완) — 필터 판정 1차 기준을
 * "Task의 assigneeUserIds"에서 "이 Block이 물리적으로 어느 담당자 구역
 * (👤 헤더) 아래에 있는가"로 바꿨다(요청사항 2). 복수 담당 Task는 담당자
 * 마다 자기 구역에 occurrence가 하나씩 따로 존재하므로(build.ts "중복 표시"
 * 정책, §1로 실제 fixture에서 재확인 — 두 occurrence 모두 sourceTaskIds/
 * assigneeUserIds 값은 동일하고 오직 "어느 👤 구역 아래에 있는지"만 다르다),
 * 한 사람의 구역 안에 있는 모든 내용은 이미 전부 그 사람 것이다 — 그래서
 * "구역 전체를 한 번에 보이거나 숨긴다"만으로 §2~5 전부를 만족한다:
 *   - 같은 Task가 두 구역에 있어도 선택 담당자 구역의 occurrence "딱 1번"만
 *     보인다(다른 구역은 통째로 숨어서 자동으로 중복이 사라진다, 요청사항 C).
 *   - 그 구역 안의 goalName heading은 항상 그 구역 소속 Task만 담고 있으므로
 *     "matching Task 없으면 숨김"이 별도 로직 없이 자동 성립한다(요청사항 4).
 *   - 비선택 담당자의 "👤" heading 자체도 구역의 일부라 함께 숨어(요청사항 D),
 *     빈 문단만 남는 잔여 UI가 생기지 않는다(요청사항 3).
 *
 * 문서 최상위(top-level) 노드를 한 번 순회해:
 *   1) heading(level!==3)을 만나면 "지금 어느 top-level 섹션인지"를 갱신한다.
 *      필터 대상 4개(REGULAR/SUB/COMMON/EXCEPTION) 밖(회의 기본정보/회의
 *      규칙/주요 안건/미결 업무/출장 등)이면 특정 담당자 필터가 걸린 동안
 *      그 섹션 전체(다음 top-level heading 전까지)를 숨긴다(요청사항 5 —
 *      Focus mode는 본인의 4개 업무영역 작성에만 집중한다). "전체" 선택
 *      시에는 이 함수 자체가 호출 전에 걸러진다(아래 최상단 조기 반환).
 *   2) 필터 대상 섹션 안에서는 "👤" 구간 표시 문단(attrs.assigneeUserId)을
 *      만날 때마다 "지금 어느 담당자 구역인지"를 갱신하고, 그 구역의 모든
 *      후속 노드(다음 top-level heading 또는 다음 "👤" 문단 전까지 — 그
 *      경계는 다음 반복에서 자연히 갱신되므로 별도 종료 탐색이 필요 없다)를
 *      "이 구역 담당자 === selectedUserId"인지로 표시 여부를 정한다.
 *
 * documentContent 자체는 전혀 바꾸지 않는다(Decoration만 계산 — 요청사항
 * 4의 핵심 조건: "editor.getJSON()은 항상 전체 문서", "숨긴 node도
 * document에는 그대로 존재", "DOM 사후 삭제 금지", "filtered JSON으로
 * 교체 금지"). 필터가 null(전체)이면 즉시 DecorationSet.empty — 전체
 * 문서가 원래 그대로 보인다.
 */
/** export는 오직 단위 테스트(assigneeFilterDecoration.test.ts) 전용이다 —
 * 이 알고리즘 자체가 실제 라이브 Decoration 렌더링 경로에서 쓰이는 바로 그
 * 함수라, DOM/jsdom 없이(이 프로젝트의 vitest는 environment: "node")
 * @tiptap/core의 getSchema + Node.fromJSON으로 만든 실제 ProseMirror
 * 문서에 대해 순수 로직만 검증한다. */
/** Step(Assignee Header Stable Metadata) — "👤 이름 · N건" 구간 표시 문단의
 * 판별 기준을 텍스트 접두사에서 명시적 attrs.blockRole="ASSIGNEE_HEADER"로
 * 바꿨다(요청사항 1/2). 이 문자열은 injectDocument.ts의
 * ASSIGNEE_HEADER_BLOCK_ROLE과 반드시 같은 값이어야 한다 — client 번들이
 * "use server" 경계를 넘지 않도록(FILTERABLE_SECTIONS_FOR_FILTER와 같은 이유)
 * 여기서는 그대로 복제해 둔다. */
const ASSIGNEE_HEADER_BLOCK_ROLE = "ASSIGNEE_HEADER";
/** legacy(이번 Step 이전) 문서 전용 fallback 판별에만 쓰는 텍스트 접두사 —
 * 신규 경로(blockRole 있음)에서는 이 값을 전혀 참조하지 않는다. */
const ASSIGNEE_HEADER_TEXT_PREFIX = "👤 ";

/** 문서(top-level) 안에 이미 blockRole="ASSIGNEE_HEADER"가 심어진 담당자
 * header가 하나라도 있는지 — injectDocument.ts의
 * hasStableAssigneeHeaderMetadata와 동일한 판단 기준(담당자 header는 항상
 * 통째로 재생성되므로 "일부만 legacy" 상태가 되지 않는다). 있으면(신규
 * 구조로 이미 재구성된 문서) isAssigneeHeaderParagraph는 텍스트 fallback을
 * 전혀 쓰지 않는다(요청사항 2/3). */
function hasStableAssigneeHeaderMetadata(doc: PMNode): boolean {
  let found = false;
  doc.forEach((node) => {
    if (!found && node.type.name === "paragraph" && node.attrs.blockRole === ASSIGNEE_HEADER_BLOCK_ROLE) found = true;
  });
  return found;
}

/** 담당자 header 판별 우선순위(요청사항 3, injectDocument.ts의
 * isAssigneeHeaderParagraph와 동일한 기준):
 *   1) attrs.blockRole === "ASSIGNEE_HEADER" — 신규 안정 경로, 텍스트와 무관.
 *   2) legacyFallbackAllowed(문서 전체에 위 metadata가 전혀 없음)일 때만
 *      "👤 " 텍스트 접두사로 legacy header를 인식한다.
 * legacyFallbackAllowed가 false면 일반 문단의 텍스트가 우연히 "👤 "로
 * 시작해도 절대 header로 오인하지 않는다(요청사항 C). */
function isAssigneeHeaderParagraph(node: PMNode, legacyFallbackAllowed: boolean): boolean {
  if (node.type.name !== "paragraph") return false;
  if (node.attrs.blockRole === ASSIGNEE_HEADER_BLOCK_ROLE) return true;
  if (!legacyFallbackAllowed) return false;
  return node.textContent.startsWith(ASSIGNEE_HEADER_TEXT_PREFIX);
}

export function computeAssigneeFilterDecorations(doc: PMNode, selectedUserId: string | null): DecorationSet {
  if (!selectedUserId) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  function hide(node: PMNode, pos: number) {
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "am-filter-hidden" }));
  }

  const legacyFallbackAllowed = !hasStableAssigneeHeaderMetadata(doc);

  let sectionIsFilterable = false;
  // null이면 "아직 이 섹션에서 어떤 담당자 구역에도 들어가지 않음"(공통/
  // 미지정 구역 포함) — selectedUserId(실제 담당자 id)와 절대 같을 수 없어
  // 안전하게 "숨김"으로 처리된다.
  let currentAssigneeUserId: string | null = null;

  doc.forEach((node, pos) => {
    if (node.type.name === "heading" && node.attrs.level !== 3) {
      const section = typeof node.attrs.meetingSection === "string" ? node.attrs.meetingSection : null;
      sectionIsFilterable = !!section && FILTERABLE_SECTIONS_FOR_FILTER.has(section);
      currentAssigneeUserId = null;
      if (!sectionIsFilterable) hide(node, pos); // 요청사항 5: Focus mode에서 공용영역 heading 자체도 숨김
      return;
    }

    if (!sectionIsFilterable) {
      hide(node, pos); // 요청사항 5: 그 섹션에 속한 모든 내용
      return;
    }

    if (isAssigneeHeaderParagraph(node, legacyFallbackAllowed)) {
      currentAssigneeUserId = typeof node.attrs.assigneeUserId === "string" ? node.attrs.assigneeUserId : null;
    }

    if (currentAssigneeUserId !== selectedUserId) hide(node, pos);
  });

  return DecorationSet.create(doc, decorations);
}

const AssigneeFilterAttribute = Extension.create({
  name: "assigneeFilterAttribute",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ASSIGNEE_FILTER_PLUGIN_KEY,
        state: {
          init: (_, state): { selectedUserId: string | null; decorations: DecorationSet } => ({
            selectedUserId: null,
            decorations: computeAssigneeFilterDecorations(state.doc, null),
          }),
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(ASSIGNEE_FILTER_PLUGIN_KEY) as string | null | undefined;
            const selectedUserId = meta !== undefined ? meta : prev.selectedUserId;
            if (meta === undefined && !tr.docChanged) return prev;
            return { selectedUserId, decorations: computeAssigneeFilterDecorations(newState.doc, selectedUserId) };
          },
        },
        props: {
          decorations(state) {
            return ASSIGNEE_FILTER_PLUGIN_KEY.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});

/**
 * Step(회의록 줄간격 + 주간 간트 가독성 개선) — 문단/제목/리스트의 줄 간격을
 * Toolbar에서 조절한다(요청사항). line-height는 마크가 아니라 block(문단/
 * 제목) 자체의 속성이라 TextAlign과 같은 "node attribute" 방식으로 구현한다
 * — 새 Tiptap extension 패키지를 추가하지 않고, 이미 MeetingSectionAttribute
 * 에서 쓴 것과 같은 addGlobalAttributes 패턴을 재사용한다(요청사항: "기존
 * Tiptap editor 구조 재사용"). heading/paragraph 두 타입에만 적용하면
 * 리스트도 자동으로 커버된다 — bulletList/orderedList/taskList의 각 항목은
 * 내부적으로 paragraph를 담고 있기 때문이다(app/(shell)/meeting-templates/
 * richText.ts의 buildListNode 구조 참고).
 *
 * 별도의 addCommands 등록 없이 editor.chain().command(...)로 선택 영역
 * 안의 heading/paragraph 노드 전부에 한 번에 적용한다(TextAlign류 확장이
 * 내부적으로 하는 것과 같은 방식) — 여러 문단에 걸쳐 선택해도 한 번에
 * 반영된다. meetingSection과 같은 이유로 sticky 안전장치도 함께 둔다 —
 * 값을 지정해 둔 문단을 나중에 통째로 다시 타이핑해도 line-height가
 * 사라지지 않아야 한다.
 */
const LINE_HEIGHT_TYPES = ["heading", "paragraph"];

const LineHeight = Extension.create({
  name: "lineHeight",
  addGlobalAttributes() {
    return [
      {
        types: LINE_HEIGHT_TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.lineHeight || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.lineHeight;
              return value ? { style: `line-height: ${value}` } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [createStickyAttributePlugin("lineHeightSticky", LINE_HEIGHT_TYPES, "lineHeight")];
  },
});

/**
 * Step(파트 주간회의 Table UX + AUTO 필드 개편) — Table의 라벨 셀(구분 열)에
 * "사용자에게 보이지 않는 내부 attribute"(fieldKey)를 붙인다. meetingSection/
 * lineHeight와 완전히 같은 패턴(addGlobalAttributes + sticky 보존)이다 —
 * Table로 문서를 바꿔도 다시 "지금 화면에 보이는 라벨 문자열"에 의존하지
 * 않기 위함이다(요청사항: "Table field도 내부적으로 안정적인 semantic
 * identity를 갖도록"). 실제 값 채우기/추론은 lib/meetingMinutes/
 * fieldSemantics.ts가 담당하고, 여기서는 Tiptap 스키마에 속성 하나를
 * 얹고 round-trip 중 사라지지 않게 지키는 역할만 한다.
 */
const FieldKeyAttribute = Extension.create({
  name: "fieldKeyAttribute",
  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          fieldKey: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-field-key"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.fieldKey;
              return value ? { "data-field-key": value } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [createStickyAttributePlugin("fieldKeySticky", ["tableCell", "tableHeader"], "fieldKey")];
  },
});

/**
 * Step(AUTO 표 Compact화) — Schedule AUTO Table(업무명 | 진행 일정 |
 * 담당자, 3열)만 compact하게(요청사항: "60~70% 수준") 폭을 줄이려 했으나,
 * CSS `:has()`로 "그 표가 3열인지"를 구조적으로 추론하는 방식은 이 Table
 * 자체(행이 아니라 table 요소)에 적용했을 때 이 앱이 쓰는 브라우저 환경
 * 에서 실제로 반영되지 않는 문제를 실측으로 확인했다(같은 :has() 패턴이
 * 행 단위 셀 폭 조정에는 정상 동작하는 것과 대조적). 그래서 fieldKey/
 * meetingSection과 같은 패턴으로 table 노드 자체에 "사용자에게 보이지
 * 않는 내부 attribute"(tableRole)를 붙여, CSS가 구조 추론이 아니라 이
 * attribute만 보고 확실하게 표를 식별하게 한다. */
export const TableRoleAttribute = Extension.create({
  name: "tableRoleAttribute",
  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          tableRole: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-table-role"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.tableRole;
              return value ? { "data-table-role": value } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [createStickyAttributePlugin("tableRoleSticky", ["table"], "tableRole")];
  },
});

/**
 * Step(Schedule/Meeting Minutes V1.1 사용성 개선 — 미결 안건 이월) — "안건
 * N" H3 heading에 "사용자에게 보이지 않는 내부 attribute"(pendingAgendaId)
 * 를 붙인다. "미결 안건 불러오기"가 MeetingMinutesPendingAgenda Row 하나를
 * 문서에 삽입할 때 그 Row의 id를 이 값으로 심어 두고(lib/meetingMinutes/
 * pendingAgenda.ts insertPendingAgendaBlocks), 재클릭 시 문서 안에 이미
 * 있는 id는 건너뛰어 중복 삽입을 막는 데 쓴다. fieldKey/meetingSection과
 * 완전히 같은 패턴(addGlobalAttributes + sticky 보존)이라, 이 heading을
 * 다시 타이핑하거나 문서를 저장/재로드해도 값이 사라지지 않는다(실제
 * 저장→재로드 라운드트립으로 검증 — 완료 보고 참고).
 */
const PendingAgendaIdAttribute = Extension.create({
  name: "pendingAgendaIdAttribute",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          pendingAgendaId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-pending-agenda-id"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.pendingAgendaId;
              return value ? { "data-pending-agenda-id": value } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [createStickyAttributePlugin("pendingAgendaIdSticky", ["heading"], "pendingAgendaId")];
  },
});

/**
 * Step(주요 안건 신규 추가분 보존 정책) — "안건 N" H3 heading에 origin
 * ("TEMPLATE"/"CARRIED"/"MANUAL", lib/meetingMinutes/pendingAgenda.ts
 * AGENDA_ORIGIN 참고)을 심는다. pendingAgendaId와 완전히 같은 패턴
 * (addGlobalAttributes + sticky 보존)이라 문서를 저장/재로드하거나 다시
 * 타이핑해도 값이 사라지지 않는다. attrs가 없는(이 기능 이전) 기존 heading은
 * default:null이고, reset 로직(lib/meetingMinutes/draft.ts)이 null을 항상
 * TEMPLATE으로 취급하므로 기존 문서 호환에 문제가 없다.
 */
const AgendaOriginAttribute = Extension.create({
  name: "agendaOriginAttribute",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          agendaOrigin: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-agenda-origin"),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.agendaOrigin;
              return value ? { "data-agenda-origin": value } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [createStickyAttributePlugin("agendaOriginSticky", ["heading"], "agendaOrigin")];
  },
});

/**
 * Step(Schedule/Meeting Minutes V1.1 사용성 개선 — 주요 안건 완료/미결) —
 * 실제 DB를 조회해 확인한 결과 "완료 여부" 값 셀은 인터랙티브 체크박스가
 * 아니라 그냥 고정 텍스트("☐")였다(클릭해도 반응 없던 원인). 체크박스
 * 표현을 없애고, 커서가 그 셀 안에 있을 때만 나타나는 "완료 | 미결"
 * 2-way segmented control로 바꾼다 — 셀 자체는 여전히 평범한 tableCell 안
 * paragraph 텍스트라(새 Tiptap Node/NodeView를 만들지 않는다) 문서 구조도
 * DOCX 변환(docx.ts는 셀 텍스트를 그대로 옮길 뿐)도 전혀 바뀌지 않는다.
 */
/** fieldKey는 라벨 셀(첫 칸, "완료 여부")에만 붙어 있고 값 셀(둘째 칸,
 * "완료"|"미결" 텍스트)에는 없다(fieldSemantics.ts와 완전히 같은 관례 —
 * "라벨 | 값"이 한 행의 인접한 두 칸). 그래서 커서 조상 중 tableCell이
 * 아니라 tableRow를 찾아, 그 행의 첫 칸이 AGENDA_DONE인지로 판별한다 —
 * 커서가 라벨/값 어느 칸에 있어도(둘 다 같은 행이므로) 똑같이 동작한다. */
function findAgendaDoneRowDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "tableRow" && node.childCount >= 2 && node.child(0).attrs.fieldKey === MEETING_FIELD_KEY.AGENDA_DONE) {
      return depth;
    }
  }
  return null;
}

function AgendaDoneToggle({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { $from } = editor.state.selection;
      const depth = findAgendaDoneRowDepth($from);
      if (depth === null) return { active: false, current: "" };
      return { active: true, current: $from.node(depth).child(1).textContent.trim() };
    },
  });

  function setStatus(label: string) {
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const { $from } = state.selection;
        const depth = findAgendaDoneRowDepth($from);
        if (depth === null) return false;
        const rowNode = $from.node(depth);
        const rowStart = $from.before(depth); // row 노드가 시작하는 위치(여는 토큰 자리)
        const labelCellNode = rowNode.child(0);
        const valueCellNode = rowNode.child(1);
        const valueCellStart = rowStart + 1 + labelCellNode.nodeSize; // 라벨 셀 바로 다음 = 값 셀 시작
        const from = valueCellStart + 1; // 값 셀 내부(여는 토큰 다음)
        const to = valueCellStart + valueCellNode.nodeSize - 1; // 값 셀 내부 끝(닫는 토큰 앞)
        const paragraph = state.schema.nodes.paragraph.create(null, state.schema.text(label));
        tr.replaceWith(from, to, paragraph);
        return true;
      })
      .run();
  }

  if (!state.active) return null;

  return (
    <span className="flex items-center overflow-hidden rounded border border-navy-100" onMouseDown={(e) => e.preventDefault()}>
      <button
        type="button"
        onClick={() => setStatus(AGENDA_DONE_LABEL.DONE)}
        className={`px-2 py-1 text-xs font-medium ${
          state.current === AGENDA_DONE_LABEL.DONE ? "bg-navy-900 text-white" : "text-navy-950/70 hover:bg-navy-50"
        }`}
      >
        완료
      </button>
      <button
        type="button"
        onClick={() => setStatus(AGENDA_DONE_LABEL.PENDING)}
        className={`px-2 py-1 text-xs font-medium ${
          state.current !== AGENDA_DONE_LABEL.DONE ? "bg-navy-900 text-white" : "text-navy-950/70 hover:bg-navy-50"
        }`}
      >
        미결
      </button>
    </span>
  );
}

const LINE_HEIGHT_OPTIONS = [
  { label: "좁게", value: "1.0" },
  { label: "보통", value: "1.3" },
  { label: "넓게", value: "1.6" },
];

function LineHeightSelect({ editor }: { editor: Editor }) {
  // 아직 명시적으로 지정한 적 없는 문단/제목은 attrs.lineHeight가 null이다
  // — 그 상태를 "보통"으로 보여준다(요청사항: 최소 옵션 좁게/보통/넓게 중
  // 하나가 항상 선택돼 있어야 자연스럽다). 실제로 값을 고르기 전까지는
  // documentContent에 아무 attrs도 추가되지 않는다.
  const current = useEditorState({
    editor,
    selector: ({ editor }) => {
      const fromHeading = editor.getAttributes("heading").lineHeight as string | null | undefined;
      const fromParagraph = editor.getAttributes("paragraph").lineHeight as string | null | undefined;
      return fromHeading || fromParagraph || "1.3";
    },
  });

  function handleChange(next: string) {
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const { from, to } = state.selection;
        let applied = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (LINE_HEIGHT_TYPES.includes(node.type.name)) {
            tr.setNodeAttribute(pos, "lineHeight", next);
            applied = true;
          }
        });
        return applied;
      })
      .run();
  }

  return (
    <select
      value={current}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => handleChange(e.target.value)}
      title="줄 간격"
      className="rounded border border-navy-100 bg-white px-1.5 py-1 text-xs"
    >
      {LINE_HEIGHT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

const FONT_SIZE_OPTIONS = [
  { label: "작게", value: "12px" },
  { label: "보통", value: "" },
  { label: "크게", value: "18px" },
  { label: "아주 크게", value: "22px" },
];

const TEXT_COLOR_OPTIONS = [
  { label: "기본색", value: "" },
  { label: "빨강", value: "#dc2626" },
  { label: "주황", value: "#ea580c" },
  { label: "초록", value: "#16a34a" },
  { label: "파랑", value: "#2563eb" },
  { label: "보라", value: "#7c3aed" },
  { label: "회색", value: "#64748b" },
];

function ToolbarButton({
  active,
  disabled,
  onClick,
  label,
  title,
  className,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: ReactNode;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      // Toolbar 클릭이 Editor의 선택(selection)을 지우기 전에 mousedown에서
      // 미리 막는다 — 그러지 않으면 클릭 시점에 선택이 풀려 Bold/색상 등이
      // "지금 선택한 텍스트"가 아니라 커서 위치에만 적용된다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex min-w-[1.75rem] items-center justify-center rounded px-1.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? "bg-navy-900 text-white" : "text-navy-950/70 hover:bg-navy-50"
      } ${className ?? ""}`}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px shrink-0 self-center bg-navy-100" />;
}

/** 정렬 아이콘 — 별도 아이콘 폰트 없이, 짧은 bar 3개를 정렬 방향에 맞춰
 * 배치해 왼쪽/가운데/오른쪽 정렬을 시각적으로 표현한다. */
function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const itemsClass = align === "left" ? "items-start" : align === "center" ? "items-center" : "items-end";
  return (
    <span className={`flex w-3.5 flex-col gap-[2.5px] ${itemsClass}`} aria-hidden="true">
      <span className="h-[2px] w-full rounded-sm bg-current" />
      <span className="h-[2px] w-[65%] rounded-sm bg-current" />
      <span className="h-[2px] w-[85%] rounded-sm bg-current" />
    </span>
  );
}

function ParagraphStyleSelect({ editor }: { editor: Editor }) {
  // Tiptap v3부터 useEditor는 기본적으로 매 transaction마다 리렌더하지
  // 않는다(성능 최적화, shouldRerenderOnTransaction 기본값 false) — 그래서
  // Toolbar가 "지금 커서 위치"를 반영하려면 useEditorState로 필요한 값만
  // 구독해야 한다. editor.isActive(...)를 렌더 중 직접 읽기만 하면 커서를
  // 옮겨도 버튼 활성 표시가 갱신되지 않는다.
  const value = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor.isActive("heading", { level: 1 })
        ? "h1"
        : editor.isActive("heading", { level: 2 })
          ? "h2"
          : editor.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
  });

  function handleChange(next: string) {
    const chain = editor.chain().focus();
    if (next === "p") chain.setParagraph().run();
    else chain.setHeading({ level: Number(next.slice(1)) as 1 | 2 | 3 }).run();
  }

  return (
    <select
      value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => handleChange(e.target.value)}
      title="문단 스타일"
      className="rounded border border-navy-100 bg-white px-1.5 py-1 text-xs"
    >
      <option value="p">일반 텍스트</option>
      <option value="h1">H1 큰 제목</option>
      <option value="h2">H2 중간 제목</option>
      <option value="h3">H3 소제목</option>
    </select>
  );
}

function FontSizeSelect({ editor }: { editor: Editor }) {
  const current = useEditorState({
    editor,
    selector: ({ editor }) => (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "",
  });
  function handleChange(next: string) {
    const chain = editor.chain().focus();
    if (next) chain.setFontSize(next).run();
    else chain.unsetFontSize().run();
  }
  return (
    <select
      value={current}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => handleChange(e.target.value)}
      title="글자 크기"
      className="rounded border border-navy-100 bg-white px-1.5 py-1 text-xs"
    >
      {FONT_SIZE_OPTIONS.map((opt) => (
        <option key={opt.label} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ColorPicker({ editor }: { editor: Editor }) {
  const current = useEditorState({
    editor,
    selector: ({ editor }) => (editor.getAttributes("textStyle").color as string | undefined) ?? "",
  });
  const presetMatch = TEXT_COLOR_OPTIONS.some((o) => o.value === current) ? current : "";

  function applyColor(next: string) {
    const chain = editor.chain().focus();
    if (next) chain.setColor(next).run();
    else chain.unsetColor().run();
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={presetMatch}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => applyColor(e.target.value)}
        title="글자 색상"
        className="rounded border border-navy-100 bg-white px-1.5 py-1 text-xs"
      >
        {TEXT_COLOR_OPTIONS.map((opt) => (
          <option key={opt.label} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <input
        type="color"
        value={current || "#101d38"}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => applyColor(e.target.value)}
        title="사용자 지정 색상"
        className="h-6 w-6 cursor-pointer rounded border border-navy-100 bg-white p-0"
      />
    </div>
  );
}

/** 선택한 텍스트에 링크를 걸거나(요청사항: "텍스트 선택 → Ctrl+K → URL 입력
 * 작은 popup → 적용"), 이미 링크인 곳에서는 URL 수정/제거를 할 수 있다.
 * Toolbar Link 버튼과 Ctrl+K 둘 다 이 popup을 그대로 연다(요청사항). */
function LinkPopup({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [url, setUrl] = useState((editor.getAttributes("link").href as string | undefined) ?? "");
  const hasLink = editor.isActive("link");

  function apply() {
    const trimmed = url.trim();
    if (!trimmed) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
    onClose();
  }
  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  }

  return (
    <div
      className="absolute left-0 top-full z-30 mt-1 flex items-center gap-1.5 rounded-md border border-navy-100 bg-white p-2 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
        }
      }}
    >
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://..."
        className="w-56 rounded border border-navy-100 px-2 py-1 text-xs outline-none focus:border-navy-300"
      />
      <button type="button" onClick={apply} className="shrink-0 rounded bg-navy-900 px-2 py-1 text-xs font-medium text-white">
        적용
      </button>
      {hasLink && (
        <button type="button" onClick={remove} className="shrink-0 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
          제거
        </button>
      )}
      <button type="button" onClick={onClose} className="shrink-0 rounded px-1.5 py-1 text-xs text-navy-950/40 hover:bg-navy-50">
        ✕
      </button>
    </div>
  );
}

/**
 * Step 5B-3.4(Editor 사용성 보완) — 기능을 역할별로 묶어 가독성을 높인다
 * (요청사항 순서): Undo/Redo · 문단 스타일 · Bold/Italic/Underline/Strike ·
 * 목록(글머리표/번호/체크리스트) · 정렬(좌/중/우) · 글자 크기/색상 ·
 * 링크/표. 각 그룹은 Divider로만 구분하고, 좁은 화면에서는 flex-wrap으로
 * 자연스럽게 다음 줄로 넘어간다(반응형 유지).
 */
/**
 * Step(MANUAL 안건 생성 범위 제한) — "안건 추가" 버튼. 커서 위치와 무관하게
 * 항상 "주요 안건" 섹션의 마지막 안건 뒤에 삽입한다(요청사항: MANUAL은
 * "주요 안건에 신규 추가된 안건"만 의미해야 하므로, 커서가 다른 섹션(정규
 * 업무 등)에 있어도 그쪽에 잘못 삽입되면 안 된다).
 *
 * 실제 계산(어디에 몇 번으로 넣을지)은 순수 함수 planManualAgendaInsertion
 * (lib/meetingMinutes/pendingAgenda.ts, DOM 없이 unit test됨)에 전부
 * 위임한다 — 여기서는 그 결과(배열 index)를 editor.state.doc의 최상위
 * 자식을 같은 순서로 순회해 ProseMirror 위치로 변환하는 얇은 글루만
 * 담당한다(editor.getJSON()의 content 배열과 editor.state.doc의 최상위
 * 자식은 항상 1:1 대응 — 같은 문서를 두 표현으로 본 것뿐이다).
 *
 * "주요 안건" 섹션을 찾지 못하면 planManualAgendaInsertion이 에러를
 * 반환하고, 이 함수는 임의 위치에 넣지 않고 그 메시지를 그대로 돌려줘
 * 호출부가 안내만 하고 중단하게 한다.
 */
function insertManualAgendaBlock(editor: Editor): string | null {
  const content = editor.getJSON().content ?? [];
  const plan = planManualAgendaInsertion(content);
  if ("error" in plan) return plan.error;

  // plan.insertAtIndex는 "주요 안건" 섹션 바로 다음(level<=2) heading의 배열
  // index다(또는 섹션이 문서 끝까지면 content.length) — 그 heading이
  // 시작되는 ProseMirror 위치가 곧 "주요 안건 섹션의 끝" 위치다.
  let insertPos: number | null = plan.insertAtIndex >= content.length ? editor.state.doc.content.size : null;
  if (insertPos === null) {
    editor.state.doc.forEach((node, offset, index) => {
      if (index === plan.insertAtIndex) insertPos = offset;
    });
  }
  if (insertPos === null) {
    return "\"주요 안건\" 영역의 위치를 찾지 못해 안건을 추가하지 못했습니다.";
  }

  const nodes = buildManualAgendaBlockNodes(`안건 ${plan.agendaNumber}`);
  editor.chain().focus().insertContentAt(insertPos, nodes).run();
  return null;
}

function Toolbar({ editor, enableManualAgenda }: { editor: Editor; enableManualAgenda: boolean }) {
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);
  // Step(MANUAL 안건 생성 범위 제한) — "주요 안건" 영역을 찾지 못했을 때
  // 임의 위치에 넣지 않고 안내만 하고 멈춘다(요청사항). 기존 TemplateEditor.tsx의
  // {error && <p className="text-xs text-red-600">...</p>} 패턴을 그대로 따른다.
  const [manualAgendaError, setManualAgendaError] = useState<string | null>(null);

  // Bold/Italic/목록/정렬/표/Undo-Redo/링크 버튼의 활성·비활성 표시를 전부
  // 여기 한 곳에서 구독한다(useEditorState 이유는 ParagraphStyleSelect 주석
  // 참고) — "현재 선택 상태가 Toolbar에 즉시 반영되어야 한다"는 요청사항.
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      isBold: editor.isActive("bold"),
      isItalic: editor.isActive("italic"),
      isUnderline: editor.isActive("underline"),
      isStrike: editor.isActive("strike"),
      isBulletList: editor.isActive("bulletList"),
      isOrderedList: editor.isActive("orderedList"),
      isTaskList: editor.isActive("taskList"),
      isAlignLeft: editor.isActive({ textAlign: "left" }),
      isAlignCenter: editor.isActive({ textAlign: "center" }),
      isAlignRight: editor.isActive({ textAlign: "right" }),
      isLink: editor.isActive("link"),
      canLink: !editor.state.selection.empty || editor.isActive("link"),
      isTable: editor.isActive("table"),
    }),
  });

  // Ctrl+K(요청사항: "반드시 Ctrl+K 단축키 지원") — Editor에 포커스가 있을 때만
  // 동작해야 하므로 window가 아니라 Tiptap의 실제 contentEditable DOM에 붙인다.
  useEffect(() => {
    const dom = editor.view.dom;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!editor.state.selection.empty || editor.isActive("link")) setLinkPopupOpen(true);
      }
    }
    dom.addEventListener("keydown", handleKeyDown);
    return () => dom.removeEventListener("keydown", handleKeyDown);
  }, [editor]);

  return (
    // Step(파트 주간회의 Table UX + AUTO 필드 개편) — 긴 회의록을 아래에서
    // 편집해도 Toolbar가 계속 보이도록 sticky로 고정한다(요청사항). App
    // Header(전역 알림 벨 등)는 z-30이라 그보다 낮은 z-20을 써서 절대
    // 겹치지 않게 하고, editor 영역(이 Component의 스크롤 조상 — 회의록
    // 작성 화면의 overflow-y-auto 컨테이너) 안에서만 붙는다 — 배경을
    // 반투명(bg-navy-50/40)에서 불투명(bg-navy-50)으로 바꿔 sticky 상태에서
    // 아래 문서 내용이 비쳐 보이지 않게 한다.
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 rounded-t-md border-b border-navy-100 bg-navy-50 px-2 py-1.5">
      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!toolbarState.canUndo} label="↺" title="실행 취소 (Ctrl+Z)" />
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!toolbarState.canRedo} label="↻" title="다시 실행 (Ctrl+Shift+Z)" />
      <Divider />
      <ParagraphStyleSelect editor={editor} />
      <Divider />
      <ToolbarButton active={toolbarState.isBold} onClick={() => editor.chain().focus().toggleBold().run()} label="B" title="굵게 (Ctrl+B)" className="font-bold" />
      <ToolbarButton active={toolbarState.isItalic} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" title="기울임 (Ctrl+I)" className="italic" />
      <ToolbarButton
        active={toolbarState.isUnderline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        label="U"
        title="밑줄 (Ctrl+U)"
        className="underline"
      />
      <ToolbarButton
        active={toolbarState.isStrike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="S"
        title="취소선"
        className="line-through"
      />
      <Divider />
      <ToolbarButton active={toolbarState.isBulletList} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" title="글머리 목록" />
      <ToolbarButton active={toolbarState.isOrderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="1." title="번호 목록" />
      <ToolbarButton active={toolbarState.isTaskList} onClick={() => editor.chain().focus().toggleTaskList().run()} label="☑" title="체크리스트" />
      <Divider />
      <ToolbarButton
        active={toolbarState.isAlignLeft}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        label={<AlignIcon align="left" />}
        title="왼쪽 정렬"
      />
      <ToolbarButton
        active={toolbarState.isAlignCenter}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        label={<AlignIcon align="center" />}
        title="가운데 정렬"
      />
      <ToolbarButton
        active={toolbarState.isAlignRight}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        label={<AlignIcon align="right" />}
        title="오른쪽 정렬"
      />
      <Divider />
      <LineHeightSelect editor={editor} />
      <AgendaDoneToggle editor={editor} />
      <Divider />
      <FontSizeSelect editor={editor} />
      <ColorPicker editor={editor} />
      <Divider />
      <div className="relative">
        <ToolbarButton
          active={toolbarState.isLink}
          disabled={!toolbarState.canLink}
          onClick={() => setLinkPopupOpen((v) => !v)}
          label="🔗"
          title={toolbarState.canLink ? "링크 (Ctrl+K)" : "링크를 걸 텍스트를 먼저 선택하세요"}
        />
        {linkPopupOpen && <LinkPopup editor={editor} onClose={() => setLinkPopupOpen(false)} />}
      </div>
      <ToolbarButton
        onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()}
        label="▦"
        title="표 삽입"
      />
      {enableManualAgenda && (
        <div className="relative">
          <ToolbarButton
            onClick={() => setManualAgendaError(insertManualAgendaBlock(editor))}
            label="📌+"
            title="안건 추가 — 완료 처리와 무관하게 항상 다음 회의록에도 그대로 유지됩니다"
          />
          {manualAgendaError && (
            <p className="absolute top-full left-0 z-10 mt-1 w-max max-w-xs rounded bg-white p-1.5 text-xs text-red-600 shadow-sm">
              {manualAgendaError}
            </p>
          )}
        </div>
      )}
      {toolbarState.isTable && (
        <>
          <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} label="+행" title="아래 행 추가" />
          <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} label="+열" title="오른쪽 열 추가" />
          <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()} label="행✕" title="현재 행 삭제" />
          <ToolbarButton onClick={() => editor.chain().focus().deleteColumn().run()} label="열✕" title="현재 열 삭제" />
          <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} label="표✕" title="표 삭제" />
        </>
      )}
    </div>
  );
}

export function TemplateRichTextEditor({
  value,
  onChange,
  enableManualAgenda = false,
  assigneeFilterUserId = null,
}: {
  value: JSONContent;
  onChange: (content: JSONContent) => void;
  /** Step(MANUAL 안건 생성 범위 제한) — 이 Editor는 Template 편집(meeting-templates)과
   * 실제 Meeting Minutes Draft 편집(meeting-minutes-preview)에 공용으로
   * 쓰인다. "안건 추가"는 Draft 편집에서만 의미가 있다(Template에는 아직
   * 실제로 진행 중인 회의가 없어 "신규 추가된 안건" 개념 자체가 성립하지
   * 않는다) — 그래서 기본값 false, Draft 쪽 호출부(MeetingMinutesPreviewClient.tsx)만
   * 명시적으로 true를 넘긴다. 컴포넌트를 복제하지 않고 이 prop 하나로
   * 갈린다(요청사항). */
  enableManualAgenda?: boolean;
  /** Step(담당자 View Filter + 안전한 Block 단위 저장) — 선택된 담당자
   * User.id, null이면 "전체"(필터 없음). documentContent 자체는 절대 바꾸지
   * 않고 Decoration으로만 화면 표시를 바꾼다(AssigneeFilterAttribute 참고).
   * enableManualAgenda와 같은 이유로 기본값 null — Template 편집 화면은 이
   * prop을 아예 넘기지 않아 필터 개념 자체가 없다. */
  assigneeFilterUserId?: string | null;
}) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" } },
        // Toolbar/단축키에서 명시적으로 제공하지 않는 노드는 마크다운 입력
        // 규칙(예: "> ", "```")으로도 만들어지지 않게 꺼둔다 — 사용자가
        // Toolbar에 없는 개념을 몰라도 되게 한다(요청사항).
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        code: false,
      }),
      TextStyle,
      Color,
      FontSize,
      TableKit.configure({ table: { resizable: false } }),
      // 체크리스트(요청사항 2) — 별도 "회의용 block"을 만들지 않고, 검증된
      // 공식 Extension을 그대로 쓴다. nested:false — 요청사항에 들여쓰기
      // 요구가 없어 일반 목록보다 단순하게 유지한다. checked 상태는
      // node.attrs.checked로 문서 JSON에 그대로 저장되므로 새로고침해도
      // 별도 처리 없이 유지된다.
      TaskList,
      TaskItem.configure({ nested: false }),
      // 텍스트 정렬(요청사항 3) — heading/paragraph에만 적용, 좌/중/우만
      // 노출한다(요청사항: "최소 왼쪽/가운데/오른쪽").
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
      Placeholder.configure({ placeholder: "여기에 입력하세요..." }),
      MeetingSectionAttribute,
      LineHeight,
      FieldKeyAttribute,
      TableRoleAttribute,
      PendingAgendaIdAttribute,
      AgendaOriginAttribute,
      TaskBlockMetadataAttribute,
      AssigneeFilterAttribute,
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      // tiptap-content--meeting-minutes — 이 Editor(Template/회의록 작성)에만
      // 적용되는 보조 class(app/globals.css). Schedule 댓글도 같은
      // .tiptap-content를 공유하므로, 문단 간격 조정은 여기서만 스코프를
      // 좁혀 적용해 그쪽 회귀를 막는다(요청사항: 회의록 가독성에 맞게 조정).
      attributes: { class: "tiptap-content tiptap-content--meeting-minutes min-h-[420px] px-2 py-4 text-sm focus:outline-none" },
    },
  });

  // Step(담당자 View Filter + 안전한 Block 단위 저장) — 필터 선택이 바뀔
  // 때마다 빈 meta transaction 하나만 dispatch한다(문서는 전혀 안 바뀐다,
  // tr.docChanged=false) — AssigneeFilterAttribute의 plugin state가 이
  // meta를 읽어 Decoration만 다시 계산한다. editor.getJSON()에는 이 필터
  // 상태가 전혀 반영되지 않는다(요청사항 4/13: filter는 React state로만
  // 관리하고 documentContent/DB에는 저장하지 않는다).
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(ASSIGNEE_FILTER_PLUGIN_KEY, assigneeFilterUserId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, assigneeFilterUserId]);

  if (!editor) return null;

  return (
    // overflow-hidden을 쓰지 않는다 — Toolbar의 sticky는 이 wrapper가 아니라
    // 이 Component 바깥의 스크롤 조상(회의록 작성 화면의 overflow-y-auto
    // 컨테이너) 기준으로 동작해야 하는데, overflow-hidden은 그 자체로 새
    // clipping 영역을 만들어 sticky가 이 작은 wrapper 안에서만(사실상 항상
    // 원래 자리에) 붙어버린다. 모서리 둥글기는 Toolbar/EditorContent 양쪽에
    // 나눠 줘서(rounded-t-md/rounded-b-md) 시각적으로는 예전과 동일하다.
    <div className="rounded-md border border-navy-100 bg-white shadow-sm">
      <Toolbar editor={editor} enableManualAgenda={enableManualAgenda} />
      <div className="overflow-hidden rounded-b-md">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export { EMPTY_DOCUMENT_CONTENT };
