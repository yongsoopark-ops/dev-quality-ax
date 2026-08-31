"use client";

import { useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  createMeetingTemplateAction,
  deleteMeetingTemplateAction,
  setActiveMeetingTemplateAction,
  updateMeetingTemplateAction,
  type MeetingTemplateInfo,
} from "@/lib/meetingTemplates/actions";
import { MEETING_TEMPLATE_TYPE_LABELS, MEETING_TEMPLATE_TYPE_OPTIONS } from "@/lib/meetingTemplates/constants";
import { FREE_BLOCK_MENU_ITEMS } from "@/lib/meetingTemplates/defaults";
import type { MeetingTemplateBlock } from "@/lib/meetingTemplates/types";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import { DocumentSection } from "./DocumentSection";

/**
 * Step 5B-3.2(자유 문서 Editor) — "+ 섹션 추가" 메뉴가 이제 일반 문서 요소
 * 5개(제목/본문/글머리표 목록/번호 목록/표)만 보여준다(요청사항: 회의록
 * 내부 block type을 사용자가 선택하지 않게 한다). meeting-info/agenda-list/
 * project-list/action-item-list/review-list는 더 이상 이 메뉴에 없다.
 */
function AddSectionMenu({ onAdd }: { onAdd: (create: (order: number) => MeetingTemplateBlock) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-md border border-dashed border-navy-200 py-2 text-sm text-navy-950/40 hover:border-navy-300 hover:bg-navy-50/60 hover:text-navy-950/70"
      >
        + 추가
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 grid w-48 grid-cols-1 gap-0.5 rounded-md border border-navy-100 bg-white p-1.5 shadow-lg">
          {FREE_BLOCK_MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                onAdd(item.create);
                setOpen(false);
              }}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-navy-950/80 hover:bg-navy-50"
            >
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Step 5B-3.1(문서형 Editor 재설계) — 데이터 구조(MeetingTemplateBlock 등)와
 * 저장/활성 전환 로직은 Step 5B-3과 동일하게 유지한다. 바뀐 것은 오직
 * "어떻게 보여주고 편집하는지"뿐이다 — 예전엔 각 block이 "타입 라벨 +
 * 체크박스 여러 개 + 설정 폼"으로 늘어선 개발자용 폼이었다면, 이제는 하나의
 * 문서(Canvas)를 Word/Notion처럼 직접 편집하는 것처럼 보인다. block.type/
 * source/aiEditable/userEditable/config는 그대로 저장되고, 그대로
 * validateMeetingTemplateSchema를 통과해야 저장된다 — 화면만 바뀌었다.
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
  const [blocks, setBlocks] = useState<MeetingTemplateBlock[]>(template?.templateSchema ?? []);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function updateBlock(id: string, patch: Record<string, unknown>) {
    setJustSaved(false);
    // discriminated union이라 TS가 일반화된 patch 타입을 정적으로 좁히지
    // 못해 여기 한 곳에서만 단언한다 — patch는 항상 SectionBody/
    // SectionSettingsPopover가 그 block과 같은 type에 맞춰 만든 값이다.
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as MeetingTemplateBlock) : b)));
  }

  function removeBlock(id: string) {
    setJustSaved(false);
    setBlocks((prev) => prev.filter((b) => b.id !== id).map((b, i) => ({ ...b, order: i })));
  }

  function addBlock(create: (order: number) => MeetingTemplateBlock) {
    setJustSaved(false);
    setBlocks((prev) => [...prev, create(prev.length)]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setJustSaved(false);
    setBlocks((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id);
      const newIndex = prev.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex).map((b, i) => ({ ...b, order: i }));
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      // 저장 직전 order를 배열 위치와 항상 일치시킨다(Drag & Drop이 매번
      // 갱신하지만, 블록 추가/삭제 직후에도 어긋나지 않도록 방어적으로 재계산).
      const orderedBlocks = blocks.map((b, i) => ({ ...b, order: i }));
      const res = currentTemplate
        ? await updateMeetingTemplateAction(currentTemplate.id, { name, meetingType, templateSchema: orderedBlocks })
        : await createMeetingTemplateAction({ name, meetingType, templateSchema: orderedBlocks });

      if (res.error || !res.template) {
        setError(res.error ?? "저장하지 못했습니다.");
        return;
      }
      setCurrentTemplate(res.template);
      setBlocks(res.template.templateSchema);
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
    <div className="space-y-3 pb-8">
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

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-navy-100 bg-navy-50/60 px-3 py-2">
        <input
          className="min-w-[160px] flex-1 rounded-md border border-navy-100 bg-white px-2.5 py-1.5 text-sm"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setJustSaved(false);
          }}
          placeholder="Template 이름(예: 파트 주간회의 기본 양식)"
        />
        <select
          className="rounded-md border border-navy-100 bg-white px-2.5 py-1.5 text-sm"
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

      {/* 문서 Canvas — Word/Notion처럼 종이 위에 섹션들이 쌓인 것처럼 보인다.
          내부적으로는 각 섹션이 여전히 하나의 MeetingTemplateBlock이다. */}
      <div className="mx-auto max-w-[720px] rounded-lg border border-navy-100 bg-white p-8 shadow-sm">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {blocks.map((block) => (
                <DocumentSection key={block.id} block={block} onUpdate={(patch) => updateBlock(block.id, patch)} onRemove={() => removeBlock(block.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {blocks.length === 0 && (
          <p className="mb-3 rounded-md border border-dashed border-navy-200 p-4 text-center text-xs text-navy-950/40">
            빈 문서입니다. 아래 &quot;+ 추가&quot;로 제목/본문/목록/표를 자유롭게 써 내려가세요.
          </p>
        )}

        <div className="mt-3">
          <AddSectionMenu onAdd={addBlock} />
        </div>
      </div>
    </div>
  );
}
