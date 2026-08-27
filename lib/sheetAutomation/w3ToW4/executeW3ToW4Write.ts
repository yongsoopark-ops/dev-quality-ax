import { batchUpdateSpreadsheet, batchUpdateValues, getRowPixelSizes } from "@/lib/googleSheets";
import { buildClearRowDataValidationRequest } from "@/lib/sheetAutomation/clearHeaderRowValidation";
import type { W3ToW4ExecutionResult, W3ToW4Plan } from "@/lib/sheetAutomation/w3ToW4/types";

const COPY_END_COLUMN = 17;

function columnIndexToLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

function a1(sheetName: string, rowIndex: number, colIndex: number): string {
  return `'${sheetName}'!${columnIndexToLetter(colIndex)}${rowIndex + 1}`;
}

function buildRowHeightRequests(
  sheetId: number,
  sourceHeights: (number | null)[],
  sourceStart: number,
  destStart: number,
  rowCount: number,
): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [];
  for (let i = 0; i < rowCount; i++) {
    const height = sourceHeights[sourceStart + i];
    if (height === null || height === undefined) continue;
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: destStart + i, endIndex: destStart + i + 1 },
        properties: { pixelSize: height },
        fields: "pixelSize",
      },
    });
  }
  return requests;
}

/** Source(W3)와 Destination(W4)은 서로 다른 Sheet(gid)다 — 반드시 각자의 sheetId를 써야 한다. */
function fullRowCopyPaste(
  sourceSheetId: number,
  destSheetId: number,
  sourceRow: number,
  destRow: number,
  rowCount: number,
): Record<string, unknown> {
  return {
    copyPaste: {
      source: { sheetId: sourceSheetId, startRowIndex: sourceRow, endRowIndex: sourceRow + rowCount, startColumnIndex: 0, endColumnIndex: COPY_END_COLUMN },
      destination: { sheetId: destSheetId, startRowIndex: destRow, endRowIndex: destRow + rowCount, startColumnIndex: 0, endColumnIndex: COPY_END_COLUMN },
      pasteType: "PASTE_NORMAL",
    },
  };
}

/**
 * W3→W4 자동이관 실행 — 값 재가공 없이 전체 Row Range를 copyPaste로 그대로
 * 복제한다(요청사항 2/7). Structure(행 삽입+복제)만 있고 별도 "값 쓰기" Phase가
 * 없다 — 승인현황도 상세 Block도 전부 원본 그대로 복제되기 때문이다.
 */
export async function executeW3ToW4Write(plan: W3ToW4Plan): Promise<W3ToW4ExecutionResult> {
  const result: W3ToW4ExecutionResult = {
    approvalRowsInserted: 0,
    detailBlocksInserted: 0,
    totalRowsCopied: 0,
    error: null,
  };

  const { spreadsheetId, w3SheetId, w4SheetId, w3SheetName, w4SheetName } = plan;

  let w3RowHeights: (number | null)[];
  try {
    w3RowHeights = await getRowPixelSizes(spreadsheetId, w3SheetName);
  } catch (err) {
    result.error = `W3 행 높이 조회 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
    return result;
  }

  // ---------- PHASE 0: 상단 기본정보 ----------
  // 승인현황/상세 Block의 행 삽입·Shift와 완전히 무관한 영역(■ 개선 변경점보다도
  // 위쪽)이라 다른 Phase보다 먼저 실행해도, 나중에 실행해도 결과가 같다. FILL 상태
  // 항목만 쓴다 — PROTECTED/NO_SOURCE_VALUE는 절대 건드리지 않는다.
  try {
    const basicInfoData = plan.basicInfoItems
      .filter((i) => i.status === "FILL")
      .map((i) => ({ range: a1(w4SheetName, i.targetRow, i.targetCol), values: [[i.value]] }));
    if (basicInfoData.length > 0) await batchUpdateValues(spreadsheetId, basicInfoData);
  } catch (err) {
    result.error = `상단 기본정보 이관 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
    return result;
  }

  // ---------- PHASE A: 품질 승인 현황 ----------
  const fillBlankItems = plan.approvalItems.filter((i) => i.status === "FILL_BLANK_ROW");
  const newRowItems = plan.approvalItems.filter((i) => i.status === "NEW_ROW");
  const trailingBlank = plan.approvalNeedsTrailingBlank ? 1 : 0;
  const approvalRowsToInsert = newRowItems.length + trailingBlank;
  let approvalShift = 0;

  try {
    const requests: Record<string, unknown>[] = [];

    if (approvalRowsToInsert > 0) {
      requests.push({
        insertDimension: {
          range: { sheetId: w4SheetId, dimension: "ROWS", startIndex: plan.approvalInsertBeforeRowIndex, endIndex: plan.approvalInsertBeforeRowIndex + approvalRowsToInsert },
          inheritFromBefore: true,
        },
      });
    }

    // 기존 빈 행부터 채운다(요청사항 8 재사용) — 이미 존재하는 행이므로 Structure
    // 삽입이 필요 없고 copyPaste만 하면 된다.
    for (const item of fillBlankItems) {
      if (item.targetRowIndex === null) continue;
      requests.push(fullRowCopyPaste(w3SheetId, w4SheetId, item.sourceRowIndex, item.targetRowIndex, 1));
      requests.push(...buildRowHeightRequests(w4SheetId, w3RowHeights, item.sourceRowIndex, item.targetRowIndex, 1));
    }

    let nextNewRow = plan.approvalInsertBeforeRowIndex;
    for (const item of newRowItems) {
      const destRow = nextNewRow;
      nextNewRow += 1;
      requests.push(fullRowCopyPaste(w3SheetId, w4SheetId, item.sourceRowIndex, destRow, 1));
      requests.push(...buildRowHeightRequests(w4SheetId, w3RowHeights, item.sourceRowIndex, destRow, 1));
    }

    if (trailingBlank > 0) {
      const blankRowIndex = nextNewRow;
      requests.push({
        repeatCell: {
          range: { sheetId: w4SheetId, startRowIndex: blankRowIndex, endRowIndex: blankRowIndex + 1, startColumnIndex: 0, endColumnIndex: COPY_END_COLUMN },
          cell: { userEnteredFormat: {} },
          fields: "userEnteredFormat",
        },
      });
    }

    if (requests.length > 0) await batchUpdateSpreadsheet(spreadsheetId, requests);
    approvalShift = approvalRowsToInsert;
    result.approvalRowsInserted = newRowItems.length;
    result.totalRowsCopied += fillBlankItems.length + newRowItems.length;
  } catch (err) {
    result.error = `품질 승인 현황 이관 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
    return result;
  }

  // ---------- PHASE B: 상세 검사 결과 Block ----------
  // Phase A가 W4 승인현황 아래에 행을 추가했다면, 그 아래 모든 상세영역 위치가
  // 그만큼 밀린다 — Plan은 Phase A 실행 전 좌표 기준이므로 여기서 보정한다.
  // (W2→W3와 달리) Insert/copyPaste/행 높이 설정을 Section마다 즉시 한 묶음으로
  // 처리하고 이후 단계에서 "최종 위치"를 다시 계산할 필요가 없다 — 그래서
  // Section 간 누적 Shift 보정이 필요 없다. 하단부터 순서대로 처리하면 각 Section의
  // 원본 좌표가 처리 시점에 항상 유효하고, 위쪽 Section의 나중 삽입이 이미 쓰여진
  // 아래쪽 내용을 통째로 밀어내려도 그 안의 값·서식·행 높이는 함께 이동한다.
  const shiftedInserts = plan.detailSectionInserts.map((s) => ({ ...s, insertBeforeRowIndex: s.insertBeforeRowIndex + approvalShift }));
  const sectionsDescending = [...shiftedInserts].sort((a, b) => b.insertBeforeRowIndex - a.insertBeforeRowIndex);
  const structureRequests: Record<string, unknown>[] = [];
  let blocksInserted = 0;
  let detailRowsCopied = 0;

  for (const section of sectionsDescending) {
    const insertAt = section.insertBeforeRowIndex;

    // pristine placeholder 재사용(요청사항 4) — 기존 Header/Data Row를 그대로 두고
    // 그 위에 copyPaste만 한다(별도 삽입 없음). W3 Block이 placeholder보다 길면
    // 그 초과분만 이 Section 끝에 추가로 삽입한다.
    let overflow = 0;
    if (section.reusePlaceholder) {
      const { sourceHeaderRowIndex, sourceHeight, placeholderHeight, targetHeaderRowIndex } = section.reusePlaceholder;
      const reuseRows = Math.min(sourceHeight, placeholderHeight);
      structureRequests.push(fullRowCopyPaste(w3SheetId, w4SheetId, sourceHeaderRowIndex, targetHeaderRowIndex, reuseRows));
      structureRequests.push(...buildRowHeightRequests(w4SheetId, w3RowHeights, sourceHeaderRowIndex, targetHeaderRowIndex, reuseRows));
      // copyPaste가 Data Row의 dropdown을 Header Row에도 함께 복제해 온다 —
      // Header Row(항상 이 범위의 첫 행)만 targeted로 Data Validation을 제거한다.
      structureRequests.push(buildClearRowDataValidationRequest(w4SheetId, targetHeaderRowIndex));
      blocksInserted += 1;
      detailRowsCopied += reuseRows;
      overflow = Math.max(0, sourceHeight - placeholderHeight);
    }

    const blocksHeight = section.blocks.reduce((sum, b) => sum + b.height, 0);
    const totalInsert = overflow + blocksHeight;

    if (totalInsert > 0) {
      structureRequests.push({
        insertDimension: {
          range: { sheetId: w4SheetId, dimension: "ROWS", startIndex: insertAt, endIndex: insertAt + totalInsert },
          inheritFromBefore: true,
        },
      });
    }

    if (overflow > 0 && section.reusePlaceholder) {
      const { sourceHeaderRowIndex, placeholderHeight } = section.reusePlaceholder;
      structureRequests.push(fullRowCopyPaste(w3SheetId, w4SheetId, sourceHeaderRowIndex + placeholderHeight, insertAt, overflow));
      structureRequests.push(...buildRowHeightRequests(w4SheetId, w3RowHeights, sourceHeaderRowIndex + placeholderHeight, insertAt, overflow));
      detailRowsCopied += overflow;
    }

    let offset = overflow;
    for (const block of section.blocks) {
      const destRow = insertAt + offset;
      structureRequests.push(fullRowCopyPaste(w3SheetId, w4SheetId, block.sourceHeaderRowIndex, destRow, block.height));
      structureRequests.push(...buildRowHeightRequests(w4SheetId, w3RowHeights, block.sourceHeaderRowIndex, destRow, block.height));
      // Header Row(이 범위의 첫 행)만 targeted로 Data Validation을 제거한다.
      structureRequests.push(buildClearRowDataValidationRequest(w4SheetId, destRow));
      offset += block.height;
      blocksInserted += 1;
      detailRowsCopied += block.height;
    }
  }

  try {
    if (structureRequests.length > 0) await batchUpdateSpreadsheet(spreadsheetId, structureRequests);
    result.detailBlocksInserted = blocksInserted;
    result.totalRowsCopied += detailRowsCopied;
  } catch (err) {
    result.error = `상세 검사 결과 Block 이관 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
  }

  return result;
}
