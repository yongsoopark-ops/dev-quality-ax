import type { ProgressItemStatus, ProgressStatus } from "@/app/generated/prisma/enums";

/**
 * 진행 현황(Progress Dashboard) — ZIP 디자인 레퍼런스("진행 현황 관리판
 * v2.dc.html")가 확정한 라벨/색상/규칙을 그대로 옮긴 상수 모음. 설비
 * 관리(lib/facility/constants.ts)와 동일한 원칙 — 디자인이 고정한 값은
 * 동적 계산 없이 그대로 하드코딩한다.
 */

/** PW1~PW8 — index는 0-based(0=PW1 ... 7=PW8). ZIP 분석 리포트 §2. */
export const PROGRESS_PW_STAGES = [
  "Kick Off",
  "품질검증설계",
  "품질 적합성 평가",
  "개선 효력 검증",
  "품질 승인",
  "품질 기준서 제정",
  "품질 일치성 평가",
  "품질 유효성 평가",
] as const;

export function pwStageLabel(index: number): string {
  return `PW${index + 1} ${PROGRESS_PW_STAGES[index]}`;
}

/** "샘플 확보" 날짜가 붙는 두 단계(0-based index) — ZIP §2: PW3→sample2,
 * PW4→sample3. */
export const PROGRESS_SAMPLE_STAGE_PW3_INDEX = 2;
export const PROGRESS_SAMPLE_STAGE_PW4_INDEX = 3;

/** 개선 차수 배지는 "현재 단계 === PW4(index 3)"일 때만 노출된다(ZIP
 * effRounds, §3). */
export const PROGRESS_ROUND_STAGE_INDEX = 3;

export const PROGRESS_STATUS_LABEL: Record<ProgressStatus, string> = {
  PLANNED: "예정",
  IN_PROGRESS: "진행중",
  ON_HOLD: "보류",
  DONE: "완료",
};

/** 세부 목표 상태 드롭다운(서브 프로젝트 폼 전용) 라벨 — 공통 업무는 이
 * 항목별 상태 드롭다운을 쓰지 않으므로 IN_PROGRESS를 추가해도 영향 없다. */
export const PROGRESS_ITEM_STATUS_LABEL: Record<ProgressItemStatus, string> = {
  WAITING: "예정",
  IN_PROGRESS: "진행중",
  DONE: "완료",
};

export const PROGRESS_TYPE_FILTERS = ["전체", "정규", "서브", "공통"] as const;
export type ProgressTypeFilter = (typeof PROGRESS_TYPE_FILTERS)[number];

export const PROGRESS_TYPE_PICK_OPTIONS = [
  { key: "regular" as const, label: "정규 프로젝트", description: "제품 개발 프로세스 PW1~PW8을 따르는 프로젝트" },
  { key: "sub" as const, label: "서브 프로젝트", description: "대상 분기 구간 안에서 순차 세부 목표로 진행하는 업무" },
  { key: "common" as const, label: "공통 업무", description: "담당자가 월별로 계획해 수행하는 업무" },
];

export const PROGRESS_REPEAT_DAY_OPTIONS = [...Array.from({ length: 31 }, (_, i) => String(i + 1)), "last"] as const;

export function repeatDayLabel(value: string): string {
  return value === "last" ? "말일" : `${value}일`;
}
