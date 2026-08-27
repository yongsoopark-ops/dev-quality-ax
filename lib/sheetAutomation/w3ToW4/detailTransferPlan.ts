import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { isBlankRow } from "@/lib/sheetAutomation/sheetGridReader";
import { resolveTargetSection } from "@/lib/sheetAutomation/write/sectionRouting";
import { scanVariableHeightSections, type VariableHeightSection } from "@/lib/sheetAutomation/w3ToW4/detailBlockScan";
import type { DetailBlockToInsert, DetailSectionInsertPlan, DetailTransferItem, PlaceholderReuseInfo } from "@/lib/sheetAutomation/w3ToW4/types";

export interface DetailTransferPlanResult {
  items: DetailTransferItem[];
  sectionInserts: DetailSectionInsertPlan[];
}

function findColumnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => normalizeHeader(h ?? "") === normalizeHeader(name));
}

/**
 * 이 Section이 "아직 아무것도 이관되지 않은 pristine 상태"인지 엄격하게 판정한다
 * (요청사항 3) — 애매하면 무조건 false(재사용 금지). 다음을 모두 만족해야 한다:
 *  - 이 Section에 검사 고정행(Block)이 정확히 1개만 있다(자동생성 Block 없음)
 *  - 그 Block의 Data Row에 검사 순서/검사 항목명이 둘 다 비어 있다
 *  - Header 다음 행부터 Section 끝까지 전부 완전히 빈 행이다(중간 어디에도
 *    담당자 수기 데이터나 자유작성 내용이 없다)
 */
function checkPristinePlaceholder(
  w4Grid: string[][],
  section: VariableHeightSection,
): { headerRowIndex: number; dataRowIndex: number; placeholderHeight: number } | null {
  if (section.blocks.length !== 1) return null;
  const block = section.blocks[0];
  if (block.order !== "") return null;

  const itemCol = findColumnIndex(block.headerValues, "검사 항목");
  const dataRow = w4Grid[block.headerRowIndex + 1] ?? [];
  const item = itemCol !== -1 ? (dataRow[itemCol] ?? "").trim() : "";
  if (item !== "") return null;

  for (let r = block.headerRowIndex + 1; r < section.sectionEndRowIndex; r++) {
    if (!isBlankRow(w4Grid[r] ?? [])) return null;
  }

  return {
    headerRowIndex: block.headerRowIndex,
    dataRowIndex: block.headerRowIndex + 1,
    placeholderHeight: section.sectionEndRowIndex - block.headerRowIndex,
  };
}

/**
 * W3에서 이관 대상으로 선정된 각 검사 항목의 상세 결과 Block을 찾아 W4의 대응
 * Section으로 옮길 계획을 만든다. Section Routing은 W2→W3와 완전히 동일한
 * Exact Match 테이블을 그대로 재사용한다(resolveTargetSection, 수정 없음).
 *
 * targetItems는 승인현황 이관 상태와 무관하게 "현재 W3에서 개선진행인 모든 항목"을
 * 그대로 받는다 — 이 함수 자체가 W4 상세영역 존재 여부를 독립적으로 다시 확인하므로,
 * 승인현황만 먼저 반영되고 상세 Block이 누락된 부분 실패 상태도 재실행 시 상세
 * Block만 안전하게 보완할 수 있다(요청사항 13).
 */
export function buildDetailTransferPlan(
  w3Grid: string[][],
  w4Grid: string[][],
  targetItems: { inspectionOrder: string; testType: string }[],
): DetailTransferPlanResult {
  const w3Sections = scanVariableHeightSections(w3Grid);
  const w4Sections = scanVariableHeightSections(w4Grid);

  const w4SectionNames = w4Sections.map((s) => s.sectionName).filter((n) => n !== "품질 승인 현황");
  const w3BlockByOrder = new Map<string, { sectionName: string; headerRowIndex: number; endRowIndexExclusive: number }>();
  for (const section of w3Sections) {
    if (section.sectionName === "품질 승인 현황") continue;
    for (const block of section.blocks) {
      if (block.order !== "") w3BlockByOrder.set(block.order, block);
    }
  }

  const w4SectionByName = new Map<string, VariableHeightSection>(w4Sections.map((s) => [s.sectionName, s]));
  const w4ExistingOrdersBySection = new Map<string, Set<string>>();
  const pristineBySection = new Map<string, { headerRowIndex: number; dataRowIndex: number; placeholderHeight: number }>();
  for (const section of w4Sections) {
    if (section.sectionName === "품질 승인 현황") continue;
    const orders = new Set(section.blocks.filter((b) => b.order !== "").map((b) => b.order));
    w4ExistingOrdersBySection.set(section.sectionName, orders);
    const pristine = checkPristinePlaceholder(w4Grid, section);
    if (pristine) pristineBySection.set(section.sectionName, pristine);
  }

  const items: DetailTransferItem[] = [];
  const newBlocksBySection = new Map<string, DetailBlockToInsert[]>();

  for (const target of targetItems) {
    const sourceBlock = w3BlockByOrder.get(target.inspectionOrder);
    if (!sourceBlock) {
      items.push({
        inspectionOrder: target.inspectionOrder,
        testType: target.testType,
        targetSection: null,
        sourceHeaderRowIndex: -1,
        sourceEndRowIndexExclusive: -1,
        status: "UNROUTABLE",
        note: `W3 하단에서 검사 순서 ${target.inspectionOrder}의 상세 검사 Block을 찾지 못했습니다.`,
      });
      continue;
    }

    const targetSection = resolveTargetSection(target.testType, w4SectionNames);
    if (!targetSection) {
      items.push({
        inspectionOrder: target.inspectionOrder,
        testType: target.testType,
        targetSection: null,
        sourceHeaderRowIndex: sourceBlock.headerRowIndex,
        sourceEndRowIndexExclusive: sourceBlock.endRowIndexExclusive,
        status: "UNROUTABLE",
        note: `"${target.testType}"과(와) 일치하는 W4 Section을 찾지 못했습니다.`,
      });
      continue;
    }

    const alreadyExists = w4ExistingOrdersBySection.get(targetSection)?.has(target.inspectionOrder) ?? false;
    if (alreadyExists) {
      items.push({
        inspectionOrder: target.inspectionOrder,
        testType: target.testType,
        targetSection,
        sourceHeaderRowIndex: sourceBlock.headerRowIndex,
        sourceEndRowIndexExclusive: sourceBlock.endRowIndexExclusive,
        status: "ALREADY_IN_W4",
        note: null,
      });
      continue;
    }

    const height = sourceBlock.endRowIndexExclusive - sourceBlock.headerRowIndex;

    // 이 Section이 아직 pristine이고, 이번이 그 Section에 배정되는 첫 신규 항목이면
    // 기존 placeholder를 재사용한다(요청사항 4/5) — 두 번째부터는 일반 신규 삽입.
    const pristine = pristineBySection.get(targetSection);
    const alreadyQueued = newBlocksBySection.has(targetSection);
    if (pristine && !alreadyQueued) {
      items.push({
        inspectionOrder: target.inspectionOrder,
        testType: target.testType,
        targetSection,
        sourceHeaderRowIndex: sourceBlock.headerRowIndex,
        sourceEndRowIndexExclusive: sourceBlock.endRowIndexExclusive,
        status: "FILL_PLACEHOLDER",
        note: null,
      });
      // newBlocksBySection에는 안 넣는다 — reusePlaceholder로 별도 처리한다.
      // 대신 "이 Section은 이미 1번째가 배정됐다"는 표시로 빈 배열을 만들어 둔다.
      newBlocksBySection.set(targetSection, []);
      continue;
    }

    items.push({
      inspectionOrder: target.inspectionOrder,
      testType: target.testType,
      targetSection,
      sourceHeaderRowIndex: sourceBlock.headerRowIndex,
      sourceEndRowIndexExclusive: sourceBlock.endRowIndexExclusive,
      status: "NEW_BLOCK",
      note: null,
    });
    const list = newBlocksBySection.get(targetSection) ?? [];
    list.push({
      inspectionOrder: target.inspectionOrder,
      sourceHeaderRowIndex: sourceBlock.headerRowIndex,
      sourceEndRowIndexExclusive: sourceBlock.endRowIndexExclusive,
      height,
    });
    newBlocksBySection.set(targetSection, list);
  }

  const sectionInserts: DetailSectionInsertPlan[] = [];
  for (const [sectionName, blocks] of newBlocksBySection) {
    const section = w4SectionByName.get(sectionName);
    if (!section) continue;

    const sortByOrder = (a: { inspectionOrder: string }, b: { inspectionOrder: string }) => {
      const na = Number(a.inspectionOrder);
      const nb = Number(b.inspectionOrder);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.inspectionOrder.localeCompare(b.inspectionOrder);
    };

    const placeholderItem = items.find((i) => i.targetSection === sectionName && i.status === "FILL_PLACEHOLDER");
    let reusePlaceholder: PlaceholderReuseInfo | null = null;

    if (placeholderItem) {
      const pristine = pristineBySection.get(sectionName)!;
      const sourceHeight = placeholderItem.sourceEndRowIndexExclusive - placeholderItem.sourceHeaderRowIndex;
      reusePlaceholder = {
        inspectionOrder: placeholderItem.inspectionOrder,
        sourceHeaderRowIndex: placeholderItem.sourceHeaderRowIndex,
        sourceEndRowIndexExclusive: placeholderItem.sourceEndRowIndexExclusive,
        sourceHeight,
        targetHeaderRowIndex: pristine.headerRowIndex,
        placeholderHeight: pristine.placeholderHeight,
      };
    }

    // insertBeforeRowIndex는 항상 "원래(재사용 반영 전) Section 끝" 좌표로 둔다 —
    // placeholder가 넘쳐서 추가 삽입이 필요한 경우의 위치 계산은 실행 시점에
    // (오버플로 삽입 이후 blocks가 이어붙는 식으로) 처리한다.
    const sorted = [...blocks].sort(sortByOrder);
    sectionInserts.push({ sectionName, insertBeforeRowIndex: section.sectionEndRowIndex, reusePlaceholder, blocks: sorted });
  }

  return { items, sectionInserts };
}
