"use server";

import { auth } from "@/auth";
import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { computeW3WritePlanFromUrl } from "@/lib/sheetAutomation/write/w3Preflight";
import { executeW2ToW3Write } from "@/lib/sheetAutomation/write/executeW2ToW3Write";
import { validateW3WriteResult } from "@/lib/sheetAutomation/write/validateW3WriteResult";
import type { WriteExecutionResult, WritePlan } from "@/lib/sheetAutomation/write/types";

export interface WriteResultPlanSnapshot {
  totalW2Items: number;
  testTypeCounts: { testType: string; count: number }[];
  detailSections: { sectionName: string; requiredSlotCount: number }[];
}

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

/**
 * Write Plan만 계산한다 — 읽기만 수행하고 어떤 값도 바꾸지 않는다. 언제 호출해도
 * 안전하다. 기존 Preview와 동일하게 (shell) 로그인 정책만 따르고 ADMIN으로
 * 제한하지 않는다.
 */
export async function buildW2ToW3WritePlanAction(
  spreadsheetUrl: string,
): Promise<{ plan?: WritePlan; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }
  if (!spreadsheetUrl.trim()) {
    return { error: "Google Spreadsheet URL을 입력해 주세요." };
  }

  const result = await computeW3WritePlanFromUrl(spreadsheetUrl);
  if ("error" in result) return { error: result.error };
  if ("templateChanged" in result) {
    return { error: `TEMPLATE_CHANGED (${result.templateChanged.version}) — ${result.templateChanged.issues.join("; ")}` };
  }
  return { plan: result.plan };
}

/**
 * 실제 W3 문서에 값을 쓴다 — 사용자가 화면에서 계획을 확인한 뒤 "실행"을 명시적으로
 * 눌렀을 때만 호출해야 한다. Client가 들고 있는 Plan은 신뢰하지 않고, 여기서
 * spreadsheetUrl로 항상 새로 읽어 다시 계산한다(요청사항 19/20) — Preflight 이후
 * 사용자가 Sheet를 수정했을 수 있기 때문이다. 다시 계산한 결과가 READY가 아니면
 * 실행하지 않는다.
 */
export async function executeW2ToW3WriteAction(spreadsheetUrl: string): Promise<{
  result?: WriteExecutionResult;
  validation?: { ok: boolean; issues: string[] };
  planSnapshot?: WriteResultPlanSnapshot;
  stale?: boolean;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }

  const fresh = await computeW3WritePlanFromUrl(spreadsheetUrl);
  if ("error" in fresh) return { error: fresh.error };
  if ("templateChanged" in fresh) {
    return { error: `TEMPLATE_CHANGED (${fresh.templateChanged.version}) — ${fresh.templateChanged.issues.join("; ")}` };
  }

  if (fresh.plan.status !== "READY") {
    return { stale: true, error: "Sheet 내용이 변경되어 자동화 계획을 다시 확인해야 합니다." };
  }

  const testTypeIdx = findColumnIndex(fresh.w2Repeating.headers, "시험 종류");
  const testTypeCounts = new Map<string, number>();
  for (const row of fresh.w2Repeating.rows) {
    const testType = testTypeIdx !== -1 ? (row[testTypeIdx] ?? "").trim() : "";
    if (!testType) continue;
    testTypeCounts.set(testType, (testTypeCounts.get(testType) ?? 0) + 1);
  }
  const planSnapshot: WriteResultPlanSnapshot = {
    totalW2Items: fresh.plan.summary.totalW2Items,
    testTypeCounts: [...testTypeCounts.entries()].map(([testType, count]) => ({ testType, count })),
    detailSections: fresh.plan.detailSections.map((s) => ({ sectionName: s.sectionName, requiredSlotCount: s.requiredSlotCount })),
  };

  if (fresh.plan.alreadyUpToDate) {
    return {
      planSnapshot,
      result: {
        phase1BasicInfo: true,
        phase2ApprovalStatus: true,
        phase3DetailStructure: true,
        phase4DetailValues: true,
        phase5Validated: true,
        approvalRowsInserted: 0,
        detailBlocksInserted: 0,
        cellsWritten: 0,
        valuesProtected: fresh.plan.summary.detailValuesProtected,
        error: null,
      },
    };
  }

  let result: WriteExecutionResult;
  try {
    result = await executeW2ToW3Write(fresh.plan);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "실행 중 오류가 발생했습니다." };
  }

  if (result.error || !result.phase4DetailValues) {
    return { result, planSnapshot };
  }

  try {
    const validation = await validateW3WriteResult(fresh.plan.spreadsheetId);
    result.phase5Validated = validation.ok;
    return { result, validation, planSnapshot };
  } catch (err) {
    return {
      result,
      planSnapshot,
      validation: {
        ok: false,
        issues: [`실행 후 검증을 위해 다시 읽는 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`],
      },
    };
  }
}
