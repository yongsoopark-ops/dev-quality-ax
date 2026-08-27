import { getRawGridValues } from "@/lib/googleSheets";
import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { scanApprovalArea } from "@/lib/sheetAutomation/w3ToW4/approvalTransferPlan";
import { computeW3ToW4PlanFromUrl } from "@/lib/sheetAutomation/w3ToW4/computeW3ToW4Plan";
import { isImprovementTransferTarget } from "@/lib/sheetAutomation/w3ToW4/types";
import type { TemplateCompatibilityInfo } from "@/lib/sheetAutomation/templateSchema";
import type { W3ToW4Plan } from "@/lib/sheetAutomation/w3ToW4/types";

const W3_SHEET_NAME = "PW3";

export interface W4TargetItem {
  inspectionOrder: string;
  testType: string;
  item: string;
}

export interface W4PreflightSummary {
  spreadsheetTitle: string;
  spreadsheetId: string;
  totalImprovementItems: number;
  targets: W4TargetItem[];
  approvalTransferCount: number;
  detailBlocksToInsert: number;
  alreadyTransferredApprovalCount: number;
  alreadyTransferredDetailCount: number;
  alreadyUpToDate: boolean;
}

export type W4PreflightResult =
  | { status: "READY"; spreadsheetUrl: string; summary: W4PreflightSummary; templateCheck: TemplateCompatibilityInfo }
  | { status: "NEEDS_REVIEW"; spreadsheetUrl: string; summary: W4PreflightSummary; issues: string[]; templateCheck: TemplateCompatibilityInfo }
  | { status: "TEMPLATE_CHANGED"; spreadsheetUrl: string; templateCheck: TemplateCompatibilityInfo }
  | { status: "ERROR"; message: string };

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

/** 표시용 대상 목록만 뽑는다 — buildW3ToW4Plan은 건드리지 않고 W3 승인현황을 별도로 다시 읽는다. */
async function buildTargetList(spreadsheetId: string): Promise<W4TargetItem[]> {
  const w3Grid = await getRawGridValues(spreadsheetId, W3_SHEET_NAME);
  const w3Approval = scanApprovalArea(w3Grid);
  if (!w3Approval) return [];

  const actionCol = findColumnIndex(w3Approval.headerValues, "조치 방향");
  const testTypeCol = findColumnIndex(w3Approval.headerValues, "시험 종류");
  const itemCol = findColumnIndex(w3Approval.headerValues, "검사 항목");

  return w3Approval.dataRows
    .map((row) => ({
      inspectionOrder: row.order,
      testType: testTypeCol !== -1 ? (row.values[testTypeCol] ?? "").trim() : "",
      item: itemCol !== -1 ? (row.values[itemCol] ?? "").trim() : "",
      actionDirection: actionCol !== -1 ? (row.values[actionCol] ?? "").trim() : "",
    }))
    .filter((r) => isImprovementTransferTarget(r.actionDirection))
    .map(({ inspectionOrder, testType, item }) => ({ inspectionOrder, testType, item }));
}

function summarizePlan(plan: W3ToW4Plan, targets: W4TargetItem[]): W4PreflightSummary {
  return {
    spreadsheetTitle: plan.spreadsheetTitle,
    spreadsheetId: plan.spreadsheetId,
    totalImprovementItems: plan.summary.totalImprovementItems,
    targets,
    approvalTransferCount: plan.summary.approvalRowsToFillBlank + plan.summary.approvalRowsToInsert,
    detailBlocksToInsert: plan.summary.detailBlocksToInsert,
    alreadyTransferredApprovalCount: plan.summary.alreadyTransferredApprovalCount,
    alreadyTransferredDetailCount: plan.summary.alreadyTransferredDetailCount,
    alreadyUpToDate: plan.alreadyUpToDate,
  };
}

/**
 * "읽기 + 계획 계산"만 한다 — executeW3ToW4Write/batchUpdateSpreadsheet/
 * batchUpdateValues를 전혀 import하지 않는다. computeW3ToW4PlanFromUrl(기존 W3→W4
 * 엔진 진입점)을 그대로 재사용하고, 표시용 대상 목록만 별도로 덧붙인다.
 */
export async function runW4AutomationPreflight(spreadsheetUrl: string): Promise<W4PreflightResult> {
  const result = await computeW3ToW4PlanFromUrl(spreadsheetUrl);
  if ("error" in result) return { status: "ERROR", message: result.error };
  if ("templateChanged" in result) return { status: "TEMPLATE_CHANGED", spreadsheetUrl, templateCheck: result.templateChanged };

  const { plan, templateCheck } = result;
  let targets: W4TargetItem[] = [];
  try {
    targets = await buildTargetList(plan.spreadsheetId);
  } catch {
    // 대상 목록은 표시용 부가 정보 — 조회 실패해도 Preflight 자체는 막지 않는다.
  }
  const summary = summarizePlan(plan, targets);

  if (plan.status === "NEEDS_REVIEW") {
    const issues = [
      ...new Set([
        ...plan.reviewFlags.map((f) => `검사 순서 ${f.inspectionOrder}: ${f.reason}`),
        ...plan.detailItems
          .filter((i) => i.status === "UNROUTABLE")
          .map((i) => i.note ?? `검사 순서 ${i.inspectionOrder} 항목을 자동 배정하지 못했습니다.`),
      ]),
    ];
    return { status: "NEEDS_REVIEW", spreadsheetUrl, summary, issues, templateCheck };
  }

  return { status: "READY", spreadsheetUrl, summary, templateCheck };
}
