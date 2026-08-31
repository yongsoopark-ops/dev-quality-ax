"use client";

import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SmartLink } from "@/components/nav/SmartLink";
import type { Session } from "next-auth";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { signOutAction } from "@/lib/actions";
import { saveSidebarLayout } from "@/lib/sidebar/actions";
import { moveGroups, moveMenuAcrossGroups, moveMenuWithinGroup } from "@/lib/sidebar/dragLogic";
import { mergeSidebarLayout } from "@/lib/sidebar/mergeSidebarLayout";
import { getGroupById, getMenuById } from "@/lib/sidebar/sidebarConfig";
import type { RenderableSidebarGroup, RenderableSidebarMenu, SidebarLayoutData } from "@/lib/sidebar/types";

function navLinkClass(active: boolean) {
  return active
    ? "flex flex-1 items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm font-medium text-navy-900"
    : "flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/5";
}

function isActiveHref(href: string, pathname: string | null): boolean {
  if (href === "/home") return pathname === "/home";
  return pathname?.startsWith(href) ?? false;
}

/** 저장된 SidebarLayoutData(id만)를 mergeSidebarLayout(null)의 기본 구성 결과로 변환한다. */
function toRenderableGroups(data: SidebarLayoutData): RenderableSidebarGroup[] {
  return data.map((g) => {
    const groupDef = getGroupById(g.groupId);
    return {
      groupId: g.groupId,
      label: groupDef?.label ?? g.groupId,
      order: g.order,
      items: g.items
        .map((id) => getMenuById(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({ id: m.id, label: m.label, href: m.href })),
    };
  });
}

function DragHandle({ attributes, listeners }: { attributes: object; listeners: object | undefined }) {
  return (
    <span
      {...attributes}
      {...listeners}
      className="shrink-0 cursor-grab px-1 text-white/40 hover:text-white/70 active:cursor-grabbing"
      aria-label="드래그하여 순서 변경"
    >
      ⠿
    </span>
  );
}

function SortableMenuRow({
  menu,
  groupId,
  editMode,
  active,
}: {
  menu: RenderableSidebarMenu;
  groupId: string;
  editMode: boolean;
  active: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: menu.id,
    data: { type: "menu", groupId },
    disabled: !editMode,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-1"
    >
      {editMode && <DragHandle attributes={attributes} listeners={listeners} />}
      {editMode ? (
        <span className={navLinkClass(active) + " cursor-default select-none"}>
          <span className="h-2 w-2 rounded-full bg-current" />
          {menu.label}
        </span>
      ) : (
        <SmartLink href={menu.href} className={navLinkClass(active)}>
          <span className="h-2 w-2 rounded-full bg-current" />
          {menu.label}
        </SmartLink>
      )}
    </div>
  );
}

function SortableGroupSection({
  group,
  editMode,
  expanded,
  onToggle,
  pathname,
}: {
  group: RenderableSidebarGroup;
  editMode: boolean;
  expanded: boolean;
  onToggle: () => void;
  pathname: string | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.groupId, data: { type: "group" }, disabled: !editMode });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `group-dropzone:${group.groupId}`,
    data: { type: "group-dropzone", groupId: group.groupId },
  });

  return (
    <div
      ref={setSortableRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="flex w-full items-center gap-1 rounded-lg px-1 py-1">
        {editMode && <DragHandle attributes={attributes} listeners={listeners} />}
        <button
          type="button"
          onClick={onToggle}
          disabled={editMode}
          className="flex flex-1 items-center justify-between rounded-lg px-2 py-1 text-xs font-medium text-white/50 transition-colors hover:text-white/70 disabled:hover:text-white/50"
        >
          <span>{group.label}</span>
          {!editMode && <span className="text-white/40">{expanded ? "▾" : "▸"}</span>}
        </button>
      </div>
      <div
        ref={setDropRef}
        className={`mt-1 space-y-1 rounded-md pl-2 ${editMode && isOver ? "outline outline-dashed outline-1 outline-navy-100/60" : ""}`}
      >
        {(editMode || expanded) &&
          (editMode || group.items.length > 0) && (
            <SortableContext
              items={group.items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {group.items.length === 0 ? (
                editMode && <p className="px-2 py-1 text-[11px] text-white/30">(비어 있음)</p>
              ) : (
                group.items.map((item) => (
                  <SortableMenuRow
                    key={item.id}
                    menu={item}
                    groupId={group.groupId}
                    editMode={editMode}
                    active={isActiveHref(item.href, pathname)}
                  />
                ))
              )}
            </SortableContext>
          )}
      </div>
    </div>
  );
}

export default function Sidebar({
  session,
  fixedMenus,
  initialGroups,
}: {
  session: Session | null;
  fixedMenus: { id: string; label: string; href: string }[];
  initialGroups: RenderableSidebarGroup[];
}) {
  const user = session?.user;
  const isAdmin = user?.role === "ADMIN";
  const pathname = usePathname();

  const [savedGroups, setSavedGroups] = useState<RenderableSidebarGroup[]>(initialGroups);
  const [groups, setGroups] = useState<RenderableSidebarGroup[]>(initialGroups);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [manualExpand, setManualExpand] = useState<Record<string, boolean>>({});

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const visibleGroups = editMode ? groups : groups.filter((g) => g.items.length > 0);

  function isGroupExpanded(group: RenderableSidebarGroup): boolean {
    if (editMode) return true;
    const isActiveGroup = group.items.some((item) => isActiveHref(item.href, pathname));
    return manualExpand[group.groupId] ?? isActiveGroup;
  }

  function startEdit() {
    setSaveError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    setGroups(savedGroups);
    setSaveError(null);
    setEditMode(false);
  }

  function applyDefaultLayout() {
    // Preview일 뿐이며, "저장"을 눌러야 실제 공통 Sidebar에 반영된다.
    setGroups(toRenderableGroups(mergeSidebarLayout(null)));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const payload: SidebarLayoutData = groups.map((g, index) => ({
      groupId: g.groupId,
      order: index,
      items: g.items.map((item) => item.id),
    }));
    const res = await saveSidebarLayout(payload);
    setSaving(false);
    if ("error" in res) {
      setSaveError(res.error);
      return;
    }
    setSavedGroups(groups);
    setEditMode(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { type?: string; groupId?: string } | undefined;
    const overData = over.data.current as { type?: string; groupId?: string } | undefined;

    if (activeData?.type === "group") {
      // Group Drag 중에는 대상 Group의 헤더 자체보다 그 안에 펼쳐진 Menu Row나
      // group-dropzone 위에 놓이는 경우가 훨씬 흔하다(편집 모드에서는 항상 펼쳐져
      // 있으므로). over.id가 Menu/Dropzone id일 때도 그게 속한 groupId로 풀어야
      // "다른 Group의 메뉴 영역 위에 놓기"가 정상적으로 그 Group으로의 이동으로
      // 인식된다 — 그렇지 않으면 groups 배열에서 못 찾아 조용히 무시돼 버린다.
      let toGroupId: string | undefined;
      if (overData?.type === "group") toGroupId = String(over.id);
      else if (overData?.type === "menu" || overData?.type === "group-dropzone") toGroupId = overData.groupId;
      if (!toGroupId) return;

      const fromIndex = groups.findIndex((g) => g.groupId === active.id);
      const toIndex = groups.findIndex((g) => g.groupId === toGroupId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
      setGroups((prev) => moveGroups(prev, fromIndex, toIndex));
      return;
    }

    if (activeData?.type === "menu") {
      const fromGroupId = activeData.groupId;
      let toGroupId: string | undefined;
      if (overData?.type === "menu") toGroupId = overData.groupId;
      else if (overData?.type === "group-dropzone") toGroupId = overData.groupId;
      else if (overData?.type === "group") toGroupId = String(over.id);
      if (!fromGroupId || !toGroupId) return;

      const fromGroupIndex = groups.findIndex((g) => g.groupId === fromGroupId);
      const toGroupIndex = groups.findIndex((g) => g.groupId === toGroupId);
      if (fromGroupIndex === -1 || toGroupIndex === -1) return;

      const itemIndex = groups[fromGroupIndex].items.findIndex((item) => item.id === active.id);
      if (itemIndex === -1) return;

      let toIndex = groups[toGroupIndex].items.findIndex((item) => item.id === over.id);
      if (toIndex === -1) toIndex = groups[toGroupIndex].items.length;

      if (fromGroupIndex === toGroupIndex) {
        if (itemIndex === toIndex) return;
        setGroups((prev) => moveMenuWithinGroup(prev, fromGroupIndex, itemIndex, toIndex));
      } else {
        setGroups((prev) => moveMenuAcrossGroups(prev, fromGroupIndex, itemIndex, toGroupIndex, toIndex));
      }
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col bg-navy-900 text-white md:h-screen md:w-64 md:sticky md:top-0">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-700">
          <span className="text-sm font-semibold">AX</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-white">개발품질 AX</span>
          <span className="text-xs text-navy-100/70">Development Quality</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {fixedMenus.map((menu) => (
          <SmartLink key={menu.id} href={menu.href} className={navLinkClass(isActiveHref(menu.href, pathname))}>
            <span className="h-2 w-2 rounded-full bg-current" />
            {menu.label}
          </SmartLink>
        ))}

        {/* Hotfix — "메뉴 구성" 라벨/편집 버튼/편집 모드 컨트롤(기본구성·취소·저장)은
            ADMIN 전용으로 유지한다. 예전에는 이 isAdmin 블록 안에 아래 그룹 메뉴
            목록(visibleGroups.map)까지 함께 들어 있어, MEMBER는 서버가 SCHEDULE을
            정상 내려줘도(getRenderableSidebar) 화면에서 그룹 메뉴 전체가 사라지는
            버그가 있었다 — 그룹 메뉴 렌더링은 아래에서 role과 무관하게 항상
            렌더한다(요청사항). */}
        {isAdmin && (
          <div className="flex items-center justify-between px-2 pt-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/30">메뉴 구성</span>
            {!editMode && (
              <button
                type="button"
                onClick={startEdit}
                className="text-[11px] font-medium text-white/50 hover:text-white/80"
              >
                편집
              </button>
            )}
          </div>
        )}

        {isAdmin && editMode && (
          <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
            <button
              type="button"
              onClick={applyDefaultLayout}
              disabled={saving}
              className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5 disabled:opacity-50"
            >
              기본 구성
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-navy-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            {saveError && <p className="w-full text-[11px] text-rose-300">{saveError}</p>}
          </div>
        )}

        {/* 그룹 메뉴 목록 자체는 role과 무관하게 모든 로그인 사용자에게 렌더한다 —
            어떤 메뉴가 이 안에 들어있는지는 이미 서버(getRenderableSidebar)가
            role별로 필터링해서 내려준 결과이므로, 여기서 다시 role을 검사할
            필요가 없다(ADMIN 전용 메뉴가 MEMBER의 visibleGroups에는 애초에
            존재하지 않는다). editMode는 MEMBER의 경우 "편집" 버튼 자체가
            없어 항상 false이므로, DnD/편집 UI는 실질적으로 계속 ADMIN 전용으로
            남는다 — 여기서 별도로 role을 다시 체크하지 않는다. */}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleGroups.map((g) => g.groupId)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {visibleGroups.map((group) => (
                <SortableGroupSection
                  key={group.groupId}
                  group={group}
                  editMode={editMode}
                  expanded={isGroupExpanded(group)}
                  onToggle={() => setManualExpand((prev) => ({ ...prev, [group.groupId]: !isGroupExpanded(group) }))}
                  pathname={pathname}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        {user ? (
          <>
            <div className="flex items-center gap-3">
              {user.image ? (
                <Image
                  src={user.image}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs text-white/80">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="h-4 w-4"
                  >
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M4.5 19.5c1.6-3.2 4.4-4.8 7.5-4.8s5.9 1.6 7.5 4.8" />
                  </svg>
                </div>
              )}
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium text-white">
                  {user.name}
                </p>
                <p className="truncate text-xs text-navy-100/70">
                  {user.email}
                </p>
              </div>
            </div>
            <form action={signOutAction} className="mt-3">
              <button
                type="submit"
                className="w-full rounded-md border border-white/15 px-2 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/5"
              >
                로그아웃
              </button>
            </form>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs text-white/80">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-4 w-4"
              >
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 19.5c1.6-3.2 4.4-4.8 7.5-4.8s5.9 1.6 7.5 4.8" />
              </svg>
            </div>
            <span className="text-xs text-navy-100/70">사용자 계정</span>
          </div>
        )}
      </div>
    </aside>
  );
}
