"use client";

import { useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createProjectCategoryAction,
  createProjectCategoryGroupAction,
  createTaskCategoryOptionAction,
  createTaskStatusOptionAction,
  deleteProjectCategoryGroupAction,
  deleteTaskCategoryOptionAction,
  deleteTaskStatusOptionAction,
  moveProjectCategoryToGroupAction,
  removeProjectCategoryAction,
  reorderProjectCategoriesAction,
  reorderProjectCategoryGroupsAction,
  reorderTaskCategoryOptionsAction,
  reorderTaskStatusOptionsAction,
  setProjectCategoryGroupActiveAction,
  setTaskCategoryOptionActiveAction,
  setTaskStatusOptionActiveAction,
  toggleProjectCategoryActiveAction,
  updateProjectCategoryAction,
  updateProjectCategoryGroupAction,
  updateTaskCategoryOptionAction,
  updateTaskStatusOptionAction,
} from "./actions";
import { DEFAULT_PROJECT_CATEGORY_GROUP_ID, TASK_CATEGORY_KEY, TASK_STATUS_KEY } from "@/lib/schedule/constants";
import type { ProjectCategoryGroupOption, ProjectCategoryOption, ScheduleOptionInfo } from "@/lib/schedule/types";

/**
 * Step 5B-4/5B-5(일정 설정) — Monday.com Status 설정처럼 "색상 · 이름 · Drag
 * Handle · ⋯" 한 줄짜리 리스트로 상태/업무구분/프로젝트 카테고리(대분류→
 * 중분류 2단계) 3개 영역을 관리한다. 별도 관리자 페이지를 새로 만들지 않고
 * Schedule 화면 위에 뜨는 가벼운 Modal 하나로 처리한다(요청사항). 이
 * 컴포넌트를 여는 쪽(ScheduleClient)이 이미 ADMIN인지 확인하지만, 실제
 * 저장은 항상 actions.ts의 각 Action이 서버에서 다시 ADMIN 여부를 확인한다.
 */

/** Step 5B-8(상태/업무구분 삭제) — 실제 코드가 semantic key로 의존하는 예약
 * 항목의 id 목록. actions.ts의 TASK_CATEGORY_RESERVED_IDS/TASK_STATUS_RESERVED_IDS
 * 와 반드시 같은 값이어야 하므로, 여기서도 동일하게 TASK_CATEGORY_KEY/
 * TASK_STATUS_KEY 객체의 값을 그대로 가져온다(새 목록을 만들지 않는다). */
const RESERVED_CATEGORY_IDS: readonly string[] = Object.values(TASK_CATEGORY_KEY);
const RESERVED_STATUS_IDS: readonly string[] = Object.values(TASK_STATUS_KEY);

const COLOR_PRESETS = [
  "#5b8def",
  "#5cb87a",
  "#e0a458",
  "#9b87d9",
  "#94a3b8",
  "#5aa9b6",
  "#d1b354",
  "#dc2626",
  "#0891b2",
  "#7c3aed",
];

/** 텍스트 편집 영역(이름 수정 input)에서 드래그를 시작해 Backdrop까지
 * 나가도 Modal이 "바깥 클릭"으로 오인해 닫히지 않게 한다 — TaskDetailPanel.tsx
 * isTextEditableTarget과 동일한 이유/패턴(이 파일에도 이름 수정 input이
 * 있어 같은 문제가 생길 수 있어 처음부터 방지한다). */
function isTextEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

interface NormalizedItem {
  id: string;
  label: string;
  color: string;
  active: boolean;
}

function ColorSwatchPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="h-5 w-5 rounded-full border border-navy-100"
        style={{ backgroundColor: color }}
        aria-label="색상 선택"
        title="색상 선택"
      />
      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 flex w-40 flex-wrap gap-1.5 rounded-md border border-navy-100 bg-white p-2 shadow-lg"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="h-5 w-5 rounded-full border border-navy-100"
              style={{ backgroundColor: c, boxShadow: c === color ? "0 0 0 2px #101d38" : undefined }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            title="사용자 지정 색상"
            className="h-5 w-9 cursor-pointer rounded border border-navy-100 bg-white p-0"
          />
        </div>
      )}
    </div>
  );
}

function SortableRow({
  item,
  onRename,
  onColor,
  onToggleActive,
  onDelete,
}: {
  item: NormalizedItem;
  onRename: (label: string) => void;
  onColor: (color: string) => void;
  onToggleActive: (active: boolean) => void;
  /** 시스템 예약 항목(프로젝트/미팅/TODO/DONE 등)은 삭제 자체를 지원하지
   * 않는다(요청사항: 삭제로 기존 기능이 깨지는 구조 금지) — 그 경우 이
   * prop을 아예 넘기지 않아 메뉴에 "삭제"가 나타나지 않는다. */
  onDelete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);
  const [menuOpen, setMenuOpen] = useState(false);

  function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.label) onRename(trimmed);
    else setDraft(item.label);
  }

  function handleDeleteClick() {
    setMenuOpen(false);
    if (!onDelete) return;
    if (window.confirm(`"${item.label}" 항목을 삭제하시겠습니까?`)) onDelete();
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-navy-50/60"
    >
      <span
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab px-0.5 text-navy-950/30 hover:text-navy-950/60 active:cursor-grabbing"
        aria-label="드래그하여 순서 변경"
      >
        ⠿
      </span>
      <ColorSwatchPicker color={item.color} onChange={onColor} />
      {editing ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded border border-navy-200 px-1.5 py-0.5 text-sm outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(item.label);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${item.active ? "text-navy-950" : "text-navy-950/40"}`}
        >
          {item.label}
          {!item.active && <span className="ml-1 text-xs text-navy-950/40">(비활성)</span>}
        </button>
      )}
      <div className="relative shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 text-navy-950/40 hover:bg-navy-100"
          aria-label="더 보기"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full z-30 mt-1 w-32 rounded-md border border-navy-100 bg-white p-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onToggleActive(!item.active);
                setMenuOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-navy-950/80 hover:bg-navy-50"
            >
              {item.active ? "비활성화" : "활성화"}
            </button>
            {/* Step 5B-8 — 시스템 예약 항목은 이 prop 자체를 안 받으므로(위 주석)
                "삭제" 메뉴가 아예 나타나지 않는다. 사용 중이라 서버가 거부하면
                OptionListSection 상단의 공용 에러 배너에 안내 문구가 뜬다. */}
            {onDelete && (
              <button type="button" onClick={handleDeleteClick} className="block w-full rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50">
                삭제
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 상태/업무구분 2개 영역이 이 하나의 리스트 UI를 공유한다(플랫 1단계) —
 * 프로젝트 카테고리는 2단계 계층이라 아래 별도 컴포넌트(ProjectCategory
 * HierarchySection)를 쓴다. add/rename/color/toggleActive/reorder는 항상
 * 서버에 반영한 뒤 성공한 값으로만 부모 state를 갱신한다(실패 시 화면과
 * 서버가 어긋나지 않도록).
 */
function OptionListSection({
  title,
  description,
  items,
  addPlaceholder,
  reservedIds,
  onAdd,
  onRename,
  onColor,
  onToggleActive,
  onReorder,
  onDelete,
}: {
  title: string;
  description: string;
  items: NormalizedItem[];
  addPlaceholder: string;
  /** Step 5B-8 — 시스템 예약 항목(semantic key)의 id 목록. 이 목록에 있는
   * 항목은 SortableRow에 onDelete를 아예 넘기지 않아 "삭제" 메뉴 자체가
   * 나타나지 않는다 — 실제 코드가 의존하는 값(TASK_CATEGORY_KEY/TASK_STATUS_KEY)
   * 을 호출부에서 그대로 넘겨받는다(여기서 새 목록을 만들지 않는다). */
  reservedIds: readonly string[];
  onAdd: (label: string) => Promise<{ error?: string }>;
  onRename: (id: string, label: string) => Promise<{ error?: string }>;
  onColor: (id: string, color: string) => Promise<{ error?: string }>;
  onToggleActive: (id: string, active: boolean) => Promise<{ error?: string }>;
  onReorder: (orderedIds: string[]) => Promise<{ error?: string }>;
  onDelete: (id: string) => Promise<{ error?: string }>;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleAdd() {
    if (!newLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onAdd(newLabel.trim());
      if (res.error) {
        setError(res.error);
        return;
      }
      setNewLabel("");
    } catch {
      // requireUser()가 세션 만료 등으로 FORBIDDEN을 throw하는 경우(정상
      // 반환이 아니라 예외) — 이 Modal은 렌더 자체가 ADMIN 조건부라 평소엔
      // 발생하지 않지만, 세션이 그 사이 만료됐을 수 있어 방어적으로 잡는다.
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    try {
      const res = await action();
      if (res.error) setError(res.error);
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    void run(() => onReorder(arrayMove(items, oldIndex, newIndex).map((i) => i.id)));
  }

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-navy-950">{title}</h3>
        <p className="text-xs text-navy-950/50">{description}</p>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5 rounded-md border border-navy-100 p-1">
            {items.map((item) => (
              <SortableRow
                key={item.id}
                item={item}
                onRename={(label) => void run(() => onRename(item.id, label))}
                onColor={(color) => void run(() => onColor(item.id, color))}
                onToggleActive={(active) => void run(() => onToggleActive(item.id, active))}
                onDelete={reservedIds.includes(item.id) ? undefined : () => void run(() => onDelete(item.id))}
              />
            ))}
            {items.length === 0 && <p className="p-2 text-xs text-navy-950/40">등록된 항목이 없습니다.</p>}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-navy-100 px-2.5 py-1.5 text-sm"
          placeholder={addPlaceholder}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !newLabel.trim()}
          className="shrink-0 rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          + 새 항목
        </button>
      </div>
    </div>
  );
}

/** 대분류 1건 — 색상은 없다(요청사항: 색상은 중분류에만). 삭제는 지원하지
 * 않는다(비활성화만 — 대분류 삭제는 그 안의 중분류가 참조할 곳을 잃는다). */
function GroupHeaderRow({
  group,
  hasChildren,
  onRename,
  onToggleActive,
  onDelete,
}: {
  group: ProjectCategoryGroupOption;
  /** 하위 중분류가 1개 이상이면 true — 삭제를 막고 안내 문구를 보여줄지 판단한다.
   * 서버가 최종 판단하지만(Client 조건만 믿지 않음), 여기서 먼저 막아 불필요한
   * 요청/확인 popup을 줄인다. */
  hasChildren: boolean;
  onRename: (name: string) => void;
  onToggleActive: (active: boolean) => void;
  /** 삭제 확정(확인 popup을 이미 통과한 상태) 후 호출된다. */
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const isDefault = group.id === DEFAULT_PROJECT_CATEGORY_GROUP_ID;

  function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== group.name) onRename(trimmed);
    else setDraft(group.name);
  }

  function handleDeleteClick() {
    setMenuOpen(false);
    if (hasChildren) {
      setBlockedMsg("하위 카테고리를 다른 대분류로 이동하거나 삭제한 후 다시 시도해 주세요.");
      return;
    }
    if (window.confirm(`"${group.name}" 대분류를 삭제하시겠습니까?`)) onDelete();
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex flex-wrap items-center gap-2 rounded-md bg-navy-50/60 px-1.5 py-1.5"
    >
      <span
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab px-0.5 text-navy-950/30 hover:text-navy-950/60 active:cursor-grabbing"
        aria-label="드래그하여 순서 변경"
      >
        ⠿
      </span>
      {editing ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded border border-navy-200 px-1.5 py-0.5 text-sm font-semibold outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(group.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline ${group.active ? "text-navy-950" : "text-navy-950/40"}`}
        >
          {group.name}
          {!group.active && <span className="ml-1 text-xs font-normal text-navy-950/40">(비활성)</span>}
        </button>
      )}
      <div className="relative shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setBlockedMsg(null);
            setMenuOpen((v) => !v);
          }}
          className="rounded px-1.5 py-0.5 text-navy-950/40 hover:bg-navy-100"
          aria-label="더 보기"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-navy-100 bg-white p-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {isDefault ? (
              <p className="px-2 py-1 text-xs text-navy-950/40">시스템 기본 대분류입니다.</p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onToggleActive(!group.active);
                    setMenuOpen(false);
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-navy-950/80 hover:bg-navy-50"
                >
                  {group.active ? "비활성화" : "활성화"}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50"
                >
                  삭제
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {blockedMsg && <p className="w-full basis-full pl-6 text-xs text-red-600">{blockedMsg}</p>}
    </div>
  );
}

/** 중분류 1건 — 대분류 Row와 달리 색상 있음 + "다른 대분류로 이동" 메뉴가
 * 추가로 있다(요청사항). 삭제는 기존 ProjectCategory 정책(사용 중이면
 * 비활성화, 아니면 실제 삭제) 그대로 유지한다. */
function CategoryRow({
  item,
  groups,
  onRename,
  onColor,
  onToggleActive,
  onDelete,
  onMove,
}: {
  item: ProjectCategoryOption;
  groups: ProjectCategoryGroupOption[];
  onRename: (name: string) => void;
  onColor: (color: string) => void;
  onToggleActive: (active: boolean) => void;
  onDelete: () => void;
  onMove: (groupId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);

  function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.name) onRename(trimmed);
    else setDraft(item.name);
  }

  const otherGroups = groups.filter((g) => g.id !== item.groupId && g.active);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="ml-5 flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-navy-50/60"
    >
      <span
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab px-0.5 text-navy-950/30 hover:text-navy-950/60 active:cursor-grabbing"
        aria-label="드래그하여 순서 변경"
      >
        ⠿
      </span>
      <ColorSwatchPicker color={item.color} onChange={onColor} />
      {editing ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded border border-navy-200 px-1.5 py-0.5 text-sm outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(item.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${item.active ? "text-navy-950" : "text-navy-950/40"}`}
        >
          {item.name}
          {!item.active && <span className="ml-1 text-xs text-navy-950/40">(비활성)</span>}
        </button>
      )}
      <div className="relative shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 text-navy-950/40 hover:bg-navy-100"
          aria-label="더 보기"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-navy-100 bg-white p-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setMovePickerOpen((v) => !v)}
              className="block w-full rounded px-2 py-1 text-left text-xs text-navy-950/80 hover:bg-navy-50"
            >
              다른 대분류로 이동
            </button>
            {movePickerOpen && (
              <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto border-t border-navy-100 pt-1">
                {otherGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      onMove(g.id);
                      setMovePickerOpen(false);
                      setMenuOpen(false);
                    }}
                    className="block w-full rounded px-2 py-1 text-left text-xs text-navy-950/70 hover:bg-navy-50"
                  >
                    {g.name}
                  </button>
                ))}
                {otherGroups.length === 0 && <p className="px-2 py-1 text-xs text-navy-950/40">이동할 대분류가 없습니다.</p>}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                onToggleActive(!item.active);
                setMenuOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-navy-950/80 hover:bg-navy-50"
            >
              {item.active ? "비활성화" : "활성화"}
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete();
                setMenuOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50"
            >
              삭제
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 대분류 1개 + 그 안의 중분류 목록 — 중분류 Drag & Drop은 이 대분류 안에서만
 * 순서를 바꾼다(다른 대분류로 옮기는 건 "⋯ → 다른 대분류로 이동"이라는 명시적
 * 동작이지 Drag가 아니다 — 요청사항에도 별도 항목으로 나열돼 있다). */
function GroupBlock({
  group,
  categories,
  allGroups,
  onRenameGroup,
  onToggleGroupActive,
  onDeleteGroup,
  onReorderCategories,
  onRenameCategory,
  onColorCategory,
  onToggleCategoryActive,
  onMoveCategory,
  onDeleteCategory,
  onAddCategory,
}: {
  group: ProjectCategoryGroupOption;
  categories: ProjectCategoryOption[];
  allGroups: ProjectCategoryGroupOption[];
  onRenameGroup: (name: string) => void;
  onToggleGroupActive: (active: boolean) => void;
  onDeleteGroup: () => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onRenameCategory: (id: string, name: string) => void;
  onColorCategory: (id: string, color: string) => void;
  onToggleCategoryActive: (id: string, active: boolean) => void;
  onMoveCategory: (id: string, groupId: string) => void;
  onDeleteCategory: (id: string) => void;
  onAddCategory: (name: string) => Promise<{ error?: string }>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const sorted = [...categories].sort((a, b) => a.order - b.order);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((c) => c.id === active.id);
    const newIndex = sorted.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorderCategories(arrayMove(sorted, oldIndex, newIndex).map((c) => c.id));
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setBusy(true);
    setLocalError(null);
    try {
      const res = await onAddCategory(newName.trim());
      if (res.error) {
        setLocalError(res.error);
        return;
      }
      setNewName("");
      setAdding(false);
    } catch {
      setLocalError("추가하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <GroupHeaderRow group={group} hasChildren={categories.length > 0} onRename={onRenameGroup} onToggleActive={onToggleGroupActive} onDelete={onDeleteGroup} />
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={sorted.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {sorted.map((c) => (
              <CategoryRow
                key={c.id}
                item={c}
                groups={allGroups}
                onRename={(name) => onRenameCategory(c.id, name)}
                onColor={(color) => onColorCategory(c.id, color)}
                onToggleActive={(active) => onToggleCategoryActive(c.id, active)}
                onDelete={() => onDeleteCategory(c.id)}
                onMove={(groupId) => onMoveCategory(c.id, groupId)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="ml-5">
        {adding ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              className="min-w-0 flex-1 rounded border border-navy-100 px-2 py-1 text-xs outline-none focus:border-navy-300"
              placeholder="새 중분류명"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAdd();
                }
                if (e.key === "Escape") {
                  setAdding(false);
                  setNewName("");
                }
              }}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={busy || !newName.trim()}
              className="shrink-0 rounded bg-navy-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              추가
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewName("");
              }}
              className="shrink-0 rounded px-2 py-1 text-xs text-navy-950/50 hover:bg-navy-50"
            >
              취소
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="rounded px-1.5 py-0.5 text-xs text-navy-950/50 hover:bg-navy-50 hover:text-navy-950">
            + 중분류 추가
          </button>
        )}
        {localError && <p className="mt-1 text-xs text-red-600">{localError}</p>}
      </div>
    </div>
  );
}

/** Step 5B-5(2단계 계층화) — 대분류 목록 전체를 렌더링하고, 대분류/중분류
 * 양쪽의 서버 반영 + 낙관적 state 갱신을 여기서 오케스트레이션한다. */
function ProjectCategoryHierarchySection({
  groups,
  categories,
  onGroupsChange,
  onCategoriesChange,
}: {
  groups: ProjectCategoryGroupOption[];
  categories: ProjectCategoryOption[];
  onGroupsChange: (next: ProjectCategoryGroupOption[]) => void;
  onCategoriesChange: (next: ProjectCategoryOption[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const groupSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);

  async function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    try {
      const res = await action();
      if (res.error) setError(res.error);
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedGroups.findIndex((g) => g.id === active.id);
    const newIndex = sortedGroups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sortedGroups, oldIndex, newIndex).map((g, i) => ({ ...g, order: i }));
    onGroupsChange(reordered);
    void run(() => reorderProjectCategoryGroupsAction(reordered.map((g) => g.id)));
  }

  async function handleAddGroup() {
    if (!newGroupName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createProjectCategoryGroupAction(newGroupName.trim());
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.group) onGroupsChange([...groups, res.group]);
      setNewGroupName("");
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-navy-950">프로젝트 카테고리 관리</h3>
        <p className="text-xs text-navy-950/50">업무 구분이 &quot;프로젝트&quot;일 때 선택하는 대분류 → 중분류입니다.</p>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <DndContext sensors={groupSensors} onDragEnd={handleGroupDragEnd}>
        <SortableContext items={sortedGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 rounded-md border border-navy-100 p-1">
            {sortedGroups.map((group) => (
              <GroupBlock
                key={group.id}
                group={group}
                categories={categories.filter((c) => c.groupId === group.id)}
                allGroups={groups}
                onRenameGroup={(name) => {
                  onGroupsChange(groups.map((g) => (g.id === group.id ? { ...g, name } : g)));
                  void run(() => updateProjectCategoryGroupAction(group.id, name).then((r) => ({ error: r.error })));
                }}
                onToggleGroupActive={(active) => {
                  onGroupsChange(groups.map((g) => (g.id === group.id ? { ...g, active } : g)));
                  void run(() => setProjectCategoryGroupActiveAction(group.id, active));
                }}
                onDeleteGroup={() => {
                  // Client가 "하위 중분류 0개"라고 판단했을 때만 여기까지 온다
                  // (GroupHeaderRow가 확인 popup까지 거친 뒤 호출). 그래도 서버가
                  // 최종적으로 다시 개수를 세어 거부할 수 있으므로(Client 조건만
                  // 믿지 않음) 실패 시 낙관적으로 지우지 않고 에러만 보여준다.
                  void deleteProjectCategoryGroupAction(group.id)
                    .then((res) => {
                      if (res.error) {
                        setError(res.error);
                        return;
                      }
                      onGroupsChange(groups.filter((g) => g.id !== group.id));
                    })
                    .catch(() => setError("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요."));
                }}
                onReorderCategories={(orderedIds) => {
                  const orderById = new Map(orderedIds.map((id, i) => [id, i]));
                  onCategoriesChange(categories.map((c) => (orderById.has(c.id) ? { ...c, order: orderById.get(c.id)! } : c)));
                  void run(() => reorderProjectCategoriesAction(orderedIds));
                }}
                onRenameCategory={(id, name) => {
                  onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, name } : c)));
                  void run(() => updateProjectCategoryAction(id, { name }).then((r) => ({ error: r.error })));
                }}
                onColorCategory={(id, color) => {
                  onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, color } : c)));
                  void run(() => updateProjectCategoryAction(id, { color }).then((r) => ({ error: r.error })));
                }}
                onToggleCategoryActive={(id, active) => {
                  onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, active } : c)));
                  void run(() => toggleProjectCategoryActiveAction(id, active));
                }}
                onMoveCategory={(id, groupId) => {
                  onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, groupId } : c)));
                  void run(() => moveProjectCategoryToGroupAction(id, groupId).then((r) => ({ error: r.error })));
                }}
                onDeleteCategory={(id) => {
                  void removeProjectCategoryAction(id)
                    .then((res) => {
                      if (res.error) {
                        setError(res.error);
                        return;
                      }
                      if (res.deactivated) {
                        onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, active: false } : c)));
                      } else {
                        onCategoriesChange(categories.filter((c) => c.id !== id));
                      }
                    })
                    .catch(() => setError("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요."));
                }}
                onAddCategory={async (name) => {
                  const res = await createProjectCategoryAction(name, group.id);
                  if (res.error) return { error: res.error };
                  if (res.category) onCategoriesChange([...categories, res.category]);
                  return {};
                }}
              />
            ))}
            {sortedGroups.length === 0 && <p className="p-2 text-xs text-navy-950/40">등록된 대분류가 없습니다.</p>}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-navy-100 px-2.5 py-1.5 text-sm"
          placeholder="새 대분류명(예: 케이스)"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAddGroup();
            }
          }}
        />
        <button
          type="button"
          onClick={handleAddGroup}
          disabled={busy || !newGroupName.trim()}
          className="shrink-0 rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          + 대분류 추가
        </button>
      </div>
    </div>
  );
}

export function ScheduleSettingsModal({
  categoryOptions,
  statusOptions,
  projectCategories,
  projectCategoryGroups,
  onCategoryOptionsChange,
  onStatusOptionsChange,
  onProjectCategoriesChange,
  onProjectCategoryGroupsChange,
  onClose,
}: {
  categoryOptions: ScheduleOptionInfo[];
  statusOptions: ScheduleOptionInfo[];
  projectCategories: ProjectCategoryOption[];
  projectCategoryGroups: ProjectCategoryGroupOption[];
  onCategoryOptionsChange: (next: ScheduleOptionInfo[]) => void;
  onStatusOptionsChange: (next: ScheduleOptionInfo[]) => void;
  onProjectCategoriesChange: (next: ProjectCategoryOption[]) => void;
  onProjectCategoryGroupsChange: (next: ProjectCategoryGroupOption[]) => void;
  onClose: () => void;
}) {
  const dragStartedInEditableRef = useRef(false);

  function upsert<T extends { id: string }>(list: T[], updated: T): T[] {
    return list.some((i) => i.id === updated.id) ? list.map((i) => (i.id === updated.id ? updated : i)) : [...list, updated];
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        // TaskDetailPanel.tsx isTextEditableTarget 주석 참고 — 이름 수정
        // input에서 드래그로 텍스트를 선택하다 포인터가 이 Backdrop까지
        // 나가도 Modal이 닫히지 않게 한다.
        dragStartedInEditableRef.current = isTextEditableTarget(e.target);
      }}
      onClick={(e) => {
        if (dragStartedInEditableRef.current) {
          dragStartedInEditableRef.current = false;
          return;
        }
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-xl border border-navy-100 bg-white text-sm shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-navy-100 px-5 py-3">
          <p className="font-semibold text-navy-950">일정 설정</p>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-navy-950/40 hover:text-navy-950">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <OptionListSection
            title="상태 관리"
            description="예정/진행중/완료/보류는 시스템 기본 상태입니다. 완료로 표시된 상태만 지연 여부 계산에서 제외됩니다."
            items={statusOptions}
            addPlaceholder="새 상태 이름(예: 미결)"
            reservedIds={RESERVED_STATUS_IDS}
            onAdd={async (label) => {
              const res = await createTaskStatusOptionAction(label, "#94a3b8");
              if (res.option) onStatusOptionsChange(upsert(statusOptions, res.option));
              return { error: res.error };
            }}
            onRename={async (id, label) => {
              const res = await updateTaskStatusOptionAction(id, { label });
              if (res.option) onStatusOptionsChange(upsert(statusOptions, res.option));
              return { error: res.error };
            }}
            onColor={async (id, color) => {
              const res = await updateTaskStatusOptionAction(id, { color });
              if (res.option) onStatusOptionsChange(upsert(statusOptions, res.option));
              return { error: res.error };
            }}
            onToggleActive={async (id, active) => {
              const res = await setTaskStatusOptionActiveAction(id, active);
              if (!res.error) onStatusOptionsChange(statusOptions.map((s) => (s.id === id ? { ...s, active } : s)));
              return { error: res.error };
            }}
            onReorder={async (orderedIds) => {
              const res = await reorderTaskStatusOptionsAction(orderedIds);
              if (!res.error) {
                onStatusOptionsChange(orderedIds.map((id, order) => ({ ...statusOptions.find((s) => s.id === id)!, order })));
              }
              return { error: res.error };
            }}
            onDelete={async (id) => {
              const res = await deleteTaskStatusOptionAction(id);
              if (!res.error) onStatusOptionsChange(statusOptions.filter((s) => s.id !== id));
              return { error: res.error };
            }}
          />

          <OptionListSection
            title="업무 구분 관리"
            description="프로젝트/미팅 등 시스템 업무구분은 이름·색을 바꿔도 전용 입력폼이 그대로 동작합니다. 새로 추가하는 업무구분은 일반 업무로 취급됩니다."
            items={categoryOptions}
            addPlaceholder="새 업무 구분 이름"
            reservedIds={RESERVED_CATEGORY_IDS}
            onAdd={async (label) => {
              const res = await createTaskCategoryOptionAction(label, "#94a3b8");
              if (res.option) onCategoryOptionsChange(upsert(categoryOptions, res.option));
              return { error: res.error };
            }}
            onRename={async (id, label) => {
              const res = await updateTaskCategoryOptionAction(id, { label });
              if (res.option) onCategoryOptionsChange(upsert(categoryOptions, res.option));
              return { error: res.error };
            }}
            onColor={async (id, color) => {
              const res = await updateTaskCategoryOptionAction(id, { color });
              if (res.option) onCategoryOptionsChange(upsert(categoryOptions, res.option));
              return { error: res.error };
            }}
            onToggleActive={async (id, active) => {
              const res = await setTaskCategoryOptionActiveAction(id, active);
              if (!res.error) onCategoryOptionsChange(categoryOptions.map((c) => (c.id === id ? { ...c, active } : c)));
              return { error: res.error };
            }}
            onReorder={async (orderedIds) => {
              const res = await reorderTaskCategoryOptionsAction(orderedIds);
              if (!res.error) {
                onCategoryOptionsChange(orderedIds.map((id, order) => ({ ...categoryOptions.find((c) => c.id === id)!, order })));
              }
              return { error: res.error };
            }}
            onDelete={async (id) => {
              const res = await deleteTaskCategoryOptionAction(id);
              if (!res.error) onCategoryOptionsChange(categoryOptions.filter((c) => c.id !== id));
              return { error: res.error };
            }}
          />

          <ProjectCategoryHierarchySection
            groups={projectCategoryGroups}
            categories={projectCategories}
            onGroupsChange={onProjectCategoryGroupsChange}
            onCategoriesChange={onProjectCategoriesChange}
          />
        </div>
      </div>
    </div>
  );
}
