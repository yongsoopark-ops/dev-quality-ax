"use server";

import { auth } from "@/auth";
import { computeW3ToW4PlanFromUrl } from "@/lib/sheetAutomation/w3ToW4/computeW3ToW4Plan";
import { executeW3ToW4Write } from "@/lib/sheetAutomation/w3ToW4/executeW3ToW4Write";
import { validateW3ToW4Result } from "@/lib/sheetAutomation/w3ToW4/validateW3ToW4Result";
import type { W3ToW4ExecutionResult, W3ToW4Plan, W3ToW4ValidationResult } from "@/lib/sheetAutomation/w3ToW4/types";

/**
 * Plan만 계산한다 — 읽기만 수행하고 어떤 값도 바꾸지 않는다. 언제 호출해도 안전하다.
 * 기존 (shell) 로그인 정책만 따르고 ADMIN으로 제한하지 않는다.
 */
export async function buildW3ToW4PlanAction(spreadsheetUrl: string): Promise<{ plan?: W3ToW4Plan; error?: string }> {
  const session = await auth();
  if (!session?.user) return { error: "로그인이 필요합니다." };
  if (!spreadsheetUrl.trim()) return { error: "Google Spreadsheet URL을 입력해 주세요." };

  const result = await computeW3ToW4PlanFromUrl(spreadsheetUrl);
  if ("error" in result) return { error: result.error };
  if ("templateChanged" in result) {
    return { error: `TEMPLATE_CHANGED (${result.templateChanged.version}) — ${result.templateChanged.issues.join("; ")}` };
  }
  return { plan: result.plan };
}

/**
 * 실제 W4 문서에 값을 쓴다 — 사용자가 화면에서 계획을 확인한 뒤 실행을 명시적으로
 * 눌렀을 때만 호출해야 한다. Client가 들고 있는 Plan은 신뢰하지 않고, spreadsheetUrl로
 * 항상 새로 읽어 다시 계산한 뒤 READY일 때만 실행한다.
 */
export async function executeW3ToW4WriteAction(spreadsheetUrl: string): Promise<{
  result?: W3ToW4ExecutionResult;
  validation?: W3ToW4ValidationResult;
  stale?: boolean;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user) return { error: "로그인이 필요합니다." };

  const fresh = await computeW3ToW4PlanFromUrl(spreadsheetUrl);
  if ("error" in fresh) return { error: fresh.error };
  if ("templateChanged" in fresh) {
    return { error: `TEMPLATE_CHANGED (${fresh.templateChanged.version}) — ${fresh.templateChanged.issues.join("; ")}` };
  }

  if (fresh.plan.status !== "READY") {
    return { stale: true, error: "Sheet 내용이 변경되어 이관 계획을 다시 확인해야 합니다." };
  }
  if (fresh.plan.alreadyUpToDate) {
    return { result: { approvalRowsInserted: 0, detailBlocksInserted: 0, totalRowsCopied: 0, error: null } };
  }

  let result: W3ToW4ExecutionResult;
  try {
    result = await executeW3ToW4Write(fresh.plan);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "실행 중 오류가 발생했습니다." };
  }

  if (result.error) return { result };

  try {
    const validation = await validateW3ToW4Result(fresh.plan.spreadsheetId);
    return { result, validation };
  } catch (err) {
    return {
      result,
      validation: { ok: false, issues: [`실행 후 검증을 위해 다시 읽는 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`], items: [] },
    };
  }
}
