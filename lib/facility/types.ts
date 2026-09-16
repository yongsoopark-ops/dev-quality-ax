import type { EquipmentGrade, EquipmentKind, EquipmentLocation, EquipmentStatus, EquipmentTeamLabel, EquipmentTimeHalf, EquipmentUsagePurpose } from "@/app/generated/prisma/enums";

/** "담당자" 선택지 — 실제 User(파트원 4명)이거나 팀 placeholder 둘 중 하나.
 * value는 Server Action에 그대로 넘기는 안정적 문자열 키다. */
export type FacilityAssigneeOption = { kind: "USER"; userId: string; name: string } | { kind: "TEAM"; team: EquipmentTeamLabel; name: string };

export interface EquipmentRow {
  id: string;
  kind: EquipmentKind;
  name: string;
  location: EquipmentLocation;
  grade: EquipmentGrade;
  status: EquipmentStatus;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedTeamLabel: EquipmentTeamLabel | null;
  currentStart: string | null; // "2026.09.09" — Client Component는 Date를 직렬화할 수 없어 문자열로 넘긴다.
  currentEnd: string | null;
  currentHalf: EquipmentTimeHalf | null;
  currentFaultNote: string | null;
  /** 최신 예약의 저장된 입력값 — 수정 다이얼로그 프리필, 등급 '하'는 항상 null. */
  lastReservationDetail: {
    purpose: EquipmentUsagePurpose | null;
    cycles: number | null;
    hours: number | null;
    sampleCount: number | null;
  } | null;
  /** 등급 '하' 설비의 누적 시료 건수(가장 최근 수동 등록 값 존재 여부 판단용) — null이면 아직 등록된 적 없음. */
  manualSampleCount: number | null;
}

export interface FacilityReservationEvent {
  id: string;
  equipmentId: string;
  equipmentName: string;
  equipmentStatus: EquipmentStatus;
  start: string; // "2026.09.09"
  end: string;
  half: EquipmentTimeHalf;
  noteLabel: string;
  /** 실제 담당자(파트원) 이름. 개발 1/2팀 배정이거나 담당자 미지정이면 null —
   * 둘을 구분해야(팀은 항상 숨김, 미지정은 "미지정" 레인에 표시) 하므로
   * isTeamAssigned로 따로 구분한다. */
  assigneeName: string | null;
  /** true면 개발 1/2팀에 배정된 예약이다 — 캘린더 레인에 절대 그리지 않는다
   * (README: "개발 1팀·2팀 레인은 항상 회색 빈 행"). false인데 assigneeName도
   * null이면 "담당자 미지정" 상태로, 별도 "미지정" 레인에 표시한다. */
  isTeamAssigned: boolean;
}

export interface FacilityStatRow {
  id: string;
  name: string;
  grade: EquipmentGrade;
  metricLabel: string;
  unit: string;
  cur: number;
  prevMonth: number;
  quarterCumulative: number;
  yearCumulative: number;
}
