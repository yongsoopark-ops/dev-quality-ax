import { isBlankRow } from "@/lib/sheetAutomation/sheetGridReader";
import type { SheetTable } from "@/lib/sheetAutomation/types";
import { buildApprovalStatusPlan } from "@/lib/sheetAutomation/write/approvalStatus";
import { buildBasicInfoPlan } from "@/lib/sheetAutomation/write/basicInfo";
import { buildDetailSectionsPlan } from "@/lib/sheetAutomation/write/detailSections";
import type { DetailSectionPlan, WritePlan } from "@/lib/sheetAutomation/write/types";

/**
 * 상세 검사영역 Spacer 복제용 "실제로 완전히 빈 행"을 문서 안에서 찾는다(요청사항 5) —
 * 각 Section 자신의 Data Row 바로 다음 행이 그 Section 경계 안에 있고 실제로
 * 비어 있으면 후보로 쓴다. 신뢰성처럼 원래 Spacer가 없는 Section은 자연히
 * 건너뛴다(다음 행이 이미 다음 Section 경계 밖이라 조건을 만족하지 못함).
 */
function findSpacerTemplateRowIndex(w3Grid: string[][], detailSections: DetailSectionPlan[]): number | null {
  for (const section of detailSections) {
    const candidate = section.templateDataRowIndex + 1;
    if (candidate < section.insertBeforeRowIndex && isBlankRow(w3Grid[candidate] ?? [])) {
      return candidate;
    }
  }
  return null;
}

export interface BuildWritePlanInput {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  sheetId: number;
  w2Grid: string[][];
  w3Grid: string[][];
  w2RepeatingTable: SheetTable;
}

/**
 * W3 자동화 규칙(상단 기본정보 + 품질 승인 현황 + 상세 검사영역) 전체를 계산하는
 * 순수 함수 — Google API를 호출하지 않는다. 실제 batchUpdate 실행은
 * executeW2ToW3Write에서만 한다.
 */
export function buildW2ToW3WritePlan(input: BuildWritePlanInput): WritePlan {
  const { spreadsheetId, spreadsheetTitle, sheetName, sheetId, w2Grid, w3Grid, w2RepeatingTable } = input;

  const basicInfo = buildBasicInfoPlan(w2Grid, w3Grid);
  const approvalStatus = buildApprovalStatusPlan(w3Grid, w2RepeatingTable);
  if (!approvalStatus) {
    throw new Error('W3에서 "■ 품질 승인 현황" 영역을 찾지 못했습니다.');
  }
  const { sections: detailSections, items: detailItems } = buildDetailSectionsPlan(w3Grid, w2RepeatingTable);
  const spacerTemplateRowIndex = findSpacerTemplateRowIndex(w3Grid, detailSections);

  const warnings: string[] = [];
  for (const s of approvalStatus.orphanedOrders) {
    warnings.push(`"■ 품질 승인 현황"에 현재 W2 계획에 없는 검사 순서(${s})의 기존 행이 있습니다. 자동으로 삭제하지 않습니다.`);
  }
  for (const s of detailSections) {
    for (const order of s.orphanedOrders) {
      warnings.push(`"${s.sectionName}" Section에 현재 W2 계획에 없는 검사 순서(${order})의 기존 Block이 있습니다. 자동으로 삭제하지 않습니다.`);
    }
    if (s.requiresReviewForInsert) {
      warnings.push(`"${s.sectionName}" Section은 이미 실행된 이력이 있는데 신규 항목이 추가되어 확인이 필요합니다.`);
    }
  }
  for (const item of detailItems) {
    if (item.note) warnings.push(item.note);
  }

  const detailCellsToWrite = detailItems.filter(
    (i) => i.status === "MATCHED_UPDATE" || i.status === "FILL_BLANK_SLOT" || i.status === "NEW_BLOCK",
  ).length;
  const detailValuesProtected = detailItems.filter((i) => i.status === "MATCHED_NO_CHANGE").length;
  const detailBlocksToInsert = detailSections.reduce((sum, s) => sum + s.blocksToInsert, 0);
  const needsReview = detailItems.some((i) => i.status === "NEEDS_REVIEW" || i.status === "UNROUTABLE");

  const approvalRowsPlanned = approvalStatus.rows.filter(
    (r) => r.status === "MATCHED_UPDATE" || r.status === "FILL_BLANK_ROW" || r.status === "NEW_ROW",
  ).length;

  const alreadyUpToDate =
    detailBlocksToInsert === 0 &&
    detailCellsToWrite === 0 &&
    approvalStatus.rowsToInsert === 0 &&
    approvalRowsPlanned === 0 &&
    !approvalStatus.needsTrailingBlank;

  return {
    spreadsheetId,
    spreadsheetTitle,
    sheetName,
    sheetId,
    basicInfo,
    approvalStatus,
    detailSections,
    detailItems,
    spacerTemplateRowIndex,
    summary: {
      totalW2Items: w2RepeatingTable.rows.length,
      basicInfoFieldCount: basicInfo.fields.length,
      approvalRowsPlanned,
      approvalRowsToInsert: approvalStatus.rowsToInsert,
      detailBlocksToInsert,
      detailCellsToWrite,
      detailValuesProtected,
      warnings: warnings.length,
    },
    warnings,
    status: needsReview ? "NEEDS_REVIEW" : "READY",
    alreadyUpToDate,
  };
}
