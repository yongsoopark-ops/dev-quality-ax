import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { isBlankRow, isSectionBoundary } from "@/lib/sheetAutomation/sheetGridReader";
import type { SheetTable } from "@/lib/sheetAutomation/types";
import type { ApprovalStatusPlan, ApprovalStatusRowPlan } from "@/lib/sheetAutomation/write/types";

const APPROVAL_STATUS_TITLE = "■ 품질 승인 현황";

/** 요청사항 3 — 이 5개만 자동 입력한다. 검사 목적/품질 리스크/검사 방법/판정 기준은 금지. */
const APPROVAL_MAPPING = [
  { w2Header: "검사 순서", w3Header: "검사 순서" },
  { w2Header: "유형", w3Header: "유형" },
  { w2Header: "시험 종류", w3Header: "시험 종류" },
  { w2Header: "검사 항목", w3Header: "검사 항목" },
  { w2Header: "검사 중요도", w3Header: "검사 중요도" },
] as const;

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

/**
 * "■ 품질 승인 현황"은 상세 검사영역과 달리 Header 1개 + 반복 Data Row 구조다
 * (Header 반복도, Spacer도 없다 — 요청사항 4). 이미 있는 Data Row(빈 행 포함)를
 * 먼저 채우고, 부족한 만큼만 새 행을 추가한다. "검사 순서"를 식별 키로 써서
 * 재실행 시 같은 항목을 다시 찾아 갱신하고 중복 행을 만들지 않는다(요청사항 13).
 */
export function buildApprovalStatusPlan(w3Grid: string[][], w2RepeatingTable: SheetTable): ApprovalStatusPlan | null {
  const titleRowIndex = w3Grid.findIndex((row) => (row.find((c) => c && c.trim() !== "") ?? "").trim() === APPROVAL_STATUS_TITLE);
  if (titleRowIndex === -1) return null;

  const headerRowIndex = titleRowIndex + 1;
  const headerRow = w3Grid[headerRowIndex] ?? [];

  let nextSectionTitleRowIndex = w3Grid.length;
  for (let r = headerRowIndex + 1; r < w3Grid.length; r++) {
    if (isSectionBoundary(w3Grid[r] ?? [])) {
      nextSectionTitleRowIndex = r;
      break;
    }
  }

  // 품질 승인 현황은 상세영역과 달리 "항목 사이"에는 빈 행을 절대 넣지 않고,
  // 마지막 항목 뒤에만 빈 행 1개를 둔다(요청사항 — Spacer 규칙 분리). 이미 그
  // 마지막 빈 행이 있으면(재실행) 그 행은 채울 수 있는 "빈 Data Row 용량"이
  // 아니라 구분용 Spacer로 취급해 용량 스캔에서 제외한다 — 그래야 재실행 시
  // 항목이 그 자리를 차지해 마지막 빈 행이 사라지는 사고를 막는다.
  const hasExistingTrailingBlank =
    nextSectionTitleRowIndex > headerRowIndex + 1 && isBlankRow(w3Grid[nextSectionTitleRowIndex - 1] ?? []);
  const dataAreaEnd = hasExistingTrailingBlank ? nextSectionTitleRowIndex - 1 : nextSectionTitleRowIndex;
  const needsTrailingBlank = !hasExistingTrailingBlank;
  // 신규 항목은 이 위치(기존 용량 바로 뒤, Trailing Blank 바로 앞)에 삽입한다.
  const insertBeforeRowIndex = dataAreaEnd;

  const existingRows: { rowIndex: number; order: string }[] = [];
  const orderColInW3 = findColumnIndex(headerRow, "검사 순서");
  for (let r = headerRowIndex + 1; r < dataAreaEnd; r++) {
    const row = w3Grid[r] ?? [];
    const order = orderColInW3 !== -1 ? (row[orderColInW3] ?? "").trim() : "";
    existingRows.push({ rowIndex: r, order });
  }

  const existingByOrder = new Map<string, number>();
  const availableBlankRows: number[] = [];
  for (const er of existingRows) {
    if (er.order !== "") existingByOrder.set(er.order, er.rowIndex);
    else availableBlankRows.push(er.rowIndex);
  }

  const targetColByW2Header = new Map<string, number>();
  for (const m of APPROVAL_MAPPING) {
    const col = findColumnIndex(headerRow, m.w3Header);
    if (col !== -1) targetColByW2Header.set(m.w2Header, col);
  }

  const w2ColByHeader = new Map<string, number>();
  for (const m of APPROVAL_MAPPING) {
    const idx = findColumnIndex(w2RepeatingTable.headers, m.w2Header);
    if (idx !== -1) w2ColByHeader.set(m.w2Header, idx);
  }
  const orderIdxInW2 = w2ColByHeader.get("검사 순서") ?? -1;

  const matchedOrders = new Set<string>();
  const rows: ApprovalStatusRowPlan[] = [];
  let blankQueueIdx = 0;
  let newRowsNeeded = 0;

  for (let r = 0; r < w2RepeatingTable.rows.length; r++) {
    const row = w2RepeatingTable.rows[r];
    const order = orderIdxInW2 !== -1 ? (row[orderIdxInW2] ?? "").trim() : "";

    const cells: { targetCol: number; value: string }[] = [];
    for (const m of APPROVAL_MAPPING) {
      const srcCol = w2ColByHeader.get(m.w2Header);
      const targetCol = targetColByW2Header.get(m.w2Header);
      if (srcCol === undefined || targetCol === undefined) continue;
      cells.push({ targetCol, value: (row[srcCol] ?? "").trim() });
    }

    let targetRowIndex: number | null = null;
    let status: ApprovalStatusRowPlan["status"];

    if (order !== "" && existingByOrder.has(order)) {
      targetRowIndex = existingByOrder.get(order) ?? null;
      matchedOrders.add(order);
      const existingRowValues = (targetRowIndex !== null ? w3Grid[targetRowIndex] : undefined) ?? [];
      const changed = cells.some((c) => (existingRowValues[c.targetCol] ?? "").trim() !== c.value);
      status = changed ? "MATCHED_UPDATE" : "MATCHED_NO_CHANGE";
    } else if (blankQueueIdx < availableBlankRows.length) {
      targetRowIndex = availableBlankRows[blankQueueIdx];
      blankQueueIdx += 1;
      status = "FILL_BLANK_ROW";
    } else {
      status = "NEW_ROW";
      newRowsNeeded += 1;
    }

    rows.push({ w2RowIndex: r, inspectionOrder: order, cells, targetRowIndex, status });
  }

  const orphanedOrders = [...existingByOrder.keys()].filter((o) => !matchedOrders.has(o));

  // 신규 행의 서식/구조를 복제할 Template Source — 이미 존재하는(Header 아닌)
  // 첫 Data Row를 그대로 쓴다. Header를 복제하면 안 된다(요청사항 2).
  const templateRowIndex = existingRows.length > 0 ? existingRows[0].rowIndex : null;

  return {
    headerRowIndex,
    insertBeforeRowIndex,
    existingRowCapacity: existingRows.length,
    rowsToInsert: newRowsNeeded,
    needsTrailingBlank,
    rows,
    orphanedOrders,
    templateRowIndex,
    headerValues: headerRow,
  };
}
