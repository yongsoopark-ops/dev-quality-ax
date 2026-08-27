import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";

/**
 * 검사 고정행 Anchor — W2→W3의 것과 동일한 열 구조(요청사항 5)를 그대로 쓴다.
 * lib/sheetAutomation/write/types.ts의 INSPECTION_BLOCK_HEADER_SIGNATURE와 값은
 * 같지만, W2→W3 코드를 전혀 import/수정하지 않기 위해 이 폴더 안에 그대로 둔다.
 */
const INSPECTION_BLOCK_HEADER_SIGNATURE = ["순", "판정 일자", "검사 항목", "검사 중요도", "판정 기준", "종합 판정", "이슈 증상"] as const;

function isSectionTitleRow(row: string[]): string | null {
  const firstCell = (row.find((c) => c && c.trim() !== "") ?? "").trim();
  if (!firstCell.startsWith("■")) return null;
  return normalizeHeader(firstCell.replace(/^■/, ""));
}

function isInspectionHeaderRow(row: string[]): boolean {
  const normalizedCells = new Set(row.map((c) => normalizeHeader(c ?? "")));
  return INSPECTION_BLOCK_HEADER_SIGNATURE.every((sig) => normalizedCells.has(sig));
}

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

export interface VariableHeightBlock {
  sectionName: string;
  headerRowIndex: number;
  /** 배타적(exclusive) 끝 — 다음 고정행, 또는 이 시험 종류의 마지막 검사라면 다음
   * Section Title의 위치. 빈 행/병합 셀/추가 표는 전혀 경계 판단에 관여하지 않는다. */
  endRowIndexExclusive: number;
  /** 데이터 행("headerRowIndex+1")의 "순" 값 — 식별 키. */
  order: string;
  headerValues: string[];
}

export interface VariableHeightSection {
  sectionName: string;
  titleRowIndex: number;
  /** 다음 Section Title(배타적) 또는 Grid 끝. */
  sectionEndRowIndex: number;
  blocks: VariableHeightBlock[];
}

/**
 * ■ 섹션마다 검사 고정행(Header Signature 일치)을 찾아, "현재 고정행 시작 ~ 다음
 * 고정행 직전(또는 이 섹션의 마지막 검사라면 다음 Section Title 직전)"을 하나의
 * Block으로 본다. 행 번호를 추측하지 않고, 빈 행/표 제목/소제목/병합 셀/추가
 * 측정표는 전혀 경계 판단에 사용하지 않는다 — 오직 "다음 고정행이 어디 있는가"만 본다.
 */
export function scanVariableHeightSections(grid: string[][]): VariableHeightSection[] {
  const titleRows: { sectionName: string; rowIndex: number }[] = [];
  grid.forEach((row, i) => {
    const name = isSectionTitleRow(row);
    if (name) titleRows.push({ sectionName: name, rowIndex: i });
  });

  return titleRows.map((title, idx) => {
    const sectionEndRowIndex = titleRows[idx + 1]?.rowIndex ?? grid.length;

    const headerRowsInSection: number[] = [];
    for (let r = title.rowIndex + 1; r < sectionEndRowIndex; r++) {
      if (isInspectionHeaderRow(grid[r] ?? [])) headerRowsInSection.push(r);
    }

    const blocks: VariableHeightBlock[] = headerRowsInSection.map((headerRowIndex, i2) => {
      const endRowIndexExclusive = headerRowsInSection[i2 + 1] ?? sectionEndRowIndex;
      const headerValues = grid[headerRowIndex] ?? [];
      const orderCol = findColumnIndex(headerValues, "순");
      const dataRow = grid[headerRowIndex + 1] ?? [];
      const order = orderCol !== -1 ? (dataRow[orderCol] ?? "").trim() : "";
      return { sectionName: title.sectionName, headerRowIndex, endRowIndexExclusive, order, headerValues };
    });

    return { sectionName: title.sectionName, titleRowIndex: title.rowIndex, sectionEndRowIndex, blocks };
  });
}

export function flattenBlocks(sections: VariableHeightSection[]): VariableHeightBlock[] {
  return sections.flatMap((s) => s.blocks);
}
