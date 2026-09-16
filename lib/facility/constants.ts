import type { EquipmentGrade, EquipmentKind, EquipmentLocation, EquipmentStatus, EquipmentTeamLabel, EquipmentTimeHalf, EquipmentUsagePurpose, EquipmentMetricKind } from "@/app/generated/prisma/enums";

/**
 * 설비 관리(Equipment Management) — 디자인 레퍼런스(설비 관리.dc.html /
 * README.md)에 확정된 값(hex 색상, 라벨, 시간대)을 그대로 옮긴 상수 모음.
 * 색상은 사용자가 편집하는 값이 아니라(스케줄의 TaskCategoryOption.color와
 * 다름) 디자인이 고정한 값이라, tintFromColor 같은 동적 계산 없이 그대로
 * 하드코딩한다(README "Fidelity: High-fidelity... 그대로 사용").
 */

export const EQUIPMENT_KIND_LABEL: Record<EquipmentKind, string> = {
  GENERAL: "일반",
  REPEAT: "반복",
  ENVIRONMENT: "환경",
  GENERAL_REPEAT: "일반/반복",
};

export const EQUIPMENT_LOCATION_LABEL: Record<EquipmentLocation, string> = {
  NURIKKUM: "누리꿈",
  HYANGDONG: "향동",
};

export const EQUIPMENT_GRADE_LABEL: Record<EquipmentGrade, string> = {
  HIGH: "상",
  MID: "중",
  LOW: "하",
};

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  AVAILABLE: "예약 가능",
  RESERVED: "예약 완료",
  IN_USE: "사용중",
  UNDER_REPAIR: "수리중",
};

export const EQUIPMENT_TIME_HALF_LABEL: Record<EquipmentTimeHalf, string> = {
  AM: "오전",
  PM: "오후",
};

export const EQUIPMENT_TIME_HALF_HINT: Record<EquipmentTimeHalf, string> = {
  AM: "08:00 – 11:20",
  PM: "12:20 – 17:00",
};

export const EQUIPMENT_TEAM_LABEL: Record<EquipmentTeamLabel, string> = {
  TEAM_1: "개발 1팀",
  TEAM_2: "개발 2팀",
};

export const EQUIPMENT_USAGE_PURPOSE_LABEL: Record<EquipmentUsagePurpose, string> = {
  ONE_OFF: "일반 사용 (1회성)",
  CYCLE: "반복 싸이클 사용",
};

/** 설비 구분 → 집계 지표(README "파생 규칙": 환경 → 사용 시간 · 반복 → 사이클
 * 수 · 그 외 → 사용 횟수). GENERAL_REPEAT은 예약 시 고른 목적과 무관하게
 * "그 외" 취급 — 1회성 시료 수량이 사용 횟수로 누적된다. */
export function metricKindOf(kind: EquipmentKind): EquipmentMetricKind {
  if (kind === "ENVIRONMENT") return "HOUR";
  if (kind === "REPEAT") return "CYCLE";
  return "COUNT";
}

export const EQUIPMENT_METRIC_LABEL: Record<EquipmentMetricKind, string> = {
  COUNT: "사용 횟수",
  CYCLE: "사이클 수",
  HOUR: "사용 시간",
};

export const EQUIPMENT_METRIC_UNIT: Record<EquipmentMetricKind, string> = {
  COUNT: "건",
  CYCLE: "회",
  HOUR: "시간",
};

export interface ColorPair {
  bg: string;
  text: string;
}

export const EQUIPMENT_GRADE_TAG: Record<EquipmentGrade, ColorPair> = {
  HIGH: { bg: "#1d4ed8", text: "#ffffff" },
  MID: { bg: "#e9d5ff", text: "#6b21a8" },
  LOW: { bg: "#dcfce7", text: "#166534" },
};

/** 설비 목록 정렬 — 관리대상 등급 "상 → 중 → 하" 순서. Enum 이름의 알파벳
 * 순서(HIGH < LOW < MID)와 우연히도 일치하지 않으므로, 문자열 정렬에
 * 기대지 않고 이 명시적 순위표로만 정렬한다(요청사항: "문자열 alphabetic
 * sort에 의존하지 않는다"). lib/facility/queries.ts의 getEquipmentRows가
 * 이 순위 + 관리번호 오름차순(2차, DB orderBy로 이미 보장됨)으로 최종
 * 정렬해 내려보낸다 — 화면(ReservationClient.tsx)은 이 순서를 그대로
 * 쓰고 별도로 다시 정렬하지 않는다(검색/구분 Filter는 배열 순서를 보존하는
 * Array.prototype.filter만 쓰므로 정렬이 자동으로 유지된다). */
export const EQUIPMENT_GRADE_SORT_ORDER: Record<EquipmentGrade, number> = {
  HIGH: 0,
  MID: 1,
  LOW: 2,
};

export const EQUIPMENT_STATUS_TAG: Record<EquipmentStatus, ColorPair> = {
  AVAILABLE: { bg: "#dcfce7", text: "#166534" },
  RESERVED: { bg: "#1d4ed8", text: "#ffffff" },
  IN_USE: { bg: "#fed7aa", text: "#9a3412" },
  UNDER_REPAIR: { bg: "#b91c1c", text: "#ffffff" },
};

/** 예약 등록 표의 "액션" 버튼 — 라벨별 고정 색(등급/상태 조합이 아니라
 * 액션 라벨 자체로 색이 정해진다, README 표 그대로). */
export type EquipmentActionLabel = "예약" | "시작" | "종료" | "사용" | "예약 불가";
export const EQUIPMENT_ACTION_TAG: Record<EquipmentActionLabel, ColorPair> = {
  예약: { bg: "#f3e8ff", text: "#6b21a8" },
  시작: { bg: "#dcfce7", text: "#166534" },
  종료: { bg: "#1d4ed8", text: "#ffffff" },
  사용: { bg: "#bfdbfe", text: "#1e40af" },
  "예약 불가": { bg: "#b91c1c", text: "#ffffff" },
};

/** 일정 캘린더 막대 색 — 해당 설비의 "현재 상태"를 따른다(README "일정
 * 막대" 표). */
export interface EventColor {
  bg: string;
  bar: string;
  ink: string;
}
export const EQUIPMENT_EVENT_COLOR: Record<EquipmentStatus, EventColor> = {
  AVAILABLE: { bg: "#f0fdf4", bar: "#22c55e", ink: "#166534" },
  RESERVED: { bg: "#eef2ff", bar: "#4f46e5", ink: "#3730a3" },
  IN_USE: { bg: "#eff6ff", bar: "#2563eb", ink: "#1e40af" },
  UNDER_REPAIR: { bg: "#fef2f2", bar: "#dc2626", ink: "#991b1b" },
};

/** 캘린더 사용자 레인 테마 — README 표 그대로, 파트원 4명 실명 기준(고정
 * 개인정보가 아니라 이 회사 조직의 실제 파트원 이름 4명 — Schedule/회의록
 * 기능 전반에서 이미 하드코딩되어 쓰이는 것과 동일한 관례). 이 4명 + 개발
 * 1/2팀 외의 사용자는 이 기능의 담당자 대상이 아니다(README "사용자" 정의:
 * 파트원 4명 + 개발 1팀/2팀). */
export interface LaneTheme {
  bar: string;
  chip: string;
  ink: string;
  rowBg: string;
}
export const FACILITY_PART_MEMBER_NAMES = ["김현나", "이지민", "박용수", "정효준"] as const;
export const FACILITY_LANE_THEME_BY_NAME: Record<string, LaneTheme> = {
  김현나: { bar: "#93c5fd", chip: "#dbeafe", ink: "#1e40af", rowBg: "#fafbfd" },
  박용수: { bar: "#c4b5fd", chip: "#ede9fe", ink: "#5b21b6", rowBg: "#ffffff" },
  이지민: { bar: "#a7f3d0", chip: "#d1fae5", ink: "#065f46", rowBg: "#ffffff" },
  정효준: { bar: "#fcd34d", chip: "#fef3c7", ink: "#92400e", rowBg: "#ffffff" },
};
export const FACILITY_TEAM_LANE_THEME: LaneTheme = { bar: "#e5e7eb", chip: "#f1f5f9", ink: "#64748b", rowBg: "#f6f7f9" };

export const EQUIPMENT_KIND_FILTERS = ["전체", "일반", "반복", "환경", "일반/반복"] as const;
export const EQUIPMENT_STATS_PERIODS = ["월간", "분기별", "연간"] as const;

/** 관리 대상 등급 상/중만 예약(캘린더) 대상이다 — 하는 시료 수량 집계
 * 전용(README "핵심 규칙"). */
export function isReservationEligibleGrade(grade: EquipmentGrade): boolean {
  return grade === "HIGH" || grade === "MID";
}

/**
 * 설비 관리 3개 화면 공용 Typography/밀도 class 모음(가독성 개선 요청 대응).
 * `/schedule`(app/(shell)/schedule/page.tsx)의 실제 타이포그래피를
 * 새 디자인 시스템 없이 그대로 재사용한다 — Page Title(text-3xl
 * font-bold)/Subtitle(text-sm text-navy-950/60)이 그 기준이다. FacilityPageShell의
 * 여백(px-8/pt-6/pb-8/gap-6)은 이 상수와 무관하게 그대로 유지된다(이 상수는
 * spacing이 아니라 font-size/weight/line-height/cell-padding만 다룬다).
 * 각 페이지 파일에 동일한 px 값을 반복해 흩뿌리지 않기 위해 여기 한 곳에
 * 모은다(요청사항: "공용 class/헬퍼로 통일").
 */
export const FACILITY_PAGE_TITLE_CLASS = "m-0 text-3xl font-bold text-navy-950";
export const FACILITY_PAGE_SUBTITLE_CLASS = "m-0 text-sm text-navy-950/60";
export const FACILITY_TOOLBAR_CARD_CLASS = "flex flex-wrap items-center gap-2 rounded-lg border border-navy-100 bg-white px-4 py-3";
export const FACILITY_NAV_BUTTON_CLASS = "rounded border border-navy-100 px-2.5 py-1.5 text-sm text-navy-950/70 hover:bg-navy-50";
export function facilitySegmentButtonClass(active: boolean): string {
  return `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-navy-900 text-white" : "text-navy-950/70 hover:bg-navy-50"}`;
}
export const FACILITY_TABLE_CARD_CLASS = "overflow-hidden rounded-xl border border-navy-100 bg-white";
export const FACILITY_TABLE_HEAD_ROW_CLASS = "border-b border-neutral-200 bg-slate-50 text-[13px] font-semibold text-neutral-600";
export const FACILITY_TABLE_CELL_CLASS = "px-3 py-3";
export const FACILITY_BADGE_CLASS = "rounded px-2 py-1 text-[13px] font-medium";
