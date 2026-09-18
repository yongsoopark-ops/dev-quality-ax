import type { ProgressItemStatus, ProgressStatus } from "@/app/generated/prisma/enums";

/**
 * 진행 현황 — Claude Design ZIP("진행 현황 관리판 v2.dc.html")의 실제 렌더
 * 값(ST/IT/DDAY_TONE/chip/countPill/badge 등)을 그대로 옮긴 색상/타이포
 * 토큰. Design 원본은 인라인 style로 값을 그대로 박아 넣는 방식(디자인
 * 도구 산출물)이라, 여기서는 그 값을 한 곳에 모아 여러 컴포넌트가
 * 재사용하게 한다 — 값 자체는 절대 근사치로 바꾸지 않고 Design의 hex/px를
 * 그대로 옮긴다(요청: "Badge 위치, 색상 의미... Design 그대로 구현").
 */

export interface DesignColorSet {
  color: string;
  bg: string;
  border: string;
}

/** 정규/서브 프로젝트 공용 상태(ZIP ST, §9) — 2차: 정규 섹션에서 이미 쓰던
 * DESIGN_DDAY_TONE과 동일한 4색(예정 회색/진행 남색/보류 주황/완료 초록)을
 * 그대로 재사용해 AX 토큰으로 교체했다. 정규 섹션 렌더 결과는 값이
 * 같으므로 바뀌지 않는다.
 *  - PLANNED     → Tailwind neutral-500/neutral-100/neutral-200
 *  - IN_PROGRESS → navy-700/navy-50/navy-100(AX 고유 navy 스케일)
 *  - ON_HOLD     → Tailwind amber-700/amber-50/amber-200
 *  - DONE        → Tailwind green-700/green-50/green-200 */
export const DESIGN_STATUS: Record<ProgressStatus, DesignColorSet> = {
  PLANNED: { color: "#737373", bg: "#f5f5f5", border: "#e5e5e5" },
  IN_PROGRESS: { color: "#2c4a85", bg: "#f4f6fb", border: "#e8ecf5" },
  ON_HOLD: { color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  DONE: { color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
};

/** 세부 목표/공통 업무 항목 상태(ZIP IT — ST와 "예정" 회색이 미묘하게 다름,
 * 그 미묘한 차이는 유지하되 톤은 AX neutral 스케일 안에서 고른다).
 *  - WAITING → Tailwind neutral-400/neutral-50/neutral-200(PLANNED의
 *    neutral-500보다 한 단계 옅은 회색 — 원본의 "미묘하게 다름"을 보존)
 *  - DONE    → DESIGN_STATUS.DONE과 동일한 green-700/green-50/green-200
 *    (완료=초록 의미를 정규/서브/공통 전부 동일하게 유지) */
export const DESIGN_ITEM_STATUS: Record<ProgressItemStatus, DesignColorSet & { marker: string }> = {
  WAITING: { color: "#a3a3a3", bg: "#fafafa", border: "#e5e5e5", marker: "○" },
  DONE: { color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", marker: "●" },
};

/** D-day 배지 톤 — 핸드오프 §0 "프로토타입 인라인 스타일을 그대로 복사하지
 * 말고 기존 AX 컴포넌트/토큰으로 구현" 원칙에 따라, Design ZIP의 hex를
 * 그대로 옮기던 것을 AX 자체 팔레트(navy 스케일 + Tailwind 표준 색상)로
 * 교체했다(1차: 정규 프로젝트 섹션). 상태 의미(예정 회색/진행 남색/경과·
 * 지연 빨강/완료 초록/주의 주황)와 5단계 위계는 그대로 유지, 값만 AX
 * 토큰으로 바꿨다.
 *  - ok    → navy-700/navy-50/navy-100(AX 고유 navy 스케일)
 *  - late  → Tailwind red-700/red-50/red-200
 *  - soon  → Tailwind amber-700/amber-50/amber-200
 *  - done  → Tailwind green-700/green-50/green-200
 *  - none  → Tailwind neutral-500/neutral-100/neutral-200 */
export const DESIGN_DDAY_TONE = {
  late: { color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  soon: { color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  ok: { color: "#2c4a85", bg: "#f4f6fb", border: "#e8ecf5" },
  done: { color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  none: { color: "#737373", bg: "#f5f5f5", border: "#e5e5e5" },
} as const;

/** PW Stage Rail 색 — 마찬가지로 AX 토큰으로 교체(1차: 정규 프로젝트
 * 섹션). 위계(현재 단계 강조 > 지난 진행 단계 > 미진행)는 그대로 유지:
 *  - cur(현재 단계)  → navy-700(AX 고유 토큰, Design의 #2f4a8f와 사실상 동일)
 *  - done(지난 진행) → Tailwind blue-300(navy 스케일엔 중간 톤이 없어 표준
 *    파랑으로 대체 — cur/up과 명확히 구분되는 중간 채도 유지)
 *  - up(미진행)      → navy-100(AX 고유 토큰, Design의 #e4e8ef와 사실상 동일) */
export const DESIGN_STAGE_COLOR = { done: "#93c5fd", cur: "#2c4a85", up: "#e8ecf5" } as const;

/** 완료 업무 목록의 유형(정규/서브/공통) 태그 색(ZIP doneItems) — 3차: 각
 * 섹션의 정체성 색을 AX 팔레트에 없는 남색 외 계열은 Tailwind 표준
 * 팔레트에서 새로 골랐다(임의 hex 발명 금지 원칙에 따름).
 *  - 정규 → navy-700/navy-50/navy-100(AX 고유 navy, 기존 정규 정체성 유지)
 *  - 서브 → Tailwind violet-700/violet-50/violet-200(원본이 보라 계열이라
 *    AX 스케일에 없는 보라 중 Tailwind 표준 violet을 선택)
 *  - 공통 → Tailwind teal-700/teal-50/teal-200(원본이 초록-청록 계열이라
 *    "완료=초록"과 겹치지 않게 teal을 선택 — green은 이미 완료 의미로 씀) */
export const DESIGN_KIND_TAG = {
  정규: { color: "#2c4a85", bg: "#f4f6fb", border: "#e8ecf5" },
  서브: { color: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe" },
  공통: { color: "#0f766e", bg: "#f0fdfa", border: "#99f6e4" },
} as const;

/** 서브 프로젝트 진행률 바 색 / 공통 업무 진행률 바 색 — 위 DESIGN_KIND_TAG와
 * 같은 violet/teal 계열을 재사용하되, 바는 한 단계 더 채도 있는
 * violet-600/teal-600을, 옆의 % 텍스트는 KIND_TAG와 동일한
 * violet-700/teal-700을 써서 원본의 "바가 텍스트보다 살짝 밝다" 관계를
 * 유지한다. */
export const DESIGN_SUB_BAR_COLOR = "#7c3aed";
export const DESIGN_SUB_PCT_TEXT_COLOR = "#6d28d9";
export const DESIGN_COMMON_BAR_COLOR = "#0d9488";
export const DESIGN_COMMON_PCT_TEXT_COLOR = "#0f766e";

/** 서브 프로젝트 분기 배지(현재 분기 vs 그 외) — 서브 정체성 색(violet)을
 * 그대로 재사용. current는 violet-700 채움 + 흰 글자, other는
 * DESIGN_KIND_TAG.서브와 동일한 옅은 violet. */
export const DESIGN_QUARTER_BADGE = {
  current: { color: "#fff", bg: "#6d28d9", border: "#6d28d9" },
  other: { color: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe" },
} as const;

/** 공통 업무 "매월 N일" 반복 태그 — 공통 정체성 색(teal)을 DESIGN_KIND_TAG.
 * 공통과 동일하게 재사용. */
export const DESIGN_REPEAT_TAG = { color: "#0f766e", bg: "#f0fdfa", border: "#99f6e4" };
/** 반복 업무 기준일 경과 강조(핸드오프 §4.10) — "경과·지연"의 공통 의미색인
 * DESIGN_DDAY_TONE.late(red-700/red-50/red-200)와 완전히 동일한 값으로
 * 맞췄다(이전 차수에 남아 있던 사전 마이그레이션 hex를 정리). */
export const DESIGN_REPEAT_TAG_OVERDUE = { color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" };
/** "N월 이월" 태그 — DESIGN_STATUS.ON_HOLD/DESIGN_DDAY_TONE.soon과 동일한
 * amber(주의 의미)로 통일. */
export const DESIGN_CARRIED_TAG = { color: "#b45309", bg: "#fffbeb", border: "#fde68a" };
/** "이월" 액션 버튼 — DESIGN_STATUS.PLANNED/DESIGN_DDAY_TONE.none과 동일한
 * neutral(중립 액션)으로 통일. */
export const DESIGN_CARRY_BUTTON = { color: "#737373", bg: "#f5f5f5", border: "#e5e5e5" };

/** 담당자 Avatar 원형 배경/글자색 — 정규/서브/공통 3곳 모두 동일. 상태
 * 의미가 없는 순수 장식색이라 이번 교체 대상에서 제외(원본 값 유지). */
export const DESIGN_AVATAR = { bg: "#e4e9f2", color: "#4c5468" };

/** 필터 Pill(업무유형/담당자 공용 chip()) — 선택 상태는 navy-700 실 채움,
 * 비선택은 navy-100 테두리 + neutral-600 텍스트 + neutral-50 hover로 AX
 * 토큰 실제 유틸리티 클래스를 쓴다(값을 그대로 옮기지 않고 AX 컴포넌트
 * 팔레트로 전환). */
export function designChipClass(active: boolean): string {
  return active
    ? "inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-[12px] whitespace-nowrap border border-navy-700 bg-navy-700 text-white cursor-pointer"
    : "inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-[12px] whitespace-nowrap border border-navy-100 bg-white text-neutral-600 cursor-pointer hover:bg-neutral-50";
}

/** 업무유형 Pill 안의 count 소배지(countPill()) — 비선택 상태를
 * neutral-100/neutral-500으로 교체(선택 상태는 흰 반투명이라 별도 토큰
 * 없이 그대로 유지). */
export function designCountPillClass(active: boolean): string {
  return active
    ? "rounded-full px-1.5 text-[11px] font-semibold tabular-nums bg-white/20 text-white"
    : "rounded-full px-1.5 text-[11px] font-semibold tabular-nums bg-neutral-100 text-neutral-500";
}
