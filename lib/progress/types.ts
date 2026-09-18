import type { ProgressItemStatus, ProgressStatus } from "@/app/generated/prisma/enums";

/** 담당자 Select 옵션 — lib/facility/queries.ts의 FacilityAssigneeOption과
 * 동일한 이유로 실제 User만 담는다(ZIP처럼 이름 문자열 고정 배열이 아님). */
export interface ProgressAssigneeOption {
  userId: string;
  name: string;
}

export interface ProgressUpdateLogRow {
  id: string;
  authorName: string;
  content: string;
  createdAt: string; // "YYYY-MM-DD"
}

export interface ProgressRegularProjectRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  status: ProgressStatus;
  stageRunIndexes: number[];
  stageSkipIndexes: number[];
  kickoffDate: string; // "YYYY-MM-DD" | ""
  targetReleaseDate: string;
  actualReleaseDate: string;
  samplePw3Date: string;
  samplePw4Date: string;
  artifactUrl: string;
  improvementRounds: number;
  updateLogs: ProgressUpdateLogRow[];
}

export interface ProgressSubProjectItemRow {
  id: string;
  text: string;
  quarterYear: number;
  quarterNum: number;
  status: ProgressItemStatus;
  order: number;
}

export interface ProgressSubProjectRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  status: ProgressStatus;
  quarterStartYear: number;
  quarterStartQ: number;
  quarterEndYear: number;
  quarterEndQ: number;
  sheetUrl: string;
  items: ProgressSubProjectItemRow[];
}

export interface ProgressCommonTaskItemRow {
  id: string;
  monthYear: number;
  monthNum: number;
  status: ProgressItemStatus;
  carriedFromYear: number | null;
  carriedFromMonth: number | null;
}

export interface ProgressCommonTaskRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  repeat: boolean;
  repeatDay: string;
  monthStartYear: number;
  monthStartNum: number;
  monthEndYear: number;
  monthEndNum: number;
  items: ProgressCommonTaskItemRow[];
}
