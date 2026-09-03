"use client";

import { useEffect, useRef, useState } from "react";
import { getUserInitials, getUserTint, tintFromColor, UNASSIGNED_USER_TINT } from "@/lib/schedule/constants";
import { EMPTY_SCHEDULE_FILTERS, type ScheduleFilters } from "@/lib/schedule/filters";
import type { ProjectCategoryOption, ScheduleOptionInfo, ScheduleUser } from "@/lib/schedule/types";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * 상단에는 Trigger 버튼만 보이고, 실제 선택 UI는 Popover 안에서만 펼쳐진다
 * (요청사항 4) — 체크박스 목록을 상단에 그대로 펼쳐두던 이전 방식을 대체한다.
 * filters/onChange 계약(ScheduleFilters)과 filterTasks 정책은 전혀 바꾸지 않고,
 * 여기서는 표시 방식만 바꾼다.
 */
function FilterTrigger({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {/* Step(일정 관리 + 회의록 UI Polish) — 필터 Trigger 높이/글자 확대
          (요청사항 2: "필터가 존재하는지 한눈에 인지 가능해야 한다") —
          h-7(28px) 정도이던 것을 h-9(36px)로, text-xs(12px)→text-sm(14px)로. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium ${
          count > 0
            ? "border-navy-200 bg-navy-50 text-navy-900"
            : "border-navy-100 text-navy-950/70 hover:bg-navy-50"
        }`}
      >
        {label}
        {count > 0 && <span className="text-navy-950/50">{count}</span>}
        <span className="text-[10px] text-navy-950/40">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-navy-100 bg-white p-2.5 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}

/** 사람 상체 아이콘 — 담당자 미선택 Avatar 내부에 쓴다(별도 아이콘 라이브러리
 * 없이 최소 SVG 하나만 인라인으로 둔다). */
function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 19.5c1.6-3.2 4.4-4.8 7.5-4.8s5.9 1.6 7.5 4.8" />
    </svg>
  );
}

/**
 * 담당자 Avatar 선택 버튼 — 선택되면 담당자별 포인트 색 Ring + 이름 2글자,
 * 선택되지 않으면 연한 회색 원 + 사람 아이콘(요청사항 5). Google 계열의
 * 간결한 Avatar filter를 참고하되 색은 기존 Week Swimlane과 같은 팔레트를
 * 공유해 어디서 봐도 "이 사람 = 이 색"이 일관되게 유지된다.
 */
function AssigneeAvatarButton({
  user,
  selected,
  tint,
  onClick,
}: {
  user: ScheduleUser;
  selected: boolean;
  tint: ReturnType<typeof getUserTint>;
  onClick: () => void;
}) {
  const label = user.name ?? user.email;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex flex-col items-center gap-1"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold"
        style={
          selected
            ? { backgroundColor: tint.avatarBg, color: tint.avatarText, boxShadow: `0 0 0 2px ${tint.accent}` }
            : { backgroundColor: "#eef0f3", color: "#94a3b8" }
        }
      >
        {selected ? getUserInitials(user.name, user.email) : <PersonIcon className="h-4 w-4" />}
      </span>
      <span className="max-w-[52px] truncate text-[10px] text-navy-950/60">{label}</span>
    </button>
  );
}

function CardToggle({
  selected,
  onClick,
  label,
  tint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  tint: { bg: string; border: string; text: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-shadow"
      style={{
        backgroundColor: tint.bg,
        color: tint.text,
        borderColor: selected ? tint.border : "transparent",
        boxShadow: selected ? `inset 0 0 0 1px ${tint.border}` : undefined,
      }}
    >
      {label}
    </button>
  );
}

export function ScheduleFilterBar({
  users,
  categoryOptions,
  statusOptions,
  projectCategories,
  filters,
  onChange,
}: {
  users: ScheduleUser[];
  /** Step 5B-4(사용자 정의 업무구분) — 비활성 옵션은 필터에서도 숨긴다(요청
   * 없는 옵션을 선택할 이유가 없다 — dropdown과 동일 기준). */
  categoryOptions: ScheduleOptionInfo[];
  statusOptions: ScheduleOptionInfo[];
  /** Step(일정 관리 + 회의록 UI Polish) — 새 "프로젝트 카테고리" 필터
   * (요청사항 2)가 쓰는 목록. */
  projectCategories: ProjectCategoryOption[];
  filters: ScheduleFilters;
  onChange: (next: ScheduleFilters) => void;
}) {
  const assigneeCount = filters.assigneeIds.length + (filters.includeUnassigned ? 1 : 0);
  const activeCategoryOptions = categoryOptions.filter((c) => c.active);
  const activeStatusOptions = statusOptions.filter((s) => s.active);
  const activeProjectCategories = projectCategories.filter((c) => c.active);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Step(일정 관리 + 회의록 UI Polish) — "필터가 존재하는지 한눈에
          인지 가능해야 한다"(요청사항 2) — 아이콘 + 라벨로 이 버튼 묶음이
          필터 영역임을 명시한다. */}
      <span className="flex items-center gap-1 text-sm font-medium text-navy-950/50" aria-hidden>
        🔍 필터
      </span>
      <FilterTrigger label="담당자" count={assigneeCount}>
        <div className="grid grid-cols-4 gap-2">
          {users.map((u, i) => (
            <AssigneeAvatarButton
              key={u.id}
              user={u}
              selected={filters.assigneeIds.includes(u.id)}
              tint={getUserTint(i)}
              onClick={() => onChange({ ...filters, assigneeIds: toggle(filters.assigneeIds, u.id) })}
            />
          ))}
        </div>
        <div className="my-2 border-t border-navy-100" />
        <button
          type="button"
          onClick={() => onChange({ ...filters, includeUnassigned: !filters.includeUnassigned })}
          className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-navy-950 hover:bg-navy-50"
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={
              filters.includeUnassigned
                ? { backgroundColor: UNASSIGNED_USER_TINT.avatarBg, boxShadow: `0 0 0 2px ${UNASSIGNED_USER_TINT.accent}` }
                : { backgroundColor: "#eef0f3" }
            }
          >
            <PersonIcon className="h-3.5 w-3.5 text-navy-950/40" />
          </span>
          미배정 포함
        </button>
      </FilterTrigger>

      <FilterTrigger label="업무 구분" count={filters.categories.length}>
        <div className="grid grid-cols-2 gap-1.5">
          {activeCategoryOptions.map((c) => (
            <CardToggle
              key={c.id}
              selected={filters.categories.includes(c.id)}
              onClick={() => onChange({ ...filters, categories: toggle(filters.categories, c.id) })}
              label={c.label}
              tint={tintFromColor(c.color)}
            />
          ))}
        </div>
      </FilterTrigger>

      <FilterTrigger label="상태" count={filters.statuses.length}>
        <div className="grid grid-cols-2 gap-1.5">
          {activeStatusOptions.map((s) => (
            <CardToggle
              key={s.id}
              selected={filters.statuses.includes(s.id)}
              onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, s.id) })}
              label={s.label}
              tint={tintFromColor(s.color)}
            />
          ))}
        </div>
      </FilterTrigger>

      <FilterTrigger label="프로젝트 카테고리" count={filters.projectCategoryIds.length}>
        <div className="grid grid-cols-2 gap-1.5">
          {activeProjectCategories.map((c) => (
            <CardToggle
              key={c.id}
              selected={filters.projectCategoryIds.includes(c.id)}
              onClick={() => onChange({ ...filters, projectCategoryIds: toggle(filters.projectCategoryIds, c.id) })}
              label={c.name}
              tint={tintFromColor(c.color)}
            />
          ))}
          {activeProjectCategories.length === 0 && <p className="col-span-2 text-xs text-navy-950/40">등록된 카테고리가 없습니다.</p>}
        </div>
      </FilterTrigger>

      {(assigneeCount > 0 || filters.categories.length > 0 || filters.statuses.length > 0 || filters.projectCategoryIds.length > 0) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_SCHEDULE_FILTERS)}
          className="text-[11px] text-navy-950/50 hover:text-navy-950 hover:underline"
        >
          필터 초기화
        </button>
      )}
    </div>
  );
}
