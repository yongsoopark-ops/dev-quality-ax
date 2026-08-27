import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { isBlankRow, isSectionBoundary } from "@/lib/sheetAutomation/sheetGridReader";
import { isImprovementTransferTarget } from "@/lib/sheetAutomation/w3ToW4/types";
import type { ApprovalTransferItem, ReviewFlag } from "@/lib/sheetAutomation/w3ToW4/types";

const APPROVAL_STATUS_TITLE = "■ 품질 승인 현황";

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

export interface ApprovalAreaInfo {
  headerRowIndex: number;
  headerValues: string[];
  /** 실제 값이 있는(검사 순서가 채워진) 행만. */
  dataRows: { rowIndex: number; values: string[]; order: string }[];
  /** 신규 행 삽입 위치(Trailing Blank 제외). */
  insertBeforeRowIndex: number;
  needsTrailingBlank: boolean;
  /** 서식 복제용 정상 행 1개 — 값이 있는 행이 있으면 그중 첫 번째, 없으면 빈 행 중 첫 번째. */
  templateRowIndex: number | null;
  /** 이미 존재하는 빈 Data Row(요청사항 8 "기존 빈 행 우선 사용" 재사용 대상). */
  availableBlankRowIndexes: number[];
}

/**
 * W2→W3의 approvalStatus.ts와 같은 원리(Trailing Blank는 항목 사이에 넣지 않고
 * 마지막 뒤에만 둔다)로 「품질 승인 현황」 영역을 읽는다. W3(Source)/W4(Target)
 * 양쪽 모두 이 함수로 읽을 수 있다 — 둘 다 같은 Header 구조이기 때문이다.
 */
export function scanApprovalArea(grid: string[][]): ApprovalAreaInfo | null {
  const titleRowIndex = grid.findIndex((row) => (row.find((c) => c && c.trim() !== "") ?? "").trim() === APPROVAL_STATUS_TITLE);
  if (titleRowIndex === -1) return null;

  const headerRowIndex = titleRowIndex + 1;
  const headerValues = grid[headerRowIndex] ?? [];

  let nextTitleRowIndex = grid.length;
  for (let r = headerRowIndex + 1; r < grid.length; r++) {
    if (isSectionBoundary(grid[r] ?? [])) {
      nextTitleRowIndex = r;
      break;
    }
  }

  const hasExistingTrailingBlank = nextTitleRowIndex > headerRowIndex + 1 && isBlankRow(grid[nextTitleRowIndex - 1] ?? []);
  const dataAreaEnd = hasExistingTrailingBlank ? nextTitleRowIndex - 1 : nextTitleRowIndex;

  const orderCol = findColumnIndex(headerValues, "검사 순서");
  const dataRows: { rowIndex: number; values: string[]; order: string }[] = [];
  const blankRowIndexes: number[] = [];

  for (let r = headerRowIndex + 1; r < dataAreaEnd; r++) {
    const row = grid[r] ?? [];
    const order = orderCol !== -1 ? (row[orderCol] ?? "").trim() : "";
    if (order !== "") {
      dataRows.push({ rowIndex: r, values: row, order });
    } else {
      blankRowIndexes.push(r);
    }
  }

  const templateRowIndex = dataRows[0]?.rowIndex ?? blankRowIndexes[0] ?? null;

  return {
    headerRowIndex,
    headerValues,
    dataRows,
    insertBeforeRowIndex: dataAreaEnd,
    needsTrailingBlank: !hasExistingTrailingBlank,
    templateRowIndex,
    availableBlankRowIndexes: blankRowIndexes,
  };
}

export interface ApprovalTransferPlanResult {
  items: ApprovalTransferItem[];
  reviewFlags: ReviewFlag[];
}

/**
 * W3 「품질 승인 현황」에서 조치 방향=개선진행인 행만 선별하고(요청사항 1), W4에
 * 이미 이관된(검사 순서가 이미 존재하는) 항목은 건드리지 않는다(재실행 안전성).
 * 이전에 이관됐던 항목이 지금은 개선진행이 아니면 삭제하지 않고 확인 필요로만
 * 표시한다(요청사항 2 — 보수적 재실행 정책).
 */
export function buildApprovalTransferItems(w3Approval: ApprovalAreaInfo, w4Approval: ApprovalAreaInfo): ApprovalTransferPlanResult {
  const actionCol = findColumnIndex(w3Approval.headerValues, "조치 방향");
  const testTypeCol = findColumnIndex(w3Approval.headerValues, "시험 종류");
  const w4RowByOrder = new Map(w4Approval.dataRows.map((r) => [r.order, r]));

  const items: ApprovalTransferItem[] = [];
  const reviewFlags: ReviewFlag[] = [];
  let blankQueueIdx = 0;

  for (const row of w3Approval.dataRows) {
    const actionDirection = actionCol !== -1 ? (row.values[actionCol] ?? "").trim() : "";
    const testType = testTypeCol !== -1 ? (row.values[testTypeCol] ?? "").trim() : "";
    const isTarget = isImprovementTransferTarget(actionDirection);
    const existingW4Row = w4RowByOrder.get(row.order);

    if (isTarget) {
      let status: ApprovalTransferItem["status"];
      let targetRowIndex: number | null;
      if (existingW4Row) {
        status = "ALREADY_IN_W4";
        targetRowIndex = existingW4Row.rowIndex;
      } else if (blankQueueIdx < w4Approval.availableBlankRowIndexes.length) {
        status = "FILL_BLANK_ROW";
        targetRowIndex = w4Approval.availableBlankRowIndexes[blankQueueIdx];
        blankQueueIdx += 1;
      } else {
        status = "NEW_ROW";
        targetRowIndex = null;
      }
      items.push({ inspectionOrder: row.order, testType, actionDirection, sourceRowIndex: row.rowIndex, status, targetRowIndex });
    } else if (existingW4Row) {
      reviewFlags.push({
        inspectionOrder: row.order,
        reason: `검사 순서 ${row.order}는 이전에 W4로 이관되었지만 W3 조치 방향이 "${actionDirection || "(비어 있음)"}"(으)로 바뀌었습니다. 기존 W4 Block은 삭제/수정하지 않았습니다 — 확인이 필요합니다.`,
      });
    }
  }

  return { items, reviewFlags };
}
