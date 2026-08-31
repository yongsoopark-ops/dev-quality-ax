"use client";

import { useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createMeetingTemplateAction,
  deleteMeetingTemplateAction,
  setActiveMeetingTemplateAction,
  updateMeetingTemplateAction,
  type MeetingTemplateInfo,
} from "@/lib/meetingTemplates/actions";
import {
  BLOCK_SOURCE_LABELS,
  BLOCK_SOURCE_OPTIONS,
  BLOCK_TYPE_LABELS,
  BLOCK_TYPE_OPTIONS,
  MEETING_TEMPLATE_TYPE_LABELS,
  MEETING_TEMPLATE_TYPE_OPTIONS,
} from "@/lib/meetingTemplates/constants";
import { createDefaultBlock } from "@/lib/meetingTemplates/defaults";
import type { MeetingTemplateBlock, MeetingTemplateBlockSource } from "@/lib/meetingTemplates/types";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import { BlockConfigEditor } from "./BlockConfigEditor";

const inputClass = "w-full rounded-md border border-navy-100 px-2.5 py-1.5 text-sm";
const labelClass = "text-xs font-medium text-navy-950/60";

function BlockRow({
  block,
  onUpdate,
  onRemove,
}: {
  block: MeetingTemplateBlock;
  onUpdate: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="space-y-2 rounded-md border border-navy-100 bg-white p-3"
    >
      <div className="flex items-center gap-2">
        <span
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab px-1 text-navy-950/30 hover:text-navy-950/60 active:cursor-grabbing"
          aria-label="드래그하여 순서 변경"
        >
          ⠿
        </span>
        <span className="shrink-0 rounded bg-navy-50 px-2 py-0.5 text-[11px] font-medium text-navy-950/50" title="블록 타입(변경 불가)">
          {BLOCK_TYPE_LABELS[block.type]}
        </span>
        <input
          className="min-w-0 flex-1 rounded-md border border-navy-100 px-2.5 py-1 text-sm font-medium"
          value={block.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="블록 제목(관리용)"
        />
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-xs text-navy-950/40 hover:text-navy-950">
          {expanded ? "접기" : "펼치기"}
        </button>
        <button type="button" onClick={onRemove} className="shrink-0 text-xs text-red-600 hover:underline">
          삭제
        </button>
      </div>

      {expanded && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-navy-950/70">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={block.required} onChange={(e) => onUpdate({ required: e.target.checked })} />
              필수
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={block.aiEditable} onChange={(e) => onUpdate({ aiEditable: e.target.checked })} />
              AI 보완 허용
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={block.userEditable} onChange={(e) => onUpdate({ userEditable: e.target.checked })} />
              사용자 편집 허용
            </label>
            <label className="flex items-center gap-1">
              출처
              <select
                className="rounded border border-navy-100 px-1.5 py-0.5 text-xs"
                value={block.source}
                onChange={(e) => onUpdate({ source: e.target.value as MeetingTemplateBlockSource })}
              >
                {BLOCK_SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {BLOCK_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <BlockConfigEditor block={block} onChange={(config) => onUpdate({ config })} />
        </>
      )}
    </div>
  );
}

/**
 * Step 5B-3 — Template 1건 생성/편집. template이 null이면 "새 양식 생성"
 * 모드(첫 저장 전까지 실제 Row가 없다), 값이 있으면 기존 Row 편집이다.
 * "저장 성공 후 현재 편집 상태 유지"(요청사항) — 저장해도 화면을 닫지 않고
 * 그대로 계속 편집할 수 있게 한다. 새로 만든 Template이 첫 저장에 성공하면
 * 그 결과(id 포함)로 currentTemplate을 갱신해, 다음 저장부터는 create가
 * 아니라 update를 호출한다.
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
    // block.id로 찾은 대상에만 patch를 병합한다 — patch는 항상 BlockConfigEditor/
    // 이 파일의 체크박스·select들이 그 block과 같은 type에 맞춰 만든 값이라
    // (BlockConfigEditor가 block.type으로 분기해서 호출) 실제로는 항상 유효한
    // MeetingTemplateBlock 모양이 된다 — discriminated union이라 TS가 일반화된
    // patch 타입을 정적으로 좁히지 못해 여기 한 곳에서만 단언한다.
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as MeetingTemplateBlock) : b)));
  }

  function removeBlock(id: string) {
    setJustSaved(false);
    setBlocks((prev) => prev.filter((b) => b.id !== id).map((b, i) => ({ ...b, order: i })));
  }

  function addBlock(type: MeetingTemplateBlock["type"]) {
    setJustSaved(false);
    setBlocks((prev) => [...prev, createDefaultBlock(type, prev.length)]);
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
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onClose} className="text-xs text-navy-950/50 hover:text-navy-950">
          ← 목록으로
        </button>
        {currentTemplate?.isActive && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            사용 중인 Template
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border border-navy-100 bg-navy-50/60 p-3">
        <div className="space-y-1">
          <label className={labelClass}>Template 이름</label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setJustSaved(false);
            }}
            placeholder="예: 파트 주간회의 기본 양식"
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>회의 유형</label>
          <select
            className={inputClass}
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
      </div>

      <div className="space-y-2">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {blocks.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                onUpdate={(patch) => updateBlock(block.id, patch)}
                onRemove={() => removeBlock(block.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {blocks.length === 0 && (
          <p className="rounded-md border border-dashed border-navy-200 p-4 text-center text-xs text-navy-950/40">
            아직 블록이 없습니다. 아래에서 블록을 추가하세요.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5 rounded-md border border-navy-100 p-2.5">
          <span className="mr-1 self-center text-xs text-navy-950/50">블록 추가:</span>
          {BLOCK_TYPE_OPTIONS.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addBlock(type)}
              className="rounded-md border border-navy-100 px-2.5 py-1 text-xs text-navy-950/70 hover:bg-navy-50"
            >
              + {BLOCK_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {justSaved && !error && <p className="text-xs text-emerald-700">저장되었습니다.</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-100 pt-3">
        <div>
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
        </div>
        <div className="flex items-center gap-2">
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
    </div>
  );
}
