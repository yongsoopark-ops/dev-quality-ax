import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { isBlankRow, isSectionBoundary } from "@/lib/sheetAutomation/sheetGridReader";
import type { BasicInfoFieldPlan, BasicInfoPlan } from "@/lib/sheetAutomation/write/types";

/**
 * 이번 규칙에서는 W2와 이름이 같은 W3 상단 기본정보 Label을 전부 자동 입력 대상으로
 * 삼는다(산출물 ID 포함 — 과거 "산출물 ID 제외" 로직은 폐기됐다, 요청사항 2/28).
 * "적용 기종"처럼 W2/W3 어느 한쪽에만 있는 Label은 Exact Match 자체가 성립하지 않아
 * 자연히 제외된다 — 별도 예외 목록이 필요 없다.
 */
const VALUE_OFFSET = 2;

/** 샘플 차수처럼 W2 값과 무관하게 항상 고정값을 쓰는 W3 Label. */
const FIXED_FIELDS: { label: string; value: string }[] = [{ label: "샘플 차수", value: "1차" }];

interface LabelPosition {
  label: string;
  row: number;
  valueCol: number;
  value: string;
}

/** Section 경계(■.../N. ...)를 만나기 전까지, Grid 전체에서 Label 위치를 전부 찾는다. */
function findLabelPositions(grid: string[][]): LabelPosition[] {
  const positions: LabelPosition[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (isSectionBoundary(row)) break;
    if (isBlankRow(row)) continue;
    for (let col = 0; col < row.length; col++) {
      const label = (row[col] ?? "").trim();
      if (!label) continue;
      const value = (row[col + VALUE_OFFSET] ?? "").trim();
      positions.push({ label, row: r, valueCol: col + VALUE_OFFSET, value });
    }
  }
  return positions;
}

export function buildBasicInfoPlan(w2Grid: string[][], w3Grid: string[][]): BasicInfoPlan {
  const w2Labels = findLabelPositions(w2Grid);
  const w3Labels = findLabelPositions(w3Grid);

  const w2ByNormalized = new Map<string, LabelPosition>();
  for (const l of w2Labels) {
    if (!w2ByNormalized.has(normalizeHeader(l.label))) w2ByNormalized.set(normalizeHeader(l.label), l);
  }

  const fields: BasicInfoFieldPlan[] = [];
  const seenW3Labels = new Set<string>();

  for (const w3Label of w3Labels) {
    const normalized = normalizeHeader(w3Label.label);
    if (seenW3Labels.has(normalized)) continue;
    const w2Match = w2ByNormalized.get(normalized);
    if (w2Match && w2Match.value !== "") {
      seenW3Labels.add(normalized);
      fields.push({
        label: w3Label.label,
        value: w2Match.value,
        targetRow: w3Label.row,
        targetCol: w3Label.valueCol,
        isFixed: false,
      });
    }
  }

  for (const fixed of FIXED_FIELDS) {
    const normalized = normalizeHeader(fixed.label);
    if (seenW3Labels.has(normalized)) continue;
    const w3Label = w3Labels.find((l) => normalizeHeader(l.label) === normalized);
    if (!w3Label) continue;
    seenW3Labels.add(normalized);
    fields.push({ label: fixed.label, value: fixed.value, targetRow: w3Label.row, targetCol: w3Label.valueCol, isFixed: true });
  }

  return { fields };
}
