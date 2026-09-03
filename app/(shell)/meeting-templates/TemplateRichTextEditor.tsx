"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import TextAlign from "@tiptap/extension-text-align";
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
const MeetingSectionAttribute = Extension.create({
  name: "meetingSectionAttribute",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
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
    return [createStickyAttributePlugin("meetingSectionSticky", ["heading"], "meetingSection")];
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
const TableRoleAttribute = Extension.create({
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
function Toolbar({ editor }: { editor: Editor }) {
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);

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
}: {
  value: JSONContent;
  onChange: (content: JSONContent) => void;
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

  if (!editor) return null;

  return (
    // overflow-hidden을 쓰지 않는다 — Toolbar의 sticky는 이 wrapper가 아니라
    // 이 Component 바깥의 스크롤 조상(회의록 작성 화면의 overflow-y-auto
    // 컨테이너) 기준으로 동작해야 하는데, overflow-hidden은 그 자체로 새
    // clipping 영역을 만들어 sticky가 이 작은 wrapper 안에서만(사실상 항상
    // 원래 자리에) 붙어버린다. 모서리 둥글기는 Toolbar/EditorContent 양쪽에
    // 나눠 줘서(rounded-t-md/rounded-b-md) 시각적으로는 예전과 동일하다.
    <div className="rounded-md border border-navy-100 bg-white shadow-sm">
      <Toolbar editor={editor} />
      <div className="overflow-hidden rounded-b-md">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export { EMPTY_DOCUMENT_CONTENT };
