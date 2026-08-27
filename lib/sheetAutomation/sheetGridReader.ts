import type { SheetTable } from "@/lib/sheetAutomation/types";
import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";

/**
 * W2/W3 실제 구조 확인 결과, Header가 한 줄에 쭉 있는 Table이 아니라 두 가지 영역이
 * 섞여 있다:
 *  - 상단 프로젝트 기본 정보: "Label 칸 → (빈 칸들) → Value 칸"이 한 Row 안에 여러 쌍
 *    반복되는 Form 형태(예: "제품명" 칸의 2칸 오른쪽에 실제 제품명 값).
 *  - 그 아래 "■ 섹션명" 또는 "N. 섹션명"으로 시작하는 Header Row + 반복 데이터 Row로
 *    구성된 진짜 Table 영역(검사 계획/품질 승인 현황 등).
 * 이 두 영역을 각각 읽어 기존 SheetTable({headers, rows}) 모양으로 변환하면,
 * mappingEngine의 매칭 로직(Header 이름 기준 Exact Match)을 그대로 재사용할 수 있다.
 */

/** Write Engine(lib/sheetAutomation/write)에서도 동일한 경계 판정 기준을 재사용한다. */
export function isSectionBoundary(row: string[]): boolean {
  const firstCell = (row.find((c) => c && c.trim() !== "") ?? "").trim();
  if (!firstCell) return false;
  return firstCell.startsWith("■") || /^\d+\.\s*\S/.test(firstCell);
}

export function isBlankRow(row: string[]): boolean {
  return row.every((cell) => !cell || cell.trim() === "");
}

/**
 * Grid 맨 위부터, 첫 "■.../N. ..." 형태의 Section 제목을 만나기 전까지의 영역에서
 * "Label 칸 → valueOffset칸 뒤 Value 칸" 패턴을 전부 찾아 하나의 가상 단일 행 Table로
 * 만든다. 값이 우연히 일치하지 않는 Header는 buildMappingRules 단계에서 자연히
 * 걸러지므로(양쪽에 동일 이름이 있어야만 Rule이 생성됨), 이 단계에서는 넓게 수집해도
 * 안전하다.
 */
export function extractLabelValueTable(grid: string[][], valueOffset = 2): SheetTable {
  const headers: string[] = [];
  const values: string[] = [];
  const seen = new Set<string>();

  for (const row of grid) {
    if (isSectionBoundary(row)) break;
    if (isBlankRow(row)) continue;

    for (let col = 0; col < row.length; col++) {
      const label = (row[col] ?? "").trim();
      if (!label) continue;
      const normalized = normalizeHeader(label);
      if (seen.has(normalized)) continue;

      const rawValue = row[col + valueOffset];
      seen.add(normalized);
      headers.push(label);
      values.push(rawValue && rawValue.trim() !== "" ? rawValue.trim() : "");
    }
  }

  return { headers, rows: [values] };
}

/**
 * Header Row에 anchorText가 포함된 행을 찾아, 그 아래 실제 데이터 행들과 함께
 * SheetTable로 반환한다. Header 직후 빈 행이 여러 개 있어도(실제 W3 문서에서 확인됨)
 * 데이터가 시작되기 전까지는 중단하지 않는다 — 데이터가 한 번이라도 나온 뒤에
 * 빈 행이 3개 연속되거나 다음 Section 제목을 만나면 중단한다.
 */
export function findRepeatingTable(
  grid: string[][],
  anchorText: string,
  maxScanRows = 60,
): SheetTable | null {
  const normalizedAnchor = normalizeHeader(anchorText);
  const headerRowIndex = grid.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell ?? "") === normalizedAnchor),
  );
  if (headerRowIndex === -1) return null;

  const headers = grid[headerRowIndex];
  const rows: string[][] = [];
  let blankStreakAfterData = 0;

  const scanEnd = Math.min(grid.length, headerRowIndex + 1 + maxScanRows);
  for (let i = headerRowIndex + 1; i < scanEnd; i++) {
    const row = grid[i] ?? [];
    if (isSectionBoundary(row)) break;

    if (isBlankRow(row)) {
      if (rows.length > 0) {
        blankStreakAfterData += 1;
        if (blankStreakAfterData >= 3) break;
      }
      continue;
    }

    blankStreakAfterData = 0;
    rows.push(row);
  }

  return { headers, rows };
}
