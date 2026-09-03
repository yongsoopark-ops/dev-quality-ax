"use client";

import { useState } from "react";
import type { JSONContent } from "@tiptap/react";
import {
  createMeetingTemplateAction,
  deleteMeetingTemplateAction,
  setActiveMeetingTemplateAction,
  updateMeetingTemplateAction,
  type MeetingTemplateInfo,
} from "@/lib/meetingTemplates/actions";
import { MEETING_TEMPLATE_TYPE_LABELS, MEETING_TEMPLATE_TYPE_OPTIONS } from "@/lib/meetingTemplates/constants";
import { convertBlocksToDocument, EMPTY_DOCUMENT_CONTENT } from "@/lib/meetingTemplates/richText";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import { TemplateRichTextEditor } from "./TemplateRichTextEditor";

/** 이 Template이 처음 열릴 때 보여줄 문서를 고른다:
 * 1) 5B-3.3(Rich Text Editor)으로 이미 한 번이라도 저장된 적이 있으면
 *    documentContent를 그대로 쓴다.
 * 2) 없지만 5B-3.2까지의 block(templateSchema)이 있으면 1회성으로 문서로
 *    변환한다 — "저장"을 눌러야만 실제 documentContent로 반영된다
 *    (요청사항: 기존 Template 데이터가 깨지지 않도록).
 * 3) 완전히 새 Template이면 빈 문서에서 시작한다. */
function initialDocumentContent(template: MeetingTemplateInfo | null): JSONContent {
  if (!template) return EMPTY_DOCUMENT_CONTENT;
  if (template.documentContent) return template.documentContent;
  if (template.templateSchema.length > 0) return convertBlocksToDocument(template.templateSchema);
  return EMPTY_DOCUMENT_CONTENT;
}

/**
 * Step 5B-3.3(Rich Text Editor 전환) — 문서 Canvas는 이제 block 목록이 아니라
 * TemplateRichTextEditor 하나다. 이름/회의 유형/저장·삭제·활성 전환 같은
 * Template 자체의 메타데이터/동작은 Step 5B-3과 동일하게 유지한다 — 바뀐 건
 * "문서 본문을 어떻게 편집하는지"뿐이다.
 */
export function TemplateEditor({
  template,
  onSaved,
  onActivated,
  onDeleted,
  onClose,
}: {
  template: MeetingTemplateInfo | null;
  onSaved: (saved: MeetingTemplateInfo) => void;
  onActivated: (saved: MeetingTemplateInfo) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [currentTemplate, setCurrentTemplate] = useState<MeetingTemplateInfo | null>(template);
  const [name, setName] = useState(template?.name ?? "");
  const [meetingType, setMeetingType] = useState<MeetingTemplateType>(template?.meetingType ?? MEETING_TEMPLATE_TYPE_OPTIONS[0]);
  const [documentContent, setDocumentContent] = useState<JSONContent>(() => initialDocumentContent(template));
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      // Step(회의록 줄간격 개선) — 실제로 재현/확인한 문제: 이 문서 트리는
      // 같은 attrs 모양(예: {textAlign:null, lineHeight:null, level:1})을
      // 가진 heading/paragraph가 수십 개씩 반복된다. Next.js Server Action
      // 인자를 객체 그대로 넘기면, 그 반복되는 attrs 객체들 사이 어딘가에서
      // "정규 프로젝트"처럼 실제로 값이 다른 노드의 attrs(lineHeight:"1.6"
      // 등)가 서버에 도착했을 때 사라지는 현상을 서버 로그로 직접 확인했다
      // (클라이언트 documentContent 상태와 onUpdate 시점 JSON에는 분명히
      // 있었는데, 서버 액션의 raw input에는 없었다). 문자열로 직렬화해서
      // 넘기면 이 문제가 재현되지 않아(검증 완료) 안전하게 우회한다 —
      // Server Action이 복잡한 중첩 JSON 인자를 다룰 때 흔히 쓰는 방식이다.
      const documentContentPayload = JSON.stringify(documentContent);
      const res = currentTemplate
        ? await updateMeetingTemplateAction(currentTemplate.id, { name, meetingType, documentContent: documentContentPayload })
        : await createMeetingTemplateAction({ name, meetingType, documentContent: documentContentPayload });

      if (res.error || !res.template) {
        setError(res.error ?? "저장하지 못했습니다.");
        return;
      }
      setCurrentTemplate(res.template);
      setJustSaved(true);
      onSaved(res.template);
    } catch {
      setError("저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (!currentTemplate) return;
    setActivating(true);
    setError(null);
    try {
      const res = await setActiveMeetingTemplateAction(currentTemplate.id);
      if (res.error || !res.template) {
        setError(res.error ?? "활성 Template으로 전환하지 못했습니다.");
        return;
      }
      setCurrentTemplate(res.template);
      onActivated(res.template);
    } catch {
      setError("활성 Template 전환에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setActivating(false);
    }
  }

  async function handleDelete() {
    if (!currentTemplate) return;
    const confirmMessage = currentTemplate.isActive
      ? `"${currentTemplate.name}"은(는) 현재 사용 중인 Template입니다. 삭제하면 이 회의 유형에는 활성 Template이 없는 상태가 됩니다. 계속하시겠습니까?`
      : `"${currentTemplate.name}"을(를) 삭제하시겠습니까?`;
    if (!window.confirm(confirmMessage)) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await deleteMeetingTemplateAction(currentTemplate.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      onDeleted(currentTemplate.id);
    } catch {
      setError("삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    // Step 5B-3.4(Editor 사용성 보완) — 문서가 화면의 중심으로 느껴지도록
    // 상단 액션바/이름·회의유형 영역/문서 Canvas를 전부 같은 폭(880px)의
    // 한 컬럼 안에 정렬한다(요청사항: "실제 문서가 화면의 중심으로 느껴져야
    // 한다"). 모바일에서는 max-w가 뷰포트 폭에 자연히 눌려 기존 반응형이
    // 그대로 유지된다.
    <div className="mx-auto max-w-[880px] space-y-3 pb-8">
      {/* 문서 바깥 툴바 — Template 자체의 메타데이터/동작이라 "문서 안"에는
          두지 않는다(요청사항: 문서 캔버스에는 실제 문서 내용만). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onClose} className="text-xs text-navy-950/50 hover:text-navy-950">
          ← 목록으로
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {currentTemplate?.isActive && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              사용 중인 Template
            </span>
          )}
          {currentTemplate && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? "삭제 중..." : "삭제"}
            </button>
          )}
          {currentTemplate && !currentTemplate.isActive && (
            <button
              type="button"
              onClick={handleActivate}
              disabled={activating}
              className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium text-navy-950/70 hover:bg-navy-50 disabled:opacity-50"
            >
              {activating ? "전환 중..." : "이 양식 사용"}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-md bg-navy-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 이름/회의 유형 — 예전엔 카드처럼 박스(배경+테두리)로 강조돼 있어
          "설정 화면"처럼 보였다(요청사항으로 지적됨). 이제는 옅은 텍스트의
          가벼운 한 줄로만 두고, 실제 문서 Canvas가 화면에서 더 강조되게 한다. */}
      <div className="flex flex-wrap items-center gap-3 px-0.5">
        <input
          className="min-w-[160px] flex-1 border-b border-transparent bg-transparent py-1 text-sm text-navy-950/70 outline-none focus:border-navy-200"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setJustSaved(false);
          }}
          placeholder="Template 이름(예: 파트 주간회의 기본 양식)"
        />
        <select
          className="rounded border border-navy-100/70 bg-transparent px-2 py-1 text-xs text-navy-950/50"
          value={meetingType}
          onChange={(e) => {
            setMeetingType(e.target.value as MeetingTemplateType);
            setJustSaved(false);
          }}
        >
          {MEETING_TEMPLATE_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {MEETING_TEMPLATE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {justSaved && !error && <p className="text-xs text-emerald-700">저장되었습니다.</p>}

      {/* 문서 Canvas — Monday Docs/Word처럼 하나의 문서를 직접 쓴다. */}
      <TemplateRichTextEditor
        value={documentContent}
        onChange={(next) => {
          setDocumentContent(next);
          setJustSaved(false);
        }}
      />
    </div>
  );
}
