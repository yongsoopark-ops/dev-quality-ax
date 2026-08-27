import type { TaskCategory, TaskStatus } from "@/app/generated/prisma/enums";
import type { TaskWithRelations } from "@/lib/schedule/types";

/**
 * Calendar 상단 필터 상태. 세 축 모두 "빈 배열 = 필터 없음(전체 표시)"이다 —
 * 아무것도 선택하지 않았을 때 전체를 숨기는 것보다 전체를 보여주는 쪽이 필터
 * 추가 전 기존 동작과 동일해 회귀가 없다. Client 표시만 제어하며 DB 조회/저장
 * 로직(actions.ts, page.tsx)에는 전혀 관여하지 않는다.
 */
export interface ScheduleFilters {
  /** 선택된 담당자 User id 목록. */
  assigneeIds: string[];
  /** "미배정"(TaskAssignee 없음) Task도 포함할지 — 담당자 목록과 별개 토글. */
  includeUnassigned: boolean;
  categories: TaskCategory[];
  statuses: TaskStatus[];
}

export const EMPTY_SCHEDULE_FILTERS: ScheduleFilters = {
  assigneeIds: [],
  includeUnassigned: false,
  categories: [],
  statuses: [],
};

export function isFiltersEmpty(filters: ScheduleFilters): boolean {
  return (
    filters.assigneeIds.length === 0 &&
    !filters.includeUnassigned &&
    filters.categories.length === 0 &&
    filters.statuses.length === 0
  );
}

function matchesAssignee(task: TaskWithRelations, filters: ScheduleFilters): boolean {
  if (filters.assigneeIds.length === 0 && !filters.includeUnassigned) return true;
  if (task.assigneeIds.length === 0) return filters.includeUnassigned;
  return task.assigneeIds.some((id) => filters.assigneeIds.includes(id));
}

function matchesCategory(task: TaskWithRelations, filters: ScheduleFilters): boolean {
  if (filters.categories.length === 0) return true;
  return filters.categories.includes(task.category);
}

function matchesStatus(task: TaskWithRelations, filters: ScheduleFilters): boolean {
  if (filters.statuses.length === 0) return true;
  return filters.statuses.includes(task.status);
}

/** 담당자(합집합)·업무구분(합집합)·상태(합집합) 세 축은 서로 AND, 각 축 내부는 OR. */
export function filterTasks(tasks: TaskWithRelations[], filters: ScheduleFilters): TaskWithRelations[] {
  if (isFiltersEmpty(filters)) return tasks;
  return tasks.filter(
    (task) => matchesAssignee(task, filters) && matchesCategory(task, filters) && matchesStatus(task, filters),
  );
}
