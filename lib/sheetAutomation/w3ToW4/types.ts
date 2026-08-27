/**
 * W3(품질 적합성 평가 보고서) → W4(개선 효력 검증 보고서) 자동이관.
 *
 * W2→W3와 근본적으로 다른 점: W2→W3는 "값을 어느 필드에 넣을지" 매핑하는 작업이지만,
 * 이번엔 "이미 완성된 행/Block을 통째로 복제"하는 작업이다 — 값을 재가공하지 않고
 * Cell 서식·병합·행 높이까지 그대로 옮긴다. 그래서 Plan/실행 구조도 필드 매핑이 아니라
 * "이 Row Range를 저 위치로 복제한다"는 단위로 설계했다.
 *
 * 이 폴더는 기존 lib/sheetAutomation/write(W2→W3)를 전혀 수정하지 않고, 필요한
 * 부분(sectionRouting.ts의 resolveTargetSection 등)만 그대로 import해서 재사용한다.
 */

import type { BasicInfoTransferItem } from "@/lib/sheetAutomation/w3ToW4/basicInfoTransferPlan";
export type { BasicInfoTransferItem, BasicInfoTransferStatus } from "@/lib/sheetAutomation/w3ToW4/basicInfoTransferPlan";

/** 이관 대상 판별 조건 — 향후 조치 방향 정책이 바뀔 수 있으므로 별도 함수로 분리한다. */
export const IMPROVEMENT_ACTION_VALUE = "개선진행";
export function isImprovementTransferTarget(actionDirection: string): boolean {
  return actionDirection.trim() === IMPROVEMENT_ACTION_VALUE;
}

/** FILL_BLANK_ROW = W4에 이미 있는 빈 행을 채운다(요청사항 8 "기존 빈 행 우선
 * 사용" 재사용). NEW_ROW = 빈 행이 부족해 새로 삽입해야 한다. */
export type ApprovalTransferStatus = "ALREADY_IN_W4" | "FILL_BLANK_ROW" | "NEW_ROW";

/** W3 「품질 승인 현황」에서 이관 대상으로 선정된 한 행. */
export interface ApprovalTransferItem {
  inspectionOrder: string;
  testType: string;
  actionDirection: string;
  /** W3 안에서의 실제 행 위치 — copyPaste Source로 그대로 쓴다. */
  sourceRowIndex: number;
  status: ApprovalTransferStatus;
  /** ALREADY_IN_W4/FILL_BLANK_ROW면 기존 위치, NEW_ROW면 실행 후에만 정해진다. */
  targetRowIndex: number | null;
}

/** FILL_PLACEHOLDER = 아직 사용되지 않은 pristine Header+Data Row를 그대로
 * 재사용한다(불필요한 빈 Block 잔존 방지). NEW_BLOCK = 그 외 신규 삽입. */
export type DetailTransferStatus = "ALREADY_IN_W4" | "FILL_PLACEHOLDER" | "NEW_BLOCK" | "UNROUTABLE";

/** W3 하단 상세 검사 결과 Block(가변 높이) 1개의 이관 계획. */
export interface DetailTransferItem {
  inspectionOrder: string;
  testType: string;
  targetSection: string | null;
  /** W3 안에서의 실제 Block 범위 — copyPaste Source. */
  sourceHeaderRowIndex: number;
  /** 배타적(exclusive) 끝 — 다음 고정행 또는 다음 Section Title 위치. */
  sourceEndRowIndexExclusive: number;
  status: DetailTransferStatus;
  note: string | null;
}

export interface DetailBlockToInsert {
  inspectionOrder: string;
  sourceHeaderRowIndex: number;
  sourceEndRowIndexExclusive: number;
  height: number;
}

/** 이 Section이 아직 pristine 상태여서, 첫 이관 Block이 기존 Header+Data Row를
 * 그대로 재사용할 수 있는 경우의 정보. */
export interface PlaceholderReuseInfo {
  inspectionOrder: string;
  sourceHeaderRowIndex: number;
  sourceEndRowIndexExclusive: number;
  sourceHeight: number;
  /** 재사용할 기존 W4 Header/Data Row 위치. */
  targetHeaderRowIndex: number;
  /** 기존 placeholder의 전체 높이(보통 Header+Data(+빈 행)). */
  placeholderHeight: number;
}

/** W4 한 Section에 새로 삽입해야 할 Block들 — 검사 순서대로 정렬돼 있다. */
export interface DetailSectionInsertPlan {
  sectionName: string;
  /** W4 안에서 삽입할 위치(원본 좌표, 다음 Section Title 직전). placeholder를
   * 재사용하고 그 안에 다 들어가면(sourceHeight <= placeholderHeight) 이 값 그대로,
   * 넘치면(sourceHeight > placeholderHeight) 그 초과분만큼 이 위치부터 추가 삽입한다. */
  insertBeforeRowIndex: number;
  /** 이 Section이 pristine이어서 첫 항목이 재사용할 대상 — 없으면 null. */
  reusePlaceholder: PlaceholderReuseInfo | null;
  /** reusePlaceholder 이후(또는 재사용 대상이 없으면 전부)의 신규 삽입 Block들. */
  blocks: DetailBlockToInsert[];
}

export interface ReviewFlag {
  inspectionOrder: string;
  reason: string;
}

export interface W3ToW4PlanSummary {
  totalImprovementItems: number;
  approvalRowsToFillBlank: number;
  approvalRowsToInsert: number;
  detailBlocksToInsert: number;
  alreadyTransferredApprovalCount: number;
  alreadyTransferredDetailCount: number;
  reviewFlagCount: number;
  /** 상단 기본정보 중 이번에 새로 채울 건수(FILL 상태만) — 재실행 시 alreadyUpToDate 판단에 쓴다. */
  basicInfoFieldsToFill: number;
  /** 이미 W4에 값이 있어 덮어쓰지 않고 건너뛴 건수. */
  basicInfoFieldsProtected: number;
}

export interface W3ToW4Plan {
  spreadsheetId: string;
  spreadsheetTitle: string;
  w3SheetName: string;
  w4SheetName: string;
  w3SheetId: number;
  w4SheetId: number;

  /** 상단 기본정보 이관 계획 — FILL 상태만 실제로 쓰여진다. */
  basicInfoItems: BasicInfoTransferItem[];

  approvalItems: ApprovalTransferItem[];
  approvalInsertBeforeRowIndex: number;
  approvalNeedsTrailingBlank: boolean;
  /** W4 안에 이미 존재하는(비어 있지 않은) 정상 행 1개 — 신규 행 서식 복제 Source. 없으면 null. */
  approvalTemplateRowIndex: number | null;
  approvalHeaderValues: string[];

  detailItems: DetailTransferItem[];
  detailSectionInserts: DetailSectionInsertPlan[];

  /** 개선진행 → 다른 조치 방향으로 바뀐 기존 이관 항목 — 자동 삭제하지 않고 확인만 요청한다. */
  reviewFlags: ReviewFlag[];

  summary: W3ToW4PlanSummary;
  status: "READY" | "NEEDS_REVIEW";
  alreadyUpToDate: boolean;
}

export interface W3ToW4ExecutionResult {
  approvalRowsInserted: number;
  detailBlocksInserted: number;
  totalRowsCopied: number;
  error: string | null;
}

/**
 * COMPLETE = 승인현황 + 상세 Block 모두 존재. MISSING_APPROVAL = 상세는 있는데
 * 승인현황이 없음. MISSING_DETAIL = 승인현황은 있는데 상세 Block이 없음.
 * MISMATCH = 검사 순서는 있는데 검사 항목명이 W3와 다르다(보조 검증 실패).
 */
export type ItemValidationStatus = "COMPLETE" | "MISSING_APPROVAL" | "MISSING_DETAIL" | "MISMATCH";

export interface ItemValidationResult {
  inspectionOrder: string;
  status: ItemValidationStatus;
  detail: string | null;
}

export interface W3ToW4ValidationResult {
  ok: boolean;
  issues: string[];
  items: ItemValidationResult[];
}
