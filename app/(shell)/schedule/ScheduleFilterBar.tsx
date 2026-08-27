"use client";

import { useEffect, useRef, useState } from "react";
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_OPTIONS,
  TASK_CATEGORY_TINTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_TINTS,
  getUserInitials,
  getUserTint,
  UNASSIGNED_USER_TINT,
} from "@/lib/schedule/constants";
import { EMPTY_SCHEDULE_FILTERS, type ScheduleFilters } from "@/lib/schedule/filters";
import type { ScheduleUser } from "@/lib/schedule/types";

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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
          count > 0
            ? "border-navy-100 bg-navy-50 text-navy-900"
            : "border-navy-100 text-navy-950/60 hover:bg-navy-50"
        }`}
      >
        {label}
        {count > 0 && <span className="text-navy-950/50">{count}</span>}
        <span className="text-[9px] text-navy-950/40">▾</span>
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
            ? { backgroundColor: tint.avatarBg, color: tint.avatarText, boxShadow: `0 0 0 2px ${tint.ring}` }
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
  filters,
  onChange,
}: {
  users: ScheduleUser[];
  filters: ScheduleFilters;
  onChange: (next: ScheduleFilters) => void;
}) {
  const assigneeCount = filters.assigneeIds.length + (filters.includeUnassigned ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
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
                ? { backgroundColor: UNASSIGNED_USER_TINT.avatarBg, boxShadow: `0 0 0 2px ${UNASSIGNED_USER_TINT.ring}` }
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
          {TASK_CATEGORY_OPTIONS.map((c) => (
            <CardToggle
              key={c}
              selected={filters.categories.includes(c)}
              onClick={() => onChange({ ...filters, categories: toggle(filters.categories, c) })}
              label={TASK_CATEGORY_LABELS[c]}
              tint={TASK_CATEGORY_TINTS[c]}
            />
          ))}
        </div>
      </FilterTrigger>

      <FilterTrigger label="상태" count={filters.statuses.length}>
        <div className="grid grid-cols-2 gap-1.5">
          {TASK_STATUS_OPTIONS.map((s) => (
            <CardToggle
              key={s}
              selected={filters.statuses.includes(s)}
              onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}
              label={TASK_STATUS_LABELS[s]}
              tint={TASK_STATUS_TINTS[s]}
            />
          ))}
        </div>
      </FilterTrigger>

      {(assigneeCount > 0 || filters.categories.length > 0 || filters.statuses.length > 0) && (
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
