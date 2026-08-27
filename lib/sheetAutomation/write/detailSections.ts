import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { isBlankRow } from "@/lib/sheetAutomation/sheetGridReader";
import type { SheetTable } from "@/lib/sheetAutomation/types";
import { resolveTargetSection } from "@/lib/sheetAutomation/write/sectionRouting";
import {
  DETAIL_WRITABLE_HEADERS,
  INSPECTION_BLOCK_HEADER_SIGNATURE,
  type DetailBlockItem,
  type DetailSectionPlan,
  type DetailSlot,
} from "@/lib/sheetAutomation/write/types";

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

interface DetectedDetailSection {
  sectionName: string;
  titleRowIndex: number;
  sectionEndRowIndex: number;
  slots: DetailSlot[];
}

/**
 * ■ 섹션마다 검사 항목 1개 = Header+Data+Spacer 3행 1묶음이다(요청사항 6/9). Header
 * Signature가 일치하는 행을 찾아 그 자리를 슬롯의 시작으로 보고, 바로 다음 2행을
 * Data/Spacer로 취급한다 — 실제 Template은 처음엔 슬롯이 1개(Header+빈2행)만 있고,
 * 이 Engine이 만드는 슬롯도 항상 이 3행 단위이므로 위치 계산이 어긋나지 않는다.
 */
function detectDetailSections(w3Grid: string[][]): DetectedDetailSection[] {
  const titleRows: { sectionName: string; rowIndex: number }[] = [];
  w3Grid.forEach((row, i) => {
    const name = isSectionTitleRow(row);
    if (name) titleRows.push({ sectionName: name, rowIndex: i });
  });

  return titleRows.map((title, idx) => {
    const sectionEndRowIndex = titleRows[idx + 1]?.rowIndex ?? w3Grid.length;
    const slots: DetailSlot[] = [];
    for (let r = title.rowIndex + 1; r < sectionEndRowIndex; r++) {
      if (!isInspectionHeaderRow(w3Grid[r] ?? [])) continue;
      const headerRowIndex = r;
      const dataRowIndex = r + 1;
      const spacerRowIndex = r + 2;
      const headerRow = w3Grid[headerRowIndex] ?? [];
      const dataRow = w3Grid[dataRowIndex] ?? [];
      const orderCol = findColumnIndex(headerRow, "순");
      const existingOrder = orderCol !== -1 ? (dataRow[orderCol] ?? "").trim() : "";
      slots.push({ headerRowIndex, dataRowIndex, spacerRowIndex, existingOrder });
    }
    return { sectionName: title.sectionName, titleRowIndex: title.rowIndex, sectionEndRowIndex, slots };
  });
}

export interface DetailPlanResult {
  sections: DetailSectionPlan[];
  items: DetailBlockItem[];
}

/**
 * "■ 품질 승인 현황"이 아닌 개별 시험 종류 섹션들에 대한 Write Plan을 만든다.
 * 요청사항 13/14 — 이미 이 섹션에 자동화가 지나간 흔적(순 값이 있는 슬롯)이 있는데
 * 항목 수가 더 늘어나 새 슬롯 삽입이 필요하면, 조용히 삽입하지 않고 NEEDS_REVIEW로
 * 돌린다(구조적 변경은 사용자 확인이 필요하다). 흔적이 전혀 없는 최초 실행이면
 * 자유롭게 필요한 만큼 슬롯을 만든다(요청사항 14).
 */
export function buildDetailSectionsPlan(w3Grid: string[][], w2RepeatingTable: SheetTable): DetailPlanResult {
  const detected = detectDetailSections(w3Grid);
  const sectionNames = detected.filter((s) => s.sectionName !== "품질 승인 현황").map((s) => s.sectionName);
  const sectionByName = new Map(detected.map((s) => [s.sectionName, s]));

  const w2Headers = w2RepeatingTable.headers;
  const orderIdx = findColumnIndex(w2Headers, "검사 순서");
  const itemIdx = findColumnIndex(w2Headers, "검사 항목");
  const importanceIdx = findColumnIndex(w2Headers, "검사 중요도");
  const testTypeIdx = findColumnIndex(w2Headers, "시험 종류");
  const criteriaIdx = findColumnIndex(w2Headers, "판정 기준");

  // Section별로 이번 실행에서 필요한 W2 항목들을 먼저 모은다.
  const itemsBySection = new Map<
    string,
    { w2RowIndex: number; order: string; item: string; importance: string; criteria: string; testType: string }[]
  >();
  const unroutable: DetailBlockItem[] = [];

  for (let r = 0; r < w2RepeatingTable.rows.length; r++) {
    const row = w2RepeatingTable.rows[r];
    const testType = testTypeIdx !== -1 ? (row[testTypeIdx] ?? "").trim() : "";
    const order = orderIdx !== -1 ? (row[orderIdx] ?? "").trim() : "";
    const item = itemIdx !== -1 ? (row[itemIdx] ?? "").trim() : "";
    const importance = importanceIdx !== -1 ? (row[importanceIdx] ?? "").trim() : "";
    const criteria = criteriaIdx !== -1 ? (row[criteriaIdx] ?? "").trim() : "";

    const targetSection = resolveTargetSection(testType, sectionNames);
    if (!targetSection) {
      unroutable.push({
        w2RowIndex: r,
        inspectionOrder: order,
        inspectionItem: item,
        importance,
        criteria,
        testType,
        targetSection: null,
        targetSlot: null,
        status: "UNROUTABLE",
        note: `"${testType}"과(와) 일치하는 W3 Section을 찾지 못해 자동 배정하지 않았습니다.`,
      });
      continue;
    }
    const list = itemsBySection.get(targetSection) ?? [];
    list.push({ w2RowIndex: r, order, item, importance, criteria, testType });
    itemsBySection.set(targetSection, list);
  }

  const sections: DetailSectionPlan[] = [];
  const items: DetailBlockItem[] = [...unroutable];

  for (const sectionName of sectionNames) {
    const section = sectionByName.get(sectionName);
    const requiredItems = itemsBySection.get(sectionName) ?? [];
    if (!section) continue;

    const existingByOrder = new Map<string, DetailSlot>();
    const availableSlots: DetailSlot[] = [];
    for (const slot of section.slots) {
      if (slot.existingOrder !== "") existingByOrder.set(slot.existingOrder, slot);
      else availableSlots.push(slot);
    }

    const matchedOrders = new Set<string>();
    let blankQueueIdx = 0;
    let newBlocksNeeded = 0;

    for (const w2Item of requiredItems) {
      const existingSlot = w2Item.order !== "" ? existingByOrder.get(w2Item.order) : undefined;

      if (existingSlot) {
        matchedOrders.add(w2Item.order);
        const dataRow = w3Grid[existingSlot.dataRowIndex] ?? [];
        const headerRow = w3Grid[existingSlot.headerRowIndex] ?? [];
        const itemCol = findColumnIndex(headerRow, "검사 항목");
        const importanceCol = findColumnIndex(headerRow, "검사 중요도");
        const criteriaCol = findColumnIndex(headerRow, "판정 기준");
        const changed =
          (itemCol !== -1 && (dataRow[itemCol] ?? "").trim() !== w2Item.item) ||
          (importanceCol !== -1 && (dataRow[importanceCol] ?? "").trim() !== w2Item.importance) ||
          (criteriaCol !== -1 && (dataRow[criteriaCol] ?? "").trim() !== w2Item.criteria);

        items.push({
          w2RowIndex: w2Item.w2RowIndex,
          inspectionOrder: w2Item.order,
          inspectionItem: w2Item.item,
          importance: w2Item.importance,
          criteria: w2Item.criteria,
          testType: w2Item.testType,
          targetSection: sectionName,
          targetSlot: { headerRowIndex: existingSlot.headerRowIndex, dataRowIndex: existingSlot.dataRowIndex },
          status: changed ? "MATCHED_UPDATE" : "MATCHED_NO_CHANGE",
          note: null,
        });
      } else if (blankQueueIdx < availableSlots.length) {
        const slot = availableSlots[blankQueueIdx];
        blankQueueIdx += 1;
        items.push({
          w2RowIndex: w2Item.w2RowIndex,
          inspectionOrder: w2Item.order,
          inspectionItem: w2Item.item,
          importance: w2Item.importance,
          criteria: w2Item.criteria,
          testType: w2Item.testType,
          targetSection: sectionName,
          targetSlot: { headerRowIndex: slot.headerRowIndex, dataRowIndex: slot.dataRowIndex },
          status: "FILL_BLANK_SLOT",
          note: null,
        });
      } else {
        newBlocksNeeded += 1;
        items.push({
          w2RowIndex: w2Item.w2RowIndex,
          inspectionOrder: w2Item.order,
          inspectionItem: w2Item.item,
          importance: w2Item.importance,
          criteria: w2Item.criteria,
          testType: w2Item.testType,
          targetSection: sectionName,
          targetSlot: null,
          status: "NEW_BLOCK",
          note: null,
        });
      }
    }

    const orphanedOrders = [...existingByOrder.keys()].filter((o) => !matchedOrders.has(o));
    // 이미 자동화가 지나간 흔적(매칭된 기존 슬롯)이 있는 상태에서 새 슬롯이 더
    // 필요해졌다면 — 항목이 늘어난 구조적 변경일 수 있으므로 조용히 삽입하지 않는다.
    const requiresReviewForInsert = newBlocksNeeded > 0 && existingByOrder.size > 0;

    if (requiresReviewForInsert) {
      for (const item of items) {
        if (item.targetSection === sectionName && item.status === "NEW_BLOCK") {
          item.status = "NEEDS_REVIEW";
          item.note = `"${sectionName}" Section은 이미 이전 실행 결과가 있어, 신규 항목을 자동으로 추가하지 않았습니다. 구조 변경 여부를 확인해주세요.`;
        }
      }
    }

    const templateHeaderRowIndex = section.slots[0]?.headerRowIndex ?? section.titleRowIndex + 1;
    const blocksToInsert = requiresReviewForInsert ? 0 : newBlocksNeeded;
    // 기존 Template이 마지막 슬롯 뒤에 Spacer 없이 곧장 다음 Section Title로
    // 이어지는 경우(예: 이 실제 문서의 "신뢰성" Section)가 있을 수 있다 — 그 상태에서
    // 그대로 새 Block을 삽입하면 기존 마지막 항목과 새 Block이 빈 행 없이 붙어버린다.
    const rowBeforeBoundary = w3Grid[section.sectionEndRowIndex - 1] ?? [];
    const needsLeadingSpacer = blocksToInsert > 0 && !isBlankRow(rowBeforeBoundary);
    sections.push({
      sectionName,
      templateHeaderRowIndex,
      templateDataRowIndex: section.slots[0]?.dataRowIndex ?? section.titleRowIndex + 2,
      templateHeaderValues: w3Grid[templateHeaderRowIndex] ?? [],
      existingSlotCount: section.slots.length,
      requiredSlotCount: requiredItems.length,
      blocksToInsert,
      insertBeforeRowIndex: section.sectionEndRowIndex,
      requiresReviewForInsert,
      needsLeadingSpacer,
      orphanedOrders,
    });
  }

  return { sections, items };
}

export { DETAIL_WRITABLE_HEADERS };
