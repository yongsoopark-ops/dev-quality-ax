/**
 * W3 자동화 규칙(W3 자동화 규칙.md)에 따른 Write Engine 타입. 이 규칙은 세 영역을
 * 각각 다르게 다룬다:
 *  - 상단 기본정보: Label(2칸 오른쪽 Value) Form, 항상 최신 W2 값으로 덮어쓴다.
 *  - 품질 승인 현황: Header 1개 + 반복 Data Row(Header/Spacer 없음, 필요한 만큼만 추가).
 *  - 상세 검사영역(■ 섹션): 검사 항목 1개당 Header+Data+Spacer 3행 1묶음이 반복된다.
 * 세 영역 모두 "검사 순서"를 항목 식별 키로 써서 재실행 시 중복 생성을 막는다.
 */

export const INSPECTION_BLOCK_HEADER_SIGNATURE = [
  "순",
  "판정 일자",
  "검사 항목",
  "검사 중요도",
  "판정 기준",
  "종합 판정",
  "이슈 증상",
] as const;

/** 상세 검사영역에서 자동 입력하는 4개 필드만 갱신 대상이다(요청사항 8/29-10). */
export const DETAIL_WRITABLE_HEADERS = ["순", "검사 항목", "검사 중요도", "판정 기준"] as const;

/** 절대 덮어쓰지 않는 담당자 작성 영역(요청사항 12). */
export const PROTECTED_DETAIL_HEADERS = ["판정 일자", "종합 판정", "이슈 증상"] as const;

/** "■ 품질 승인 현황"의 담당자 작성 영역 — 신규 행이 Template Source를 복제할 때
 * 함께 복사돼 온 값을 명시적으로 비우기 위한 목록(요청사항 9와 동일한 보호 원칙). */
export const PROTECTED_APPROVAL_HEADERS = ["종합 판정", "판정 사유", "조치 방향", "조치 사항"] as const;

// ---------------- 상단 기본정보 ----------------

export interface BasicInfoFieldPlan {
  label: string;
  value: string;
  /** W3 Value Cell의 실제 위치(0-based). Label 칸의 2칸 오른쪽. */
  targetRow: number;
  targetCol: number;
  /** true면 W2 값이 아니라 규칙에 정의된 고정값(예: 샘플 차수="1차")이다. */
  isFixed: boolean;
}

export interface BasicInfoPlan {
  fields: BasicInfoFieldPlan[];
}

// ---------------- 품질 승인 현황 ----------------

export type ApprovalRowStatus = "MATCHED_NO_CHANGE" | "MATCHED_UPDATE" | "FILL_BLANK_ROW" | "NEW_ROW";

export interface ApprovalStatusRowPlan {
  w2RowIndex: number;
  inspectionOrder: string;
  /** targetColumn(0-based)별 입력값. */
  cells: { targetCol: number; value: string }[];
  /** 재사용하는 기존 행의 실제 Row Index. NEW_ROW면 Phase 실행 후에만 정해진다. */
  targetRowIndex: number | null;
  status: ApprovalRowStatus;
}

export interface ApprovalStatusPlan {
  headerRowIndex: number;
  /** 다음 Section Title 바로 앞 — 신규 행 삽입 위치. */
  insertBeforeRowIndex: number;
  /** 현재 Header 아래 ~ 다음 Section 사이에 이미 존재하는 Data Row 수(빈 행 포함). */
  existingRowCapacity: number;
  rowsToInsert: number;
  /** 마지막 검사 항목 뒤에 구분용 빈 행이 아직 없으면 true — 이 경우 rowsToInsert
   * 뒤에 빈 행 1개를 추가로 삽입해야 한다(항목 사이에는 절대 넣지 않는다). */
  needsTrailingBlank: boolean;
  rows: ApprovalStatusRowPlan[];
  /** 현재 W2 목록에 없는 검사 순서를 가진, 이미 채워진 기존 행(구조적 변경 후보). */
  orphanedOrders: string[];
  /** 신규 행 삽입 시 서식/구조를 복제할 기존 정상 Data Row(Header 아님) 위치. */
  templateRowIndex: number | null;
  /** Header Row의 실제 값 — 담당자 작성 영역 Column 위치 계산에 재사용한다. */
  headerValues: string[];
}

// ---------------- 상세 검사영역 ----------------

export type DetailBlockStatus =
  | "MATCHED_NO_CHANGE"
  | "MATCHED_UPDATE"
  | "FILL_BLANK_SLOT"
  | "NEW_BLOCK"
  | "NEEDS_REVIEW"
  | "UNROUTABLE";

export interface DetailSlot {
  headerRowIndex: number;
  dataRowIndex: number;
  spacerRowIndex: number;
  /** 이 슬롯 Data Row에 이미 들어 있는 "순" 값. 빈 슬롯이면 "". */
  existingOrder: string;
}

export interface DetailBlockItem {
  w2RowIndex: number;
  inspectionOrder: string;
  inspectionItem: string;
  importance: string;
  criteria: string;
  testType: string;
  targetSection: string | null;
  /** 값을 쓸 실제 위치. NEW_BLOCK은 Phase 실행 후에만 정해진다. */
  targetSlot: { headerRowIndex: number; dataRowIndex: number } | null;
  status: DetailBlockStatus;
  note: string | null;
}

export interface DetailSectionPlan {
  sectionName: string;
  /** 이 Section 자신의 첫 슬롯 — 새 슬롯을 만들 때 Header+Data를 복제할 Format Source. */
  templateHeaderRowIndex: number;
  templateDataRowIndex: number;
  /** Template Header Row의 실제 값 — 복제된 새 슬롯도 이 내용을 그대로 가지므로 재조회 없이 Column 위치 계산에 재사용한다. */
  templateHeaderValues: string[];
  existingSlotCount: number;
  requiredSlotCount: number;
  blocksToInsert: number;
  insertBeforeRowIndex: number;
  /** 이미 자동화가 한 번이라도 지나간 흔적(순 값이 있는 슬롯)이 있는데 항목이 더
   * 늘어나 삽입이 필요한 경우 — 조용히 삽입하지 않고 NEEDS_REVIEW로 돌린다(요청사항 13/14). */
  requiresReviewForInsert: boolean;
  /** insertBeforeRowIndex 바로 앞 행이 이미 빈 행이 아니면(기존 Template이 마지막
   * 슬롯 뒤에 Spacer를 안 두고 곧장 다음 Section Title로 이어지는 경우), 새 Block을
   * 삽입하기 전에 빈 행을 1개 더 만들어야 기존 마지막 항목과 새 Block 사이에
   * Spacer가 생긴다. */
  needsLeadingSpacer: boolean;
  orphanedOrders: string[];
}

// ---------------- Plan 전체 ----------------

export interface WritePlanSummary {
  totalW2Items: number;
  basicInfoFieldCount: number;
  approvalRowsPlanned: number;
  approvalRowsToInsert: number;
  detailBlocksToInsert: number;
  detailCellsToWrite: number;
  detailValuesProtected: number;
  warnings: number;
}

export type WritePlanStatus = "READY" | "NEEDS_REVIEW";

export interface WritePlan {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  sheetId: number;
  basicInfo: BasicInfoPlan;
  approvalStatus: ApprovalStatusPlan;
  detailSections: DetailSectionPlan[];
  detailItems: DetailBlockItem[];
  /** 상세 검사영역 Spacer(완전 빈 흰색 행) 복제용 Template Source 위치. 문서 안에서
   * 실제로 비어 있는 행을 찾지 못하면 null이고, 그 경우 실행 시 서식을 명시적으로
   * 초기화하는 방식으로 대체한다. */
  spacerTemplateRowIndex: number | null;
  summary: WritePlanSummary;
  warnings: string[];
  status: WritePlanStatus;
  alreadyUpToDate: boolean;
}

// ---------------- 실행 결과 ----------------

export interface WriteExecutionResult {
  phase1BasicInfo: boolean;
  phase2ApprovalStatus: boolean;
  phase3DetailStructure: boolean;
  phase4DetailValues: boolean;
  phase5Validated: boolean;
  approvalRowsInserted: number;
  detailBlocksInserted: number;
  cellsWritten: number;
  valuesProtected: number;
  error: string | null;
}

export interface WriteValidationResult {
  ok: boolean;
  issues: string[];
}
