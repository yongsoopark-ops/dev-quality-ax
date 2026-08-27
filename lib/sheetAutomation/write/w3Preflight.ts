import { extractSpreadsheetId, getRawGridValues, getSheetIdByName, getSpreadsheetMetadata } from "@/lib/googleSheets";
import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { findRepeatingTable } from "@/lib/sheetAutomation/sheetGridReader";
import { checkW2TemplateCompatibility, checkW3TemplateCompatibility, combineCompatibility } from "@/lib/sheetAutomation/templateSchema";
import { W2_TO_W3_REPEATING_ANCHOR } from "@/lib/sheetAutomation/w2ToW3Mapping";
import { buildW2ToW3WritePlan } from "@/lib/sheetAutomation/write/buildW2ToW3WritePlan";
import type { WritePlan } from "@/lib/sheetAutomation/write/types";
import type { TemplateCompatibilityInfo } from "@/lib/sheetAutomation/templateSchema";

/**
 * Chat이 URL 하나만 받으므로, W2/W3 Tab 이름은 /sheets Preview처럼 사용자가 직접
 * 입력하지 않고 실제 문서에서 확인된 표준 Tab 이름을 그대로 찾는다. Spreadsheet ID를
 * 코드에 하드코딩하지 않는 것과는 별개로, Tab 이름 자체는 W2/W3 Template 양쪽에
 * 공통된 고정 값이라 하드코딩해도 안전하다.
 */
const W2_SHEET_NAME = "PW2";
const W3_SHEET_NAME = "PW3";

export interface W3PreflightSummary {
  spreadsheetTitle: string;
  spreadsheetId: string;
  totalW2Items: number;
  testTypeCounts: { testType: string; count: number }[];
  approvalStatus: { rowsPlanned: number; rowsToInsert: number };
  detailStructure: { sectionName: string; blocksToInsert: number }[];
  valuesProtected: number;
}

export type W3PreflightResult =
  | { status: "READY"; spreadsheetUrl: string; summary: W3PreflightSummary; templateCheck: TemplateCompatibilityInfo }
  | { status: "NEEDS_REVIEW"; spreadsheetUrl: string; summary: W3PreflightSummary; issues: string[]; templateCheck: TemplateCompatibilityInfo }
  | { status: "TEMPLATE_CHANGED"; spreadsheetUrl: string; templateCheck: TemplateCompatibilityInfo }
  | { status: "ERROR"; message: string };

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

/**
 * spreadsheetUrl 하나로 실제 Google Sheets를 읽어 Write Plan을 계산하는 공용 진입점 —
 * Chat Preflight와 실제 실행 직전 재계산(요청사항 19/20) 양쪽에서 재사용한다.
 * 읽기만 하고 Google API에 값을 쓰지 않는다.
 */
export async function computeW3WritePlanFromUrl(
  spreadsheetUrl: string,
): Promise<
  | { plan: WritePlan; w2Repeating: { headers: string[]; rows: string[][] }; templateCheck: TemplateCompatibilityInfo }
  | { templateChanged: TemplateCompatibilityInfo }
  | { error: string }
> {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) return { error: "유효한 Google Spreadsheet URL을 확인해주세요." };

  let metadata: Awaited<ReturnType<typeof getSpreadsheetMetadata>>;
  try {
    metadata = await getSpreadsheetMetadata(spreadsheetId);
  } catch {
    return { error: "Spreadsheet에 접근할 수 없습니다." };
  }

  if (!metadata.sheetNames.includes(W2_SHEET_NAME)) return { error: "PW2 탭을 찾을 수 없습니다." };
  if (!metadata.sheetNames.includes(W3_SHEET_NAME)) return { error: "PW3 탭을 찾을 수 없습니다." };

  let w2Grid: string[][];
  let w3Grid: string[][];
  let w3SheetId: number;
  try {
    w2Grid = await getRawGridValues(spreadsheetId, W2_SHEET_NAME);
    w3Grid = await getRawGridValues(spreadsheetId, W3_SHEET_NAME);
    w3SheetId = await getSheetIdByName(spreadsheetId, W3_SHEET_NAME);
  } catch {
    return { error: "Spreadsheet를 읽는 중 문제가 발생했습니다." };
  }

  // Template Safety: 실제 매핑/Write를 시도하기 전에 W2/W3 구조가 Schema와
  // 일치하는지 먼저 검사한다 — 불일치하면 추측 매핑 없이 즉시 차단한다(Google
  // Write 0회 보장). 기존 매핑/Write 로직 자체는 이 검사와 무관하게 그대로 둔다.
  const w2Check = checkW2TemplateCompatibility(w2Grid);
  const w3Check = checkW3TemplateCompatibility(w3Grid);
  const combined = combineCompatibility([
    { label: "W2", info: w2Check },
    { label: "W3", info: w3Check },
  ]);
  const versionLabel = combined.parts.map((p) => `${p.label} ${p.version}`).join(" / ");
  if (combined.status === "TEMPLATE_CHANGED") {
    return { templateChanged: { version: versionLabel, status: "TEMPLATE_CHANGED", issues: combined.issues } };
  }
  const templateCheck: TemplateCompatibilityInfo = { version: versionLabel, status: "COMPATIBLE", issues: [] };

  const w2Repeating = findRepeatingTable(w2Grid, W2_TO_W3_REPEATING_ANCHOR);
  if (!w2Repeating) return { error: "W2 검사 계획을 찾을 수 없습니다." };

  try {
    const plan = buildW2ToW3WritePlan({
      spreadsheetId,
      spreadsheetTitle: metadata.title,
      sheetName: W3_SHEET_NAME,
      sheetId: w3SheetId,
      w2Grid,
      w3Grid,
      w2RepeatingTable: w2Repeating,
    });
    return { plan, w2Repeating, templateCheck };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "W3 자동화 계획을 계산하는 중 문제가 발생했습니다." };
  }
}

function summarizePlan(plan: WritePlan, w2Repeating: { headers: string[]; rows: string[][] }): W3PreflightSummary {
  const testTypeIdx = findColumnIndex(w2Repeating.headers, "시험 종류");
  const testTypeCounts = new Map<string, number>();
  for (const row of w2Repeating.rows) {
    const testType = testTypeIdx !== -1 ? (row[testTypeIdx] ?? "").trim() : "";
    if (!testType) continue;
    testTypeCounts.set(testType, (testTypeCounts.get(testType) ?? 0) + 1);
  }

  return {
    spreadsheetTitle: plan.spreadsheetTitle,
    spreadsheetId: plan.spreadsheetId,
    totalW2Items: plan.summary.totalW2Items,
    testTypeCounts: [...testTypeCounts.entries()].map(([testType, count]) => ({ testType, count })),
    approvalStatus: {
      rowsPlanned: plan.summary.approvalRowsPlanned,
      rowsToInsert: plan.summary.approvalRowsToInsert,
    },
    detailStructure: plan.detailSections
      .filter((s) => s.blocksToInsert > 0)
      .map((s) => ({ sectionName: s.sectionName, blocksToInsert: s.blocksToInsert })),
    valuesProtected: plan.summary.detailValuesProtected,
  };
}

/**
 * "읽기 + 계획 계산"만 한다 — executeW2ToW3Write/batchUpdateSpreadsheet/
 * batchUpdateValues를 전혀 import하지 않는다 — 실제 Write 경로와 코드 상 분리돼 있다.
 */
export async function runW3AutomationPreflight(spreadsheetUrl: string): Promise<W3PreflightResult> {
  const result = await computeW3WritePlanFromUrl(spreadsheetUrl);
  if ("error" in result) return { status: "ERROR", message: result.error };
  if ("templateChanged" in result) return { status: "TEMPLATE_CHANGED", spreadsheetUrl, templateCheck: result.templateChanged };

  const { plan, w2Repeating, templateCheck } = result;
  const summary = summarizePlan(plan, w2Repeating);

  if (plan.status === "NEEDS_REVIEW") {
    const issues = [
      ...new Set(
        plan.detailItems
          .filter((i) => i.status === "UNROUTABLE" || i.status === "NEEDS_REVIEW")
          .map((i) => i.note ?? `시험 종류 '${i.testType}'는 자동 분류할 수 없습니다.`),
      ),
    ];
    return { status: "NEEDS_REVIEW", spreadsheetUrl, summary, issues, templateCheck };
  }

  return { status: "READY", spreadsheetUrl, summary, templateCheck };
}
