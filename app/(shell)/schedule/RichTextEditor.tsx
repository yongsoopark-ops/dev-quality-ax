"use client";

import { useMemo } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import { EMPTY_DOC_JSON } from "@/lib/schedule/richText";
import type { ScheduleUser } from "@/lib/schedule/types";
import { buildMentionSuggestion } from "./mentionSuggestion";

/**
 * Comment/답변 작성용 최소 Rich Text 입력기. 직접 contentEditable을 만들지 않고
 * Tiptap(React 19 공식 지원 버전, 설치 전 peerDependencies로 확인)을 그대로 쓴다.
 * StarterKit만으로 Bold/Italic/Underline/Bullet·Ordered List/Link를 전부 충족한다.
 *
 * #해시태그 같은 표현은 별도 Extension 없이 일반 텍스트로 그대로 입력/저장된다 —
 * 이번 Step에서는 Tag Master 구조화를 만들지 않는다(요청사항).
 */
function ToolbarButton({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`rounded px-2 py-1 text-xs font-medium ${
        active ? "bg-navy-900 text-white" : "text-navy-950/70 hover:bg-navy-50"
      }`}
    >
      {label}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  function setLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("링크 URL을 입력하세요", previousUrl ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-navy-100 px-1 py-1">
      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="B"
        title="굵게"
      />
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="I"
        title="기울임"
      />
      <ToolbarButton
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        label="U"
        title="밑줄"
      />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="•"
        title="글머리 목록"
      />
      <ToolbarButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="1."
        title="번호 목록"
      />
      <ToolbarButton active={editor.isActive("link")} onClick={setLink} label="🔗" title="링크" />
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  mentionUsers,
}: {
  value: string;
  onChange: (contentJson: string, plainText: string) => void;
  placeholder?: string;
  /** "@" 자동완성에 노출할 ACTIVE User 목록. 넘기지 않으면 Mention 노드 스키마는
   * 그대로 유지한 채 자동완성만 비활성화된다(예: 향후 다른 입력 맥락 재사용 대비). */
  mentionUsers?: ScheduleUser[];
}) {
  // Mention은 매 렌더마다 새 Extension 인스턴스를 만들면 useEditor가 매번
  // Editor를 재생성해 입력 중이던 내용이 날아간다 — mentionUsers가 실제로
  // 바뀔 때만(같은 Modal이 열려 있는 동안 users prop은 사실상 불변) 다시 만든다.
  const extensions = useMemo(
    () => [
      StarterKit,
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: buildMentionSuggestion(mentionUsers ?? []),
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mentionUsers],
  );

  const editor = useEditor({
    extensions,
    content: (() => {
      try {
        return JSON.parse(value || EMPTY_DOC_JSON);
      } catch {
        return JSON.parse(EMPTY_DOC_JSON);
      }
    })(),
    // Next.js에서 SSR/CSR 렌더링 결과가 어긋나는 것을 막기 위해 Tiptap이 공식
    // 권장하는 옵션 — 클라이언트 마운트 이후에만 실제로 렌더링한다.
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(JSON.stringify(editor.getJSON()), editor.getText());
    },
    editorProps: {
      attributes: {
        class: "tiptap-content min-h-[72px] px-3 py-2 text-sm focus:outline-none",
      },
    },
  });

  return (
    <div className="overflow-hidden rounded-md border border-navy-100 bg-white">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
