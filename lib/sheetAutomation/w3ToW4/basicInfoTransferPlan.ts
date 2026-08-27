import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { isBlankRow, isSectionBoundary } from "@/lib/sheetAutomation/sheetGridReader";

/**
 * W3 상단 기본정보를 W4로 이관한다. write/basicInfo.ts(W2→W3)와 같은 "Label 2칸
 * 오른쪽 = Value" Form을 그대로 재사용하지만, 보호 정책은 완전히 다르다 —
 * W2→W3는 항상 최신 값으로 덮어쓰지만, W3→W4는 W4에 이미 담당자가 입력한 값이
 * 있으면 절대 덮어쓰지 않는다(요청사항 "기존 수기값 보호"). 이 차이 때문에 로직을
 * write/basicInfo.ts에서 import하지 않고 이 Module 안에 독립적으로 둔다 —
 * W2→W3 코드는 전혀 건드리지 않는다.
 */
const VALUE_OFFSET = 2;

/**
 * 이관 대상 Label만 명시적으로 나열한다 — "산출물 ID"는 W3/W4 양쪽에 동일 Label이
 * 있어도 절대 포함하지 않는다(W4 산출물 ID 보호). "적용 기종"은 W3에 대응 Label이
 * 없어 애초에 이 목록에도 없다 — Exact Match가 성립하지 않으면 자동으로 제외된다.
 */
const TRANSFERABLE_LABELS = [
  "품목",
  "작성자",
  "차기 샘플 입고일",
  "시작일",
  "제품명",
  "목표 출시일",
  "완료일",
  "대상 기종",
  "샘플 차수",
] as const;

interface LabelPosition {
  label: string;
  row: number;
  valueCol: number;
  value: string;
}

/** Section 경계(■.../N. ...)를 만나기 전까지, Grid 상단에서 Label 위치를 전부 찾는다.
 * 고정 Row/Cell 주소를 쓰지 않고 매번 실제 위치를 다시 스캔한다. */
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

export type BasicInfoTransferStatus = "FILL" | "PROTECTED" | "NO_SOURCE_VALUE";

export interface BasicInfoTransferItem {
  label: string;
  value: string;
  targetRow: number;
  targetCol: number;
  status: BasicInfoTransferStatus;
}

export interface BasicInfoTransferPlan {
  items: BasicInfoTransferItem[];
}

/**
 * W3/W4 양쪽에서 Label 위치를 찾아 Exact Match로 짝짓는다. W4 Value가 이미 채워져
 * 있으면 FILL 대상에서 제외하고 PROTECTED로 표시만 한다(절대 덮어쓰지 않음).
 */
export function buildBasicInfoTransferPlan(w3Grid: string[][], w4Grid: string[][]): BasicInfoTransferPlan {
  const w3Labels = findLabelPositions(w3Grid);
  const w4Labels = findLabelPositions(w4Grid);

  const w3ByNormalized = new Map<string, LabelPosition>();
  for (const l of w3Labels) {
    if (!w3ByNormalized.has(normalizeHeader(l.label))) w3ByNormalized.set(normalizeHeader(l.label), l);
  }
  const w4ByNormalized = new Map<string, LabelPosition>();
  for (const l of w4Labels) {
    if (!w4ByNormalized.has(normalizeHeader(l.label))) w4ByNormalized.set(normalizeHeader(l.label), l);
  }

  const items: BasicInfoTransferItem[] = [];
  for (const label of TRANSFERABLE_LABELS) {
    const normalized = normalizeHeader(label);
    const w4Match = w4ByNormalized.get(normalized);
    if (!w4Match) continue; // W4에 동일 Label 자체가 없으면 대상이 아니다.

    const w3Match = w3ByNormalized.get(normalized);
    if (!w3Match || w3Match.value === "") {
      items.push({ label, value: "", targetRow: w4Match.row, targetCol: w4Match.valueCol, status: "NO_SOURCE_VALUE" });
      continue;
    }

    items.push({
      label,
      value: w3Match.value,
      targetRow: w4Match.row,
      targetCol: w4Match.valueCol,
      status: w4Match.value === "" ? "FILL" : "PROTECTED",
    });
  }

  return { items };
}
