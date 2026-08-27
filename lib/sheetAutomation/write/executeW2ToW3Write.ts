import { batchUpdateSpreadsheet, batchUpdateValues } from "@/lib/googleSheets";
import { buildClearRowDataValidationRequest } from "@/lib/sheetAutomation/clearHeaderRowValidation";
import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { DETAIL_WRITABLE_HEADERS, PROTECTED_APPROVAL_HEADERS, PROTECTED_DETAIL_HEADERS } from "@/lib/sheetAutomation/write/types";
import type { WriteExecutionResult, WritePlan } from "@/lib/sheetAutomation/write/types";

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

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

const DETAIL_FIELD_BY_HEADER: Record<(typeof DETAIL_WRITABLE_HEADERS)[number], (i: { inspectionOrder: string; inspectionItem: string; importance: string; criteria: string }) => string> = {
  "순": (i) => i.inspectionOrder,
  "검사 항목": (i) => i.inspectionItem,
  "검사 중요도": (i) => i.importance,
  "판정 기준": (i) => i.criteria,
};

/**
 * W3 자동화 규칙의 5단계 실행(요청사항 21) — Phase 1 상단 기본정보, Phase 2 품질
 * 승인 현황(구조+데이터), Phase 3 상세 검사 Block 구조, Phase 4 상세 검사 데이터,
 * Phase 5 재검증(validateW3WriteResult에서 별도 수행). Structure(insertDimension/
 * copyPaste)와 Value 입력을 항상 분리한다 — Structure가 전부 끝난 뒤에만 Value를
 * 쓴다(중간에 섞으면 방금 삽입한 행의 실제 위치를 추적하기 어렵다).
 */
export async function executeW2ToW3Write(plan: WritePlan): Promise<WriteExecutionResult> {
  const result: WriteExecutionResult = {
    phase1BasicInfo: false,
    phase2ApprovalStatus: false,
    phase3DetailStructure: false,
    phase4DetailValues: false,
    phase5Validated: false,
    approvalRowsInserted: 0,
    detailBlocksInserted: 0,
    cellsWritten: 0,
    valuesProtected: 0,
    error: null,
  };

  const { spreadsheetId, sheetName, sheetId } = plan;

  // ---------- PHASE 1: 상단 기본정보 ----------
  try {
    const basicInfoData = plan.basicInfo.fields.map((f) => ({
      range: a1(sheetName, f.targetRow, f.targetCol),
      values: [[f.value]],
    }));
    if (basicInfoData.length > 0) await batchUpdateValues(spreadsheetId, basicInfoData);
    result.phase1BasicInfo = true;
  } catch (err) {
    result.error = `상단 기본정보 입력 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
    return result;
  }

  // ---------- PHASE 2: 품질 승인 현황(구조 + 데이터) ----------
  let approvalRowShift = 0;
  try {
    const insertAt = plan.approvalStatus.insertBeforeRowIndex;
    const rowsToInsert = plan.approvalStatus.rowsToInsert;
    // 품질 승인 현황은 항목 사이에는 빈 행을 절대 넣지 않고, 마지막 항목 뒤에만
    // 구분용 빈 행 1개를 둔다(상세영역의 Header→Data→Blank 반복 규칙과는 완전히
    // 별개). 이미 그 빈 행이 있으면 다시 만들지 않는다(재실행 안전성).
    const trailingBlankRows = plan.approvalStatus.needsTrailingBlank ? 1 : 0;
    const totalRowsToInsert = rowsToInsert + trailingBlankRows;

    if (totalRowsToInsert > 0) {
      const approvalStructureRequests: Record<string, unknown>[] = [
        {
          // 삽입 위치 바로 아래는 다음 Section Title(진회색)이다 — inheritFromBefore를
          // false로 두면 그 Dark 서식을 그대로 물려받는다. true로 바꿔 삽입 위치
          // 바로 위(정상 Data Row)의 서식을 물려받게 한다.
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: insertAt, endIndex: insertAt + totalRowsToInsert },
            inheritFromBefore: true,
          },
        },
      ];
      // insertDimension의 행 단위 상속만으로는 병합/테두리 등 Cell 서식까지 완전히
      // 보장되지 않으므로, 기존 정상 Data Row 1개를 Template Source로 지정해
      // 각 신규 Data 행에 그대로 copyPaste한다(Header는 복제하지 않는다, 요청사항 2).
      // Data 행들은 항상 용량 바로 뒤 연속된 자리(insertAt..insertAt+rowsToInsert-1)에
      // 붙고, Trailing Blank는 그 다음 마지막 자리 1개뿐이다 — 항목 사이에는
      // 어떤 경우에도 빈 행이 끼어들지 않는다.
      if (plan.approvalStatus.templateRowIndex !== null) {
        for (let i = 0; i < rowsToInsert; i++) {
          const destRow = insertAt + i;
          approvalStructureRequests.push({
            copyPaste: {
              source: { sheetId, startRowIndex: plan.approvalStatus.templateRowIndex, endRowIndex: plan.approvalStatus.templateRowIndex + 1, startColumnIndex: 0, endColumnIndex: 17 },
              destination: { sheetId, startRowIndex: destRow, endRowIndex: destRow + 1, startColumnIndex: 0, endColumnIndex: 17 },
              pasteType: "PASTE_NORMAL",
            },
          });
        }
      }
      if (trailingBlankRows > 0) {
        const blankRowIndex = insertAt + rowsToInsert;
        // 이 시점에서 spacerTemplateRowIndex(상세영역에 있는, 실제로 비어 있는 행)는
        // 이번 Phase 2 삽입만큼 아직 보정되지 않은 원본 좌표다 — 같은 batchUpdate
        // 안에서 이 삽입 요청이 먼저 적용되므로 그만큼 더해 보정한다.
        if (plan.spacerTemplateRowIndex !== null) {
          const shiftedSpacerSource = plan.spacerTemplateRowIndex + totalRowsToInsert;
          approvalStructureRequests.push({
            copyPaste: {
              source: { sheetId, startRowIndex: shiftedSpacerSource, endRowIndex: shiftedSpacerSource + 1, startColumnIndex: 0, endColumnIndex: 17 },
              destination: { sheetId, startRowIndex: blankRowIndex, endRowIndex: blankRowIndex + 1, startColumnIndex: 0, endColumnIndex: 17 },
              pasteType: "PASTE_FORMAT",
            },
          });
        } else {
          approvalStructureRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: blankRowIndex, endRowIndex: blankRowIndex + 1, startColumnIndex: 0, endColumnIndex: 17 },
              cell: { userEnteredFormat: {} },
              fields: "userEnteredFormat",
            },
          });
        }
      }
      await batchUpdateSpreadsheet(spreadsheetId, approvalStructureRequests);
      approvalRowShift = totalRowsToInsert;
      result.approvalRowsInserted = rowsToInsert;
    }

    let nextNewRow = insertAt;
    const approvalData: { range: string; values: string[][] }[] = [];
    for (const row of plan.approvalStatus.rows) {
      if (row.status === "MATCHED_NO_CHANGE") {
        result.valuesProtected += 1;
        continue;
      }
      let rowIndex: number;
      let isNewRow = false;
      if (row.status === "NEW_ROW") {
        rowIndex = nextNewRow;
        nextNewRow += 1;
        isNewRow = true;
      } else if (row.targetRowIndex !== null) {
        rowIndex = row.targetRowIndex;
      } else {
        continue;
      }
      // Template Source 행을 그대로 복제했으므로, 신규 행은 그 값(담당자 작성
      // 영역 포함)도 함께 복사돼 온다 — 새 행은 항상 비어 있어야 하므로 명시적으로
      // 비운다(요청사항 9 보호 정책과 동일한 원칙).
      if (isNewRow) {
        for (const protectedHeader of PROTECTED_APPROVAL_HEADERS) {
          const col = findColumnIndex(plan.approvalStatus.headerValues, protectedHeader);
          if (col !== -1) approvalData.push({ range: a1(sheetName, rowIndex, col), values: [[""]] });
        }
      }
      for (const cell of row.cells) {
        approvalData.push({ range: a1(sheetName, rowIndex, cell.targetCol), values: [[cell.value]] });
      }
    }
    if (approvalData.length > 0) {
      await batchUpdateValues(spreadsheetId, approvalData);
      result.cellsWritten += approvalData.length;
    }
    result.phase2ApprovalStatus = true;
  } catch (err) {
    result.error = `품질 승인 현황 입력 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
    return result;
  }

  // ---------- PHASE 3: 상세 검사 Block 구조 생성 ----------
  // 품질 승인 현황에 행을 삽입했다면, 그 아래에 있는 모든 상세 검사영역 위치가
  // 그만큼 밀린다 — Plan은 Phase 2 실행 전 상태를 기준으로 계산됐으므로 여기서
  // 보정한다.
  const shiftedSections = plan.detailSections.map((s) => ({
    ...s,
    templateHeaderRowIndex: s.templateHeaderRowIndex + approvalRowShift,
    insertBeforeRowIndex: s.insertBeforeRowIndex + approvalRowShift,
  }));
  const shiftedItems = plan.detailItems.map((item) =>
    item.targetSlot
      ? {
          ...item,
          targetSlot: {
            headerRowIndex: item.targetSlot.headerRowIndex + approvalRowShift,
            dataRowIndex: item.targetSlot.dataRowIndex + approvalRowShift,
          },
        }
      : item,
  );

  // Section이 여러 개 동시에 늘어날 수 있다 — 예를 들어 "기능/성능"(위쪽)에 Block을
  // 삽입하면 그 아래에 있는 "신뢰성"/"외부 의뢰" 등 모든 하위 Section의 실제 행
  // 위치가 그만큼 더 밀린다. Structure 요청 자체는 원래 좌표를 그대로 써도 안전하지만
  // (하단부터 순서대로 적용하면 각 요청이 실행되는 시점엔 자기 좌표가 아직 유효하다),
  // Phase 4에서 실제 값을 쓸 좌표는 "이 Section보다 위에 있는 다른 Section들이
  // 삽입한 행 수의 총합"만큼 추가로 보정해야 한다.
  const sectionsByPosition = [...shiftedSections].sort((a, b) => a.insertBeforeRowIndex - b.insertBeforeRowIndex);
  const cumulativeShiftBeforeSection = new Map<string, number>();
  let runningShift = 0;
  for (const section of sectionsByPosition) {
    cumulativeShiftBeforeSection.set(section.sectionName, runningShift);
    runningShift += section.blocksToInsert * 3 + (section.needsLeadingSpacer ? 1 : 0);
  }

  const sectionsNeedingInsert = [...shiftedSections]
    .filter((s) => s.blocksToInsert > 0)
    .sort((a, b) => b.insertBeforeRowIndex - a.insertBeforeRowIndex);

  const newBlockLocations = new Map<string, { headerRowIndex: number; dataRowIndex: number }[]>();
  const structureRequests: Record<string, unknown>[] = [];
  // Plan 계산 시점(Phase 2 실행 전) 좌표이므로, 품질 승인 현황에 행을 삽입했다면
  // 그만큼 보정해야 한다 — 그렇지 않으면 엉뚱한(이미 밀려난) 행을 Spacer
  // Template Source로 잘못 참조하게 된다.
  const spacerTemplateRowIndex = plan.spacerTemplateRowIndex !== null ? plan.spacerTemplateRowIndex + approvalRowShift : null;

  const formatSpacerRow = (rowIndex: number) => {
    if (spacerTemplateRowIndex !== null) {
      structureRequests.push({
        copyPaste: {
          source: { sheetId, startRowIndex: spacerTemplateRowIndex, endRowIndex: spacerTemplateRowIndex + 1, startColumnIndex: 0, endColumnIndex: 17 },
          destination: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 17 },
          pasteType: "PASTE_FORMAT",
        },
      });
    } else {
      // 문서 안에서 쓸 수 있는 완전히 빈 행을 찾지 못한 경우의 대비책 —
      // 서식을 명시적으로 기본값(흰 배경/테두리 없음)으로 초기화한다(요청사항 5).
      structureRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 17 },
          cell: { userEnteredFormat: {} },
          fields: "userEnteredFormat",
        },
      });
    }
  };

  for (const section of sectionsNeedingInsert) {
    // 기존 Template이 마지막 슬롯 뒤에 Spacer 없이 곧장 다음 Section Title로
    // 이어지는 경우, 새 Block들 앞에 빈 행을 1개 더 끼워 넣어야 기존 마지막 항목과
    // 새 Block 사이에 Spacer가 생긴다(요청사항 9) — 그만큼 삽입 행 수와 새 Block
    // 시작 위치를 함께 보정한다.
    const leadingSpacerRows = section.needsLeadingSpacer ? 1 : 0;
    const rowsToInsert = section.blocksToInsert * 3 + leadingSpacerRows;
    const insertAt = section.insertBeforeRowIndex;
    const firstBlockOffset = leadingSpacerRows;

    structureRequests.push({
      // 삽입 위치 바로 아래는 다음 Section Title(진회색)이다 — inheritFromBefore를
      // false로 두면 그 Dark 서식을 새로 만든 모든 행(Spacer 포함)이 물려받는다.
      // true로 바꿔 삽입 위치 바로 위(이 Section 자신의 마지막 정상 행)의 서식을
      // 물려받게 한다.
      insertDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: insertAt, endIndex: insertAt + rowsToInsert },
        inheritFromBefore: true,
      },
    });

    // 기존 마지막 항목 뒤에 Spacer가 없어 새로 끼워 넣는 선행 빈 행도 같은 방식으로
    // 서식을 맞춘다(단순히 insertDimension이 만든 빈 행 그대로 두지 않는다).
    if (leadingSpacerRows > 0) formatSpacerRow(insertAt);

    // copyPaste 목적지는 이 요청이 "실행되는 순간" 기준 좌표(raw)를 그대로 써야
    // 한다 — 아래쪽부터 순서대로 적용하므로 이 Section보다 위(원본 좌표 기준)는
    // 아직 아무것도 삽입되지 않은 상태다. 하지만 Phase 4에서 값을 쓸 때는 모든
    // Structure 요청이 끝난 뒤이므로, 이 Section보다 위에 있는 다른 Section들의
    // 삽입분(cumulativeShiftBeforeSection)까지 더한 "최종 위치"를 저장해 둔다.
    const shift = cumulativeShiftBeforeSection.get(section.sectionName) ?? 0;
    const locations: { headerRowIndex: number; dataRowIndex: number }[] = [];
    for (let b = 0; b < section.blocksToInsert; b++) {
      const headerRowIndex = insertAt + firstBlockOffset + b * 3;
      const dataRowIndex = headerRowIndex + 1;
      const spacerRowIndex = headerRowIndex + 2;
      locations.push({ headerRowIndex: headerRowIndex + shift, dataRowIndex: dataRowIndex + shift });
      structureRequests.push({
        copyPaste: {
          source: {
            sheetId,
            startRowIndex: section.templateHeaderRowIndex,
            endRowIndex: section.templateHeaderRowIndex + 2,
            startColumnIndex: 0,
            endColumnIndex: 17,
          },
          destination: {
            sheetId,
            startRowIndex: headerRowIndex,
            endRowIndex: headerRowIndex + 2,
            startColumnIndex: 0,
            endColumnIndex: 17,
          },
          pasteType: "PASTE_NORMAL",
        },
      });
      // copyPaste가 Data Row(headerRowIndex+1)의 dropdown을 Header Row에도 함께
      // 복제해 온다 — Header Row만 targeted로 Data Validation을 제거한다.
      structureRequests.push(buildClearRowDataValidationRequest(sheetId, headerRowIndex));
      // 3번째 행(spacerRowIndex)은 반드시 완전히 빈 흰색 행이어야 한다 —
      // insertDimension의 상속만 믿지 않고 명시적으로 서식을 맞춘다(요청사항 3/4).
      formatSpacerRow(spacerRowIndex);
    }
    newBlockLocations.set(section.sectionName, locations);
  }

  try {
    if (structureRequests.length > 0) await batchUpdateSpreadsheet(spreadsheetId, structureRequests);
    result.phase3DetailStructure = true;
    result.detailBlocksInserted = sectionsNeedingInsert.reduce((sum, s) => sum + s.blocksToInsert, 0);
  } catch (err) {
    result.error = `상세 검사 Block 생성 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
    return result;
  }

  // ---------- PHASE 4: 상세 검사 데이터 입력 ----------
  const detailData: { range: string; values: string[][] }[] = [];
  const perSectionNewIndex = new Map<string, number>();
  const sectionByName = new Map(shiftedSections.map((s) => [s.sectionName, s]));

  for (const item of shiftedItems) {
    if (!item.targetSection || item.status === "UNROUTABLE" || item.status === "NEEDS_REVIEW") continue;
    if (item.status === "MATCHED_NO_CHANGE") {
      result.valuesProtected += 1;
      continue;
    }

    let dataRowIndex: number;
    let headerValues: string[];

    if (item.status === "NEW_BLOCK") {
      const section = sectionByName.get(item.targetSection);
      if (!section) continue;
      const locations = newBlockLocations.get(item.targetSection) ?? [];
      const idx = perSectionNewIndex.get(item.targetSection) ?? 0;
      perSectionNewIndex.set(item.targetSection, idx + 1);
      const loc = locations[idx];
      if (!loc) continue;
      dataRowIndex = loc.dataRowIndex;
      headerValues = section.templateHeaderValues;

      // 복제된 새 Block은 Template의 값도 함께 복사해 온다 — 새 Block은 항상
      // 비어 있어야 하므로 담당자 작성 영역을 명시적으로 비운다(요청사항 12).
      for (const protectedHeader of PROTECTED_DETAIL_HEADERS) {
        const col = findColumnIndex(headerValues, protectedHeader);
        if (col !== -1) detailData.push({ range: a1(sheetName, dataRowIndex, col), values: [[""]] });
      }
    } else if (item.targetSlot) {
      // 기존 슬롯도 이 Section보다 위에 있는 다른 Section의 삽입만큼 최종적으로
      // 더 밀려 있다(자기 Section 자신의 삽입은 슬롯보다 아래에서 일어나므로 영향 없음).
      const shift = cumulativeShiftBeforeSection.get(item.targetSection) ?? 0;
      dataRowIndex = item.targetSlot.dataRowIndex + shift;
      headerValues = sectionByName.get(item.targetSection)?.templateHeaderValues ?? [];
    } else {
      continue;
    }

    for (const header of DETAIL_WRITABLE_HEADERS) {
      const col = findColumnIndex(headerValues, header);
      if (col === -1) continue;
      const value = DETAIL_FIELD_BY_HEADER[header](item);
      detailData.push({ range: a1(sheetName, dataRowIndex, col), values: [[value]] });
    }
  }

  try {
    if (detailData.length > 0) {
      await batchUpdateValues(spreadsheetId, detailData);
      result.cellsWritten += detailData.length;
    }
    result.phase4DetailValues = true;
  } catch (err) {
    result.error = `상세 검사 데이터 입력 중 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`;
  }

  return result;
}
