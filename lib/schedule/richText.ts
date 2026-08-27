import { generateHTML } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";

/**
 * Comment 입력(RichTextEditor)과 읽기 전용 렌더링(renderCommentHtml)이 반드시
 * 같은 Extension 세트를 써야 한다 — 다르면 같은 contentJson이 편집기에서 보이는
 * 모양과 목록에 렌더링되는 모양이 어긋난다. StarterKit(Tiptap v3)에 Bold/Italic/
 * Underline/BulletList/OrderedList/Link가 이미 포함돼 있어 이번 Step 최소 기능
 * 요구사항을 별도 Extension 설치 없이 그대로 충족한다.
 *
 * Mention 노드는 여기서는 suggestion(자동완성 UI) 없이 순수 Node 스키마로만
 * 등록한다 — contentJson을 파싱해 읽기 전용 HTML로 렌더링하거나(renderCommentHtml)
 * 아직 값이 없는 새 Editor를 초기화할 때 쓰는 공용 세트라서다. 실제 입력 중
 * "@" 자동완성은 RichTextEditor.tsx가 이 Mention을 별도로 다시
 * `.configure({ suggestion })`해서 쓴다(요청사항: contentJson 구조는 항상
 * { id, label } attrs를 갖는 mention 노드 — 문자열 이름만 저장하지 않는다).
 */
export const COMMENT_EDITOR_EXTENSIONS = [StarterKit, Mention.configure({ HTMLAttributes: { class: "mention" } })];

/** 저장된 Tiptap JSON(contentJson)을 목록에 표시할 HTML로 변환한다 — 댓글마다
 * Editor 인스턴스를 띄우지 않고 이 순수 함수 하나로 가볍게 렌더링한다. */
export function renderCommentHtml(contentJson: string): string {
  if (!contentJson) return "";
  try {
    const json = JSON.parse(contentJson);
    return generateHTML(json, COMMENT_EDITOR_EXTENSIONS);
  } catch {
    return "";
  }
}

export const EMPTY_DOC_JSON = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
