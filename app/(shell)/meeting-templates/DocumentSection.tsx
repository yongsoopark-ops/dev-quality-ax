"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MeetingTemplateBlock } from "@/lib/meetingTemplates/types";
import { SectionBody } from "./SectionBody";

/**
 * Step 5B-3.2(자유 문서 Editor) — 한 block을 "문서의 한 줄/섹션"처럼 보이게
 * 감싼다. 드래그 손잡이(⠿)와 삭제(✕)만 남기고, required/AI 보완/사용자
 * 편집/출처 같은 설정 UI는 완전히 제거했다(요청사항: "사용자가 알아야 하는
 * 것은 텍스트 입력/Enter/제목 스타일/글머리표/번호 목록/표/삭제/Drag & Drop
 * 정도뿐이다"). 두 컨트롤 모두 평소엔 숨어 있다가 마우스를 올렸을 때만
 * 나타난다.
 */
export function DocumentSection({
  block,
  onUpdate,
  onRemove,
}: {
  block: MeetingTemplateBlock;
  onUpdate: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group/section relative -mx-2 rounded-md px-2 py-1.5 hover:bg-navy-50/30"
    >
      <span
        {...attributes}
        {...listeners}
        className="absolute -left-5 top-1.5 cursor-grab px-1 text-navy-950/0 group-hover/section:text-navy-950/25 hover:!text-navy-950/60 active:cursor-grabbing"
        aria-label="드래그하여 순서 변경"
      >
        ⠿
      </span>

      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded px-1.5 py-0.5 text-xs text-navy-950/0 opacity-0 group-hover/section:text-navy-950/40 group-hover/section:opacity-100 hover:!bg-red-50 hover:!text-red-600"
        aria-label="섹션 삭제"
      >
        ✕
      </button>

      <div className="pr-8">
        <SectionBody block={block} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
