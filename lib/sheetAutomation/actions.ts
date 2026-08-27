"use server";

import { auth } from "@/auth";
import { extractSpreadsheetId, getSheetValues } from "@/lib/googleSheets";
import {
  buildMappingRules,
  computeMappingPreview,
  summarizeMappingPreview,
} from "@/lib/sheetAutomation/mappingEngine";
import { extractLabelValueTable, findRepeatingTable } from "@/lib/sheetAutomation/sheetGridReader";
import { W2_TO_W3_MAPPING, W2_TO_W3_REPEATING_ANCHOR } from "@/lib/sheetAutomation/w2ToW3Mapping";
import type {
  MappingPreviewRow,
  MappingSummary,
  ProjectSheetInput,
  RepeatingMappingGroup,
  SheetTable,
} from "@/lib/sheetAutomation/types";

export interface MappingPreviewResult {
  single: MappingPreviewRow[];
  singleSummary: MappingSummary;
  repeating: RepeatingMappingGroup[] | null;
  repeatingSummary: MappingSummary | null;
}

/** getSheetValues(id, tab, 1)의 결과를 원본 Grid(2차원 배열) 형태로 되돌린다. */
function toGrid(table: SheetTable): string[][] {
  return [table.headers, ...table.rows];
}

/**
 * W2→W3 Mapping Preview를 실행한다. 읽기(spreadsheets.readonly)만 수행하고 DB에
 * 저장하지 않는다(프로젝트마다 다른 Spreadsheet를 매번 Preview 시점에만 읽는다).
 * "매핑 확인" 버튼을 눌렀을 때만 호출되며, Google Sheets API를 정확히 2회(W2 1회,
 * W3 1회) 호출한다. 기존 (shell) 로그인 정책만 따르고 ADMIN으로 제한하지 않는다.
 */
export async function previewW2ToW3Mapping(
  source: ProjectSheetInput,
  target: ProjectSheetInput,
): Promise<{ result?: MappingPreviewResult; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }

  const sourceId = extractSpreadsheetId(source.url);
  const targetId = extractSpreadsheetId(target.url);
  if (!sourceId) return { error: "W2 Sheet URL이 올바르지 않습니다." };
  if (!targetId) return { error: "W3 Sheet URL이 올바르지 않습니다." };
  if (!source.sheetName.trim()) return { error: "W2 Tab 이름을 입력해 주세요." };
  if (!target.sheetName.trim()) return { error: "W3 Tab 이름을 입력해 주세요." };

  let sourceGrid: string[][];
  try {
    // headerRow=1로 읽어 원본 Grid를 그대로 복원한다 — 이 문서는 Header가 한 줄에
    // 있는 Table이 아니라 Form/반복 Table이 섞여 있어, Grid 전체를 보고 직접
    // 위치를 찾아야 한다(extractLabelValueTable/findRepeatingTable).
    sourceGrid = toGrid(await getSheetValues(sourceId, source.sheetName.trim(), 1));
  } catch (err) {
    return {
      error: `W2 Sheet를 읽는 중 문제가 발생했습니다: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
    };
  }
  if (sourceGrid.length === 0) {
    return { error: "W2 Sheet에서 데이터를 찾을 수 없습니다. Tab 이름을 확인해 주세요." };
  }

  let targetGrid: string[][];
  try {
    targetGrid = toGrid(await getSheetValues(targetId, target.sheetName.trim(), 1));
  } catch (err) {
    return {
      error: `W3 Sheet를 읽는 중 문제가 발생했습니다: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
    };
  }
  if (targetGrid.length === 0) {
    return { error: "W3 Sheet에서 데이터를 찾을 수 없습니다. Tab 이름을 확인해 주세요." };
  }

  // 1. 프로젝트 기본 정보(Label → Value Form 영역)
  const sourceSingle = extractLabelValueTable(sourceGrid);
  const targetSingle = extractLabelValueTable(targetGrid);
  if (sourceSingle.headers.length === 0) {
    return { error: "W2 Sheet에서 기본 정보 항목을 찾을 수 없습니다." };
  }
  if (targetSingle.headers.length === 0) {
    return { error: "W3 Sheet에서 기본 정보 항목을 찾을 수 없습니다." };
  }
  const singleRules = buildMappingRules(sourceSingle.headers, targetSingle.headers, W2_TO_W3_MAPPING);
  const single = computeMappingPreview(singleRules, sourceSingle, targetSingle);
  const singleSummary = summarizeMappingPreview(single);

  // 2. 검사 항목(반복 Table) 영역 — 찾지 못하면 이 부분만 비워 두고 기본 정보는 그대로 보여준다.
  const sourceRepeatingTable = findRepeatingTable(sourceGrid, W2_TO_W3_REPEATING_ANCHOR);
  const targetRepeatingTable = findRepeatingTable(targetGrid, W2_TO_W3_REPEATING_ANCHOR);

  let repeating: RepeatingMappingGroup[] | null = null;
  let repeatingSummary: MappingSummary | null = null;

  if (sourceRepeatingTable && targetRepeatingTable) {
    const repeatingRules = buildMappingRules(
      sourceRepeatingTable.headers,
      targetRepeatingTable.headers,
      [],
    );
    const rowKeyIndex = sourceRepeatingTable.headers.findIndex(
      (h) => h.trim() === W2_TO_W3_REPEATING_ANCHOR,
    );

    repeating = sourceRepeatingTable.rows.map((_, rowIndex) => {
      const cells = computeMappingPreview(
        repeatingRules,
        sourceRepeatingTable,
        targetRepeatingTable,
        rowIndex,
      );
      const rowKey =
        (rowKeyIndex !== -1 ? sourceRepeatingTable.rows[rowIndex]?.[rowKeyIndex] : "") ||
        `${rowIndex + 1}`;
      return { rowKey, cells };
    });

    const allCells = repeating.flatMap((g) => g.cells);
    repeatingSummary = summarizeMappingPreview(allCells);
  }

  return { result: { single, singleSummary, repeating, repeatingSummary } };
}
