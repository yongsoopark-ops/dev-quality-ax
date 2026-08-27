/**
 * W2/W3/W4는 각각 고정 양식(Template)이고, 실제 값은 프로젝트마다 그 양식을
 * 복사한 서로 다른 Spreadsheet(Project Sheet Instance)에 들어간다. 그래서
 * Mapping은 특정 Spreadsheet ID/URL이 아니라 "Header 이름"을 기준으로 정의하고,
 * 실제 Spreadsheet는 Preview를 실행하는 시점에 사용자가 입력한다(영구 등록 없음).
 */

/** 이번 Step은 원본 값을 그대로 전달하는 DIRECT만 지원한다. */
export type TransformType = "DIRECT";

/** SINGLE: 값 하나. REPEATING: 검사 항목처럼 여러 Row가 반복되는 영역(이번 Step은 계산하지 않음). */
export type MappingKind = "SINGLE" | "REPEATING";

/** Template Definition — 코드에 중앙 관리되는 고정 Mapping Rule. */
export interface MappingRuleConfig {
  id: string;
  sourceHeader: string;
  targetHeader: string;
  required: boolean;
  transformType: TransformType;
  kind: MappingKind;
}

export type MappingStatus =
  | "READY"
  | "EMPTY_SOURCE"
  | "SOURCE_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  /** kind가 REPEATING인 Rule은 이번 Step에서 실제 계산을 지원하지 않는다. */
  | "NOT_SUPPORTED";

export interface MappingPreviewRow {
  mappingId: string;
  sourceHeader: string;
  sourceValue: string | null;
  targetHeader: string;
  status: MappingStatus;
  required: boolean;
  kind: MappingKind;
}

export interface MappingSummary {
  total: number;
  ready: number;
  /** Optional(required:false)인데 READY가 아닌 경우 — 확인 필요. */
  needsReview: number;
  /** Required인데 READY가 아닌 경우 — 오류. */
  errors: number;
}

/** Google Sheets에서 읽어온 Header 행 + 데이터 행. lib/googleSheets.ts의 getSheetValues와 동일한 모양. */
export interface SheetTable {
  headers: string[];
  rows: string[][];
}

/**
 * Preview 실행 시 사용자가 입력하는 "이번 프로젝트의 실제 Sheet 위치". 영구 저장하지
 * 않는다. W2/W3는 Header가 한 줄로 정렬된 Table이 아니라 Grid 전체를 훑어 Label/
 * 반복 Table 영역을 직접 찾으므로(sheetGridReader 참고) headerRow 개념이 없다.
 */
export interface ProjectSheetInput {
  url: string;
  sheetName: string;
}

/** REPEATING 영역(예: 검사 항목)의 한 행(예: 검사 순서 1건)에 대한 Mapping 결과 묶음. */
export interface RepeatingMappingGroup {
  /** 사람이 알아볼 수 있는 행 식별자(예: 검사 순서 값). 없으면 순번으로 대체된다. */
  rowKey: string;
  cells: MappingPreviewRow[];
}
