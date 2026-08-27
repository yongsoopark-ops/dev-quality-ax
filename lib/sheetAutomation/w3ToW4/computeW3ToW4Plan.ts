import { extractSpreadsheetId, getRawGridValues, getSheetIdByName, getSpreadsheetMetadata } from "@/lib/googleSheets";
import { checkW3TemplateCompatibility, checkW4TemplateCompatibility, combineCompatibility } from "@/lib/sheetAutomation/templateSchema";
import { buildW3ToW4Plan } from "@/lib/sheetAutomation/w3ToW4/buildW3ToW4Plan";
import type { TemplateCompatibilityInfo } from "@/lib/sheetAutomation/templateSchema";
import type { W3ToW4Plan } from "@/lib/sheetAutomation/w3ToW4/types";

const W3_SHEET_NAME = "PW3";
const W4_SHEET_NAME = "PW4";

/**
 * spreadsheetUrl 하나로 실제 Google Sheets를 읽어 W3→W4 이관 Plan을 계산하는
 * 공용 진입점 — Preflight와 실행 직전 재계산 양쪽에서 재사용한다. 읽기만 하고
 * Google API에 값을 쓰지 않는다.
 */
export async function computeW3ToW4PlanFromUrl(
  spreadsheetUrl: string,
): Promise<{ plan: W3ToW4Plan; templateCheck: TemplateCompatibilityInfo } | { templateChanged: TemplateCompatibilityInfo } | { error: string }> {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) return { error: "유효한 Google Spreadsheet URL을 확인해주세요." };

  let metadata: Awaited<ReturnType<typeof getSpreadsheetMetadata>>;
  try {
    metadata = await getSpreadsheetMetadata(spreadsheetId);
  } catch {
    return { error: "Spreadsheet에 접근할 수 없습니다." };
  }

  if (!metadata.sheetNames.includes(W3_SHEET_NAME)) return { error: "PW3 탭을 찾을 수 없습니다." };
  if (!metadata.sheetNames.includes(W4_SHEET_NAME)) return { error: "PW4 탭을 찾을 수 없습니다." };

  let w3Grid: string[][];
  let w4Grid: string[][];
  let w3SheetId: number;
  let w4SheetId: number;
  try {
    w3Grid = await getRawGridValues(spreadsheetId, W3_SHEET_NAME);
    w4Grid = await getRawGridValues(spreadsheetId, W4_SHEET_NAME);
    w3SheetId = await getSheetIdByName(spreadsheetId, W3_SHEET_NAME);
    w4SheetId = await getSheetIdByName(spreadsheetId, W4_SHEET_NAME);
  } catch {
    return { error: "Spreadsheet를 읽는 중 문제가 발생했습니다." };
  }

  // Template Safety: 실제 Block 복사를 시도하기 전에 W3/W4 구조가 Schema와
  // 일치하는지 먼저 검사한다 — 불일치하면 추측 없이 즉시 차단한다(Google Write
  // 0회 보장). 기존 매핑/Block 복사 로직 자체는 이 검사와 무관하게 그대로 둔다.
  const w3Check = checkW3TemplateCompatibility(w3Grid);
  const w4Check = checkW4TemplateCompatibility(w4Grid);
  const combined = combineCompatibility([
    { label: "W3", info: w3Check },
    { label: "W4", info: w4Check },
  ]);
  const versionLabel = combined.parts.map((p) => `${p.label} ${p.version}`).join(" / ");
  if (combined.status === "TEMPLATE_CHANGED") {
    return { templateChanged: { version: versionLabel, status: "TEMPLATE_CHANGED", issues: combined.issues } };
  }
  const templateCheck: TemplateCompatibilityInfo = { version: versionLabel, status: "COMPATIBLE", issues: [] };

  try {
    const plan = buildW3ToW4Plan({
      spreadsheetId,
      spreadsheetTitle: metadata.title,
      w3SheetName: W3_SHEET_NAME,
      w4SheetName: W4_SHEET_NAME,
      w3SheetId,
      w4SheetId,
      w3Grid,
      w4Grid,
    });
    return { plan, templateCheck };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "W3→W4 이관 계획을 계산하는 중 문제가 발생했습니다." };
  }
}
