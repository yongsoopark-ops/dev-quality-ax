import { TaskCategory, TaskStatus } from "@/app/generated/prisma/enums";

/** /schedule page.tsx가 ProjectCategory 목록을 캐시할 때 쓰는 키. "use server"
 * 파일(actions.ts)은 함수 외의 export를 허용하지 않아 여기 둔다. 저장 계열
 * 함수(createProjectCategoryAction 등) 3곳이 저장 직후 이 키로 무효화한다. */
export const PROJECT_CATEGORIES_CACHE_KEY = "project-categories";

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  PROJECT: "프로젝트",
  PERSONAL_GOAL: "개인 목표",
  EXCEPTION: "예외 업무",
  MEETING: "미팅",
  COMMON: "공통 업무",
  VACATION: "휴가",
  HALF_DAY: "반차",
};

export const TASK_CATEGORY_OPTIONS: TaskCategory[] = [
  TaskCategory.PROJECT,
  TaskCategory.PERSONAL_GOAL,
  TaskCategory.EXCEPTION,
  TaskCategory.MEETING,
  TaskCategory.COMMON,
  TaskCategory.VACATION,
  TaskCategory.HALF_DAY,
];

export const HALF_DAY_PERIOD_OPTIONS = ["AM", "PM"] as const;
export const HALF_DAY_PERIOD_LABELS: Record<(typeof HALF_DAY_PERIOD_OPTIONS)[number], string> = {
  AM: "오전",
  PM: "오후",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "예정",
  IN_PROGRESS: "진행중",
  DONE: "완료",
  ON_HOLD: "보류",
};

export const TASK_STATUS_OPTIONS: TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.DONE,
  TaskStatus.ON_HOLD,
];

/** 연한 배경/진한 텍스트/포인트 색 3색 세트 — Category·Status 카드형 Filter,
 * Task Bar, Task 상세의 선택된 업무구분 표시가 전부 이 하나의 팔레트를
 * 공유한다(디자인 통일, 별도 시스템 신설 아님). */
export interface ColorTint {
  bg: string;
  border: string;
  text: string;
}

/** Calendar/Filter/Modal이 모두 공유하는 업무 구분별 저채도 색상. 기존
 * TASK_CATEGORY_COLORS(진한 원색 단색 채우기)를 대체한다 — Task Bar는 이제
 * 진한 단색으로 칠하지 않고 연한 배경 + 진한 텍스트 + 포인트 accent(왼쪽 얇은
 * 띠)로 표시한다(요청사항: 과도하게 컬러풀한 원색 금지). */
export const TASK_CATEGORY_TINTS: Record<TaskCategory, ColorTint> = {
  PROJECT: { bg: "#e9f1fd", border: "#5b8def", text: "#1d4ed8" },
  PERSONAL_GOAL: { bg: "#e9f7ee", border: "#5cb87a", text: "#15803d" },
  EXCEPTION: { bg: "#fdf3e6", border: "#e0a458", text: "#b45309" },
  MEETING: { bg: "#f1edfb", border: "#9b87d9", text: "#6d28d9" },
  COMMON: { bg: "#eef1f5", border: "#94a3b8", text: "#475569" },
  VACATION: { bg: "#e8f6f8", border: "#5aa9b6", text: "#0e7490" },
  HALF_DAY: { bg: "#fbf6e2", border: "#d1b354", text: "#a16207" },
};

/** 상태 Filter/Modal 상태 선택 카드용 — 업무 구분보다 채도를 더 낮춘다(요청사항). */
export const TASK_STATUS_TINTS: Record<TaskStatus, ColorTint> = {
  TODO: { bg: "#f1f4f8", border: "#a3b0c2", text: "#475569" },
  IN_PROGRESS: { bg: "#eaf0fa", border: "#93aed8", text: "#3d5a8a" },
  DONE: { bg: "#eef6f0", border: "#96c1a5", text: "#3f7a52" },
  ON_HOLD: { bg: "#f6f2ec", border: "#c7ac8a", text: "#8a6435" },
};

/** Week Swimlane Row/담당자 Avatar 색 — 실제 User가 늘어나도 순환 배정되도록
 * User 이름/이름 하드코딩이 아니라 "users 배열 안 순번"으로 색을 고른다
 * (요청사항 23). 미배정은 이 순환에 포함되지 않는 별도 회색 고정 색이다. */
export interface UserTint {
  row: string;
  cell: string;
  avatarBg: string;
  avatarText: string;
  ring: string;
}

const USER_TINT_PALETTE: UserTint[] = [
  { row: "#eef4fd", cell: "#e1ebfa", avatarBg: "#dbe7fb", avatarText: "#1d4ed8", ring: "#a9c3f2" }, // Blue
  { row: "#f4f0fb", cell: "#e9e1f7", avatarBg: "#e4daf6", avatarText: "#6d28d9", ring: "#c3b1e8" }, // Purple
  { row: "#eef8f1", cell: "#e0f2e6", avatarBg: "#daf1e1", avatarText: "#15803d", ring: "#a9dcbb" }, // Green
  { row: "#fbf6e8", cell: "#f6edd3", avatarBg: "#f4ecce", avatarText: "#a16207", ring: "#e2cd8f" }, // Amber
];

export const UNASSIGNED_USER_TINT: UserTint = {
  row: "#f3f4f6",
  cell: "#e8eaed",
  avatarBg: "#e2e5ea",
  avatarText: "#64748b",
  ring: "#c3cad3",
};

export function getUserTint(indexInUsers: number): UserTint {
  return USER_TINT_PALETTE[indexInUsers % USER_TINT_PALETTE.length];
}

/** "박용수" → "용수"(성을 뗀 뒤 2글자) — 이름이 2자 미만이면 그대로 노출. */
export function getUserInitials(name: string | null | undefined, fallback: string): string {
  const source = (name && name.trim()) || fallback;
  return source.length >= 2 ? source.slice(-2) : source;
}

/** 지연 여부는 DB 상태가 아니라 항상 이 함수로 계산한다. */
export function isTaskOverdue(dueDate: Date | string, status: TaskStatus): boolean {
  if (status === TaskStatus.DONE) return false;
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return due.getTime() < Date.now();
}
