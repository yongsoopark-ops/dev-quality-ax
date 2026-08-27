import { buildApprovalTransferItems, scanApprovalArea } from "@/lib/sheetAutomation/w3ToW4/approvalTransferPlan";
import { buildBasicInfoTransferPlan } from "@/lib/sheetAutomation/w3ToW4/basicInfoTransferPlan";
import { buildDetailTransferPlan } from "@/lib/sheetAutomation/w3ToW4/detailTransferPlan";
import type { W3ToW4Plan } from "@/lib/sheetAutomation/w3ToW4/types";

export interface BuildW3ToW4PlanInput {
  spreadsheetId: string;
  spreadsheetTitle: string;
  w3SheetName: string;
  w4SheetName: string;
  w3SheetId: number;
  w4SheetId: number;
  w3Grid: string[][];
  w4Grid: string[][];
}

/**
 * W3→W4 자동이관 전체 계획을 계산하는 순수 함수 — Google API를 호출하지 않는다.
 * 실제 batchUpdate 실행은 executeW3ToW4Write에서만 한다.
 */
export function buildW3ToW4Plan(input: BuildW3ToW4PlanInput): W3ToW4Plan {
  const { spreadsheetId, spreadsheetTitle, w3SheetName, w4SheetName, w3SheetId, w4SheetId, w3Grid, w4Grid } = input;

  const w3Approval = scanApprovalArea(w3Grid);
  const w4Approval = scanApprovalArea(w4Grid);
  if (!w3Approval) throw new Error('W3에서 "■ 품질 승인 현황" 영역을 찾지 못했습니다.');
  if (!w4Approval) throw new Error('W4에서 "■ 품질 승인 현황" 영역을 찾지 못했습니다.');

  const { items: basicInfoItems } = buildBasicInfoTransferPlan(w3Grid, w4Grid);
  const { items: approvalItems, reviewFlags } = buildApprovalTransferItems(w3Approval, w4Approval);

  // 승인현황 이관 상태와 무관하게 "현재 W3에서 개선진행인 모든 항목"을 그대로
  // buildDetailTransferPlan에 넘긴다 — 그 함수 자체가 W4 상세영역 존재 여부를
  // 독립적으로 다시 확인하므로, 승인현황만 반영되고 상세 Block이 누락된 부분
  // 실패 상태에서도 재실행 시 상세 Block만 안전하게 보완할 수 있다(요청사항 13).
  const allTargets = approvalItems.map((i) => ({ inspectionOrder: i.inspectionOrder, testType: i.testType }));
  const { items: detailItems, sectionInserts: detailSectionInserts } = buildDetailTransferPlan(w3Grid, w4Grid, allTargets);

  const approvalRowsToFillBlank = approvalItems.filter((i) => i.status === "FILL_BLANK_ROW").length;
  const approvalRowsToInsert = approvalItems.filter((i) => i.status === "NEW_ROW").length;
  const detailBlocksToInsert = detailItems.filter((i) => i.status === "NEW_BLOCK" || i.status === "FILL_PLACEHOLDER").length;
  const basicInfoFieldsToFill = basicInfoItems.filter((i) => i.status === "FILL").length;
  const basicInfoFieldsProtected = basicInfoItems.filter((i) => i.status === "PROTECTED").length;
  const needsReview = detailItems.some((i) => i.status === "UNROUTABLE") || reviewFlags.length > 0;

  const alreadyUpToDate =
    basicInfoFieldsToFill === 0 &&
    approvalRowsToFillBlank === 0 &&
    approvalRowsToInsert === 0 &&
    detailBlocksToInsert === 0 &&
    !w4Approval.needsTrailingBlank;

  return {
    spreadsheetId,
    spreadsheetTitle,
    w3SheetName,
    w4SheetName,
    w3SheetId,
    w4SheetId,
    basicInfoItems,
    approvalItems,
    approvalInsertBeforeRowIndex: w4Approval.insertBeforeRowIndex,
    approvalNeedsTrailingBlank: w4Approval.needsTrailingBlank,
    approvalTemplateRowIndex: w4Approval.templateRowIndex,
    approvalHeaderValues: w4Approval.headerValues,
    detailItems,
    detailSectionInserts,
    reviewFlags,
    summary: {
      totalImprovementItems: approvalItems.length,
      approvalRowsToFillBlank,
      approvalRowsToInsert,
      detailBlocksToInsert,
      alreadyTransferredApprovalCount: approvalItems.filter((i) => i.status === "ALREADY_IN_W4").length,
      alreadyTransferredDetailCount: detailItems.filter((i) => i.status === "ALREADY_IN_W4").length,
      reviewFlagCount: reviewFlags.length,
      basicInfoFieldsToFill,
      basicInfoFieldsProtected,
    },
    status: needsReview ? "NEEDS_REVIEW" : "READY",
    alreadyUpToDate,
  };
}
