import { getRawGridValues, getSheetIdByName, getSpreadsheetMetadata } from "@/lib/googleSheets";
import { findRepeatingTable } from "@/lib/sheetAutomation/sheetGridReader";
import { W2_TO_W3_REPEATING_ANCHOR } from "@/lib/sheetAutomation/w2ToW3Mapping";
import { buildW2ToW3WritePlan } from "@/lib/sheetAutomation/write/buildW2ToW3WritePlan";
import type { WriteValidationResult } from "@/lib/sheetAutomation/write/types";

const W2_SHEET_NAME = "PW2";
const W3_SHEET_NAME = "PW3";

/**
 * Write 완료 후 W2/W3를 다시 읽어 처음부터 Plan을 재계산한다(요청사항 23) —
 * 별도의 "검증 전용 로직"을 새로 만들지 않고 buildW2ToW3WritePlan을 그대로
 * 재사용한다: 제대로 반영됐다면 상단 기본정보는 모든 값이 이미 일치하고,
 * 품질 승인 현황/상세 검사영역은 더 이상 삽입·갱신할 것이 없는(MATCHED_NO_CHANGE)
 * 상태가 되어야 한다. 이 재계산 자체가 "Header/Data/Blank 구조가 깨지지
 * 않았는지"까지 함께 검증한다 — 구조가 깨졌다면애초에 Section/Block을 다시
 * 정상적으로 찾아내지 못해 Plan이 달라진다.
 */
export async function validateW3WriteResult(spreadsheetId: string): Promise<WriteValidationResult> {
  const issues: string[] = [];

  const [metadata, w2Grid, w3Grid, sheetId] = await Promise.all([
    getSpreadsheetMetadata(spreadsheetId),
    getRawGridValues(spreadsheetId, W2_SHEET_NAME),
    getRawGridValues(spreadsheetId, W3_SHEET_NAME),
    getSheetIdByName(spreadsheetId, W3_SHEET_NAME),
  ]);

  const w2Repeating = findRepeatingTable(w2Grid, W2_TO_W3_REPEATING_ANCHOR);
  if (!w2Repeating) {
    return { ok: false, issues: ["재검증: W2 검사 계획을 다시 찾지 못했습니다."] };
  }

  let plan;
  try {
    plan = buildW2ToW3WritePlan({
      spreadsheetId,
      spreadsheetTitle: metadata.title,
      sheetName: W3_SHEET_NAME,
      sheetId,
      w2Grid,
      w3Grid,
      w2RepeatingTable: w2Repeating,
    });
  } catch (err) {
    return {
      ok: false,
      issues: [`재검증: Plan을 다시 계산하는 중 오류 — ${err instanceof Error ? err.message : "알 수 없는 오류"}`],
    };
  }

  // 1. 상단 기본정보 — 각 자동입력 대상 Cell의 실제 값이 예상값과 같은지 확인.
  for (const field of plan.basicInfo.fields) {
    const actual = (w3Grid[field.targetRow]?.[field.targetCol] ?? "").trim();
    if (actual !== field.value) {
      issues.push(`상단 기본정보 "${field.label}" 값이 예상과 다릅니다(기대: "${field.value}", 실제: "${actual}").`);
    }
  }

  // 2. 품질 승인 현황 — 더 이상 삽입/갱신할 것이 없어야 한다.
  if (plan.approvalStatus.rowsToInsert > 0) {
    issues.push(`품질 승인 현황에 아직 ${plan.approvalStatus.rowsToInsert}개 행이 더 필요합니다(반영되지 않음).`);
  }
  for (const row of plan.approvalStatus.rows) {
    if (row.status === "MATCHED_UPDATE" || row.status === "FILL_BLANK_ROW" || row.status === "NEW_ROW") {
      issues.push(`품질 승인 현황: 검사 순서 ${row.inspectionOrder} 항목이 아직 반영되지 않았습니다.`);
    }
  }

  // 3/4/5/6. 상세 검사영역 — Header/Data/Blank 구조 재탐지 + 값 일치 확인.
  for (const section of plan.detailSections) {
    if (section.blocksToInsert > 0 && !section.requiresReviewForInsert) {
      issues.push(`"${section.sectionName}" Section에 아직 Block이 ${section.blocksToInsert}개 더 필요합니다(반영되지 않음).`);
    }
  }
  for (const item of plan.detailItems) {
    if (item.status === "MATCHED_UPDATE" || item.status === "FILL_BLANK_SLOT" || item.status === "NEW_BLOCK") {
      issues.push(`"${item.targetSection ?? "미배정"}" 검사 순서 ${item.inspectionOrder} 항목이 아직 반영되지 않았습니다.`);
    }
  }

  return { ok: issues.length === 0, issues };
}
