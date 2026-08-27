import { getRawGridValues, getSpreadsheetMetadata } from "@/lib/googleSheets";
import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { resolveTargetSection } from "@/lib/sheetAutomation/write/sectionRouting";
import { scanApprovalArea } from "@/lib/sheetAutomation/w3ToW4/approvalTransferPlan";
import { scanVariableHeightSections } from "@/lib/sheetAutomation/w3ToW4/detailBlockScan";
import { isImprovementTransferTarget } from "@/lib/sheetAutomation/w3ToW4/types";
import type { ItemValidationResult, W3ToW4ValidationResult } from "@/lib/sheetAutomation/w3ToW4/types";

const W3_SHEET_NAME = "PW3";
const W4_SHEET_NAME = "PW4";

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

/**
 * 승인현황 이관 여부와 상세 Block 이관 여부를 서로 완전히 독립적으로 다시 확인한다
 * (요청사항 8/9) — 승인현황이 ALREADY_IN_W4라고 해서 상세 Block도 있다고 가정하지
 * 않는다. Plan을 재사용하지 않고 이 함수 자체가 W3/W4를 처음부터 다시 스캔한다.
 */
export async function validateW3ToW4Result(spreadsheetId: string): Promise<W3ToW4ValidationResult> {
  const issues: string[] = [];

  let w3Grid: string[][];
  let w4Grid: string[][];
  try {
    const [, gridW3, gridW4] = await Promise.all([
      getSpreadsheetMetadata(spreadsheetId),
      getRawGridValues(spreadsheetId, W3_SHEET_NAME),
      getRawGridValues(spreadsheetId, W4_SHEET_NAME),
    ]);
    w3Grid = gridW3;
    w4Grid = gridW4;
  } catch (err) {
    return { ok: false, issues: [`재검증: Sheet를 다시 읽는 중 오류 — ${err instanceof Error ? err.message : "알 수 없는 오류"}`], items: [] };
  }

  const w3Approval = scanApprovalArea(w3Grid);
  const w4Approval = scanApprovalArea(w4Grid);
  if (!w3Approval) return { ok: false, issues: ['재검증: W3에서 "■ 품질 승인 현황" 영역을 찾지 못했습니다.'], items: [] };
  if (!w4Approval) return { ok: false, issues: ['재검증: W4에서 "■ 품질 승인 현황" 영역을 찾지 못했습니다.'], items: [] };

  const actionCol = findColumnIndex(w3Approval.headerValues, "조치 방향");
  const testTypeCol = findColumnIndex(w3Approval.headerValues, "시험 종류");
  const itemCol = findColumnIndex(w3Approval.headerValues, "검사 항목");

  const targets = w3Approval.dataRows
    .map((row) => ({
      order: row.order,
      testType: testTypeCol !== -1 ? (row.values[testTypeCol] ?? "").trim() : "",
      item: itemCol !== -1 ? (row.values[itemCol] ?? "").trim() : "",
      actionDirection: actionCol !== -1 ? (row.values[actionCol] ?? "").trim() : "",
    }))
    .filter((r) => isImprovementTransferTarget(r.actionDirection));

  // A. Approval 존재 여부 — W4 승인현황에 검사 순서가 있는가.
  const w4ApprovalOrders = new Set(w4Approval.dataRows.map((r) => r.order));

  // B. Detail Block 존재 여부 — W4 해당 시험 종류 Section에 검사 순서 Block이 있는가.
  const w4Sections = scanVariableHeightSections(w4Grid).filter((s) => s.sectionName !== "품질 승인 현황");
  const w4SectionNames = w4Sections.map((s) => s.sectionName);
  const w4DetailByOrder = new Map<string, { sectionName: string; item: string }>();
  for (const section of w4Sections) {
    for (const block of section.blocks) {
      if (block.order === "") continue;
      const itemColW4 = findColumnIndex(block.headerValues, "검사 항목");
      const dataRow = w4Grid[block.headerRowIndex + 1] ?? [];
      const item = itemColW4 !== -1 ? (dataRow[itemColW4] ?? "").trim() : "";
      w4DetailByOrder.set(block.order, { sectionName: section.sectionName, item });
    }
  }

  const results: ItemValidationResult[] = [];

  for (const target of targets) {
    const hasApproval = w4ApprovalOrders.has(target.order);
    const expectedSection = resolveTargetSection(target.testType, w4SectionNames);
    const detailEntry = w4DetailByOrder.get(target.order);
    const hasDetailInExpectedSection = !!detailEntry && (expectedSection === null || detailEntry.sectionName === expectedSection);

    if (!hasApproval) {
      results.push({ inspectionOrder: target.order, status: "MISSING_APPROVAL", detail: `W4 품질 승인 현황에 검사 순서 ${target.order}가 없습니다.` });
      continue;
    }
    if (!hasDetailInExpectedSection) {
      const where = expectedSection ? `"${expectedSection}" Section` : "해당 시험 종류 Section";
      results.push({ inspectionOrder: target.order, status: "MISSING_DETAIL", detail: `W4 ${where}에 검사 순서 ${target.order}의 상세 결과 Block이 없습니다.` });
      continue;
    }
    if (normalizeHeader(detailEntry!.item) !== normalizeHeader(target.item)) {
      results.push({
        inspectionOrder: target.order,
        status: "MISMATCH",
        detail: `검사 순서 ${target.order}의 검사 항목명이 다릅니다(W3: "${target.item}", W4: "${detailEntry!.item}").`,
      });
      continue;
    }
    results.push({ inspectionOrder: target.order, status: "COMPLETE", detail: null });
  }

  for (const r of results) {
    if (r.status !== "COMPLETE" && r.detail) issues.push(r.detail);
  }

  return { ok: results.every((r) => r.status === "COMPLETE"), issues, items: results };
}
