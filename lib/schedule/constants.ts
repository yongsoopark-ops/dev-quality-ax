/** /schedule page.tsx가 ProjectCategory/TaskCategoryOption/TaskStatusOption
 * 목록을 캐시할 때 쓰는 키. "use server" 파일(actions.ts)은 함수 외의 export를
 * 허용하지 않아 여기 둔다. 저장 계열 함수들이 저장 직후 이 키로 무효화한다. */
export const PROJECT_CATEGORIES_CACHE_KEY = "project-categories";
export const PROJECT_CATEGORY_GROUPS_CACHE_KEY = "project-category-groups";
export const TASK_CATEGORY_OPTIONS_CACHE_KEY = "task-category-options";
export const TASK_STATUS_OPTIONS_CACHE_KEY = "task-status-options";

/**
 * Step 5B-4(사용자 정의 업무 구분) — 예전 TaskCategory Prisma enum이 하던
 * "업무구분별 분기"(프로젝트 전용 필드, 미팅 전용 필드 등) 역할을 대신하는
 * 시스템 예약 key다. DB의 TaskCategoryOption.id 중 이 7개는 절대 바뀌지
 * 않는다(migration에서 직접 이 문자열로 seed) — 사용자가 label(표시 이름)을
 * 바꿔도 이 key로 저장된 Task는 계속 같은 입력폼/자동화를 탄다. `TaskCategory.
 * PROJECT`처럼 예전 enum 값 접근 구문을 그대로 쓸 수 있도록 같은 모양의
 * 객체로 만들었다 — import 시 `TASK_CATEGORY_KEY as TaskCategory`로 별칭만
 * 바꾸면 기존 코드 대부분이 수정 없이 그대로 동작한다.
 */
export const TASK_CATEGORY_KEY = {
  PROJECT: "PROJECT",
  PERSONAL_GOAL: "PERSONAL_GOAL",
  EXCEPTION: "EXCEPTION",
  MEETING: "MEETING",
  COMMON: "COMMON",
  VACATION: "VACATION",
  HALF_DAY: "HALF_DAY",
} as const;

/** Step 5B-4(사용자 정의 상태) — TASK_CATEGORY_KEY와 동일한 설계. "DONE"은
 * isTaskOverdue(지연 여부 계산)가 계속 신뢰하는 유일한 값이다. */
export const TASK_STATUS_KEY = {
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  ON_HOLD: "ON_HOLD",
} as const;

/** Step 5B-5 migration(20260901002522_project_category_groups)이 기존
 * ProjectCategory 19개를 안전하게 백필하려고 시드한 시스템 기본 대분류
 * "미분류"의 고정 id — migration.sql에 이 문자열 그대로 하드코딩돼 있다.
 * 이 그룹은 삭제/비활성화 둘 다 금지한다(Step 5B-6): 그룹 없는 카테고리가
 * 생기지 않도록 항상 "안전한 임시 소속지"로 남아 있어야 한다. */
export const DEFAULT_PROJECT_CATEGORY_GROUP_ID = "cltmpprjcatgroupdefault0001";

export const HALF_DAY_PERIOD_OPTIONS = ["AM", "PM"] as const;
export const HALF_DAY_PERIOD_LABELS: Record<(typeof HALF_DAY_PERIOD_OPTIONS)[number], string> = {
  AM: "오전",
  PM: "오후",
};

/** 연한 배경/진한 텍스트/포인트 색 3색 세트 — Category·Status 카드형 Filter,
 * Task Bar, Task 상세의 선택된 업무구분 표시가 전부 이 하나의 팔레트를
 * 공유한다(디자인 통일, 별도 시스템 신설 아님). */
export interface ColorTint {
  bg: string;
  border: string;
  text: string;
}

/** Step 5B-4 이전에는 업무구분/상태마다 손으로 고른 3색 세트(TASK_CATEGORY_TINTS/
 * TASK_STATUS_TINTS)를 썼지만, 이제 색은 사용자가 직접 고르는 값 하나(hex)뿐이라
 * 그 색 하나로부터 "연한 배경 + 원래 색 border + 가독성 있는 text" 3색을
 * 계산해낸다. 대비가 충분하면 원래 색을 text로 그대로 쓰고, 너무 밝아 흰
 * 배경 위에서 읽기 어려우면(요청사항: 텍스트 가독성 자동 결정) 어둡게 보정한다. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return [148, 163, 184]; // 안전한 회색 fallback
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 상대 휘도 근사치 — 0(검정)~1(흰색). */
function relativeLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function tintFromColor(hex: string): ColorTint {
  const [r, g, b] = hexToRgb(hex);
  const luminance = relativeLuminance(r, g, b);
  // 너무 밝은 색(파스텔 등)은 흰 배경 위에서 text로 쓰면 가독성이 떨어진다 —
  // 어두운 방향으로 섞어 보정한다(완전 검정으로 만들지는 않는다).
  const text = luminance > 0.6 ? rgbToHex(r * 0.55, g * 0.55, b * 0.55) : hex;
  // 배경은 항상 흰색에 가깝게, 원래 색을 10% 정도만 섞은 옅은 톤으로.
  const bg = rgbToHex(r * 0.1 + 255 * 0.9, g * 0.1 + 255 * 0.9, b * 0.1 + 255 * 0.9);
  return { bg, border: hex, text };
}

/** 담당자 Avatar/식별 색 — 실제 User가 늘어나도 순환 배정되도록 User
 * 이름/이름 하드코딩이 아니라 "users 배열 안 순번"으로 색을 고른다(요청사항
 * 23). 미배정은 이 순환에 포함되지 않는 별도 회색 고정 색이다.
 *
 * Step(주간 간트 가시성 개선) — 이전에는 row/cell(Row 전체 배경색)도 이
 * 팔레트에 있었으나, 일정 Bar 색상과 겹쳐 가시성이 떨어진다는 요청사항으로
 * Row 배경 자체를 없앴다(흰색 기반, hover만 옅은 회색). 담당자 구분은 이제
 * accent(이름 옆 얇은 색상 표시줄/dot)만으로 표현한다 — row/cell 필드는
 * 더 이상 쓰이지 않아 제거했다(사용처: CustomWeekView.tsx 한 곳뿐이었음). */
export interface UserTint {
  avatarBg: string;
  avatarText: string;
  /** Row 안 이름 옆 얇은 accent 표시줄/dot 색. 기존 ring 값(중간 톤)을 그대로
   * 재사용한다. */
  accent: string;
}

const USER_TINT_PALETTE: UserTint[] = [
  { avatarBg: "#dbe7fb", avatarText: "#1d4ed8", accent: "#a9c3f2" }, // Blue
  { avatarBg: "#e4daf6", avatarText: "#6d28d9", accent: "#c3b1e8" }, // Purple
  { avatarBg: "#daf1e1", avatarText: "#15803d", accent: "#a9dcbb" }, // Green
  { avatarBg: "#f4ecce", avatarText: "#a16207", accent: "#e2cd8f" }, // Amber
];

export const UNASSIGNED_USER_TINT: UserTint = {
  avatarBg: "#e2e5ea",
  avatarText: "#64748b",
  accent: "#c3cad3",
};

/** Step(담당자 UX 개선) — "공통"(특정 개인 담당자 없이 의도적으로 팀 전체
 * 업무) row 전용. 미배정과 시각적으로 헷갈리지 않도록 회색이 아닌 navy
 * 계열의 중립 색을 쓴다 — 그 외에는 UNASSIGNED_USER_TINT와 동일한 강도. */
export const COMMON_ASSIGNEE_TINT: UserTint = {
  avatarBg: "#e1e7f5",
  avatarText: "#334876",
  accent: "#aab8d9",
};

export function getUserTint(indexInUsers: number): UserTint {
  return USER_TINT_PALETTE[indexInUsers % USER_TINT_PALETTE.length];
}

/** "박용수" → "용수"(성을 뗀 뒤 2글자) — 이름이 2자 미만이면 그대로 노출. */
export function getUserInitials(name: string | null | undefined, fallback: string): string {
  const source = (name && name.trim()) || fallback;
  return source.length >= 2 ? source.slice(-2) : source;
}

/** 지연 여부는 DB 상태가 아니라 항상 이 함수로 계산한다. statusOptionId가
 * 예약 key "DONE"일 때만 완료로 취급한다 — 사용자가 새로 추가한 상태(예:
 * "드랍")는 완료 취급하지 않는다(요청사항: 신규 옵션은 기본 GENERIC 동작).
 *
 * Step 5B-7(미팅 회차별 자동 상태) — MEETING의 dueDate는 항상 그 날짜 00:00
 * (시간 정보 없음)이라, 당일 오후에 열리는 미팅도 자정이 지났다는 이유만으로
 * "지연"으로 잘못 표시되는 문제가 있었다(실사용 검증에서 발견). MEETING은
 * 예정/진행중/완료 자동 상태(getEffectiveTaskStatus)가 이미 시간 정보를 전부
 * 담고 있어 "지연" 배지가 따로 필요 없다 — category가 MEETING이면 항상 false. */
export function isTaskOverdue(dueDate: Date | string, statusOptionId: string, category?: string): boolean {
  if (category === TASK_CATEGORY_KEY.MEETING) return false;
  if (statusOptionId === TASK_STATUS_KEY.DONE) return false;
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return due.getTime() < Date.now();
}
