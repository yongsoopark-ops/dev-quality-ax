import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";
import { extractLabelValueTable, findRepeatingTable, isBlankRow, isSectionBoundary } from "@/lib/sheetAutomation/sheetGridReader";

/**
 * W2/W3/W4 자동화가 실제로 의존하는 구조(필수 Label / 승인현황 Header / 상세 Header
 * Signature / 필수 Section Title / 지원 Version)를 코드의 별도 Schema로 관리한다.
 * Preflight가 실제 Sheet를 이 Schema와 대조해 구조가 어긋나면 Write를 차단한다 —
 * 이름이 비슷하다고 같은 의미로 추정하지 않고(추측 매핑 금지), Exact Match로만
 * 비교한다. 기존 W2→W3/W3→W4 매핑·Write 로직은 이 파일에서 전혀 건드리지 않는다 —
 * 여기서는 오직 "쓰기 전에 구조가 맞는지" 판정만 한다.
 */

export type TemplateCompatibilityStatus = "COMPATIBLE" | "TEMPLATE_CHANGED";

export interface CompatibilityIssue {
  message: string;
}

export interface TemplateCompatibilityInfo {
  version: string;
  status: TemplateCompatibilityStatus;
  issues: string[];
}

export interface RepeatingTableSchema {
  /** Header Row를 찾기 위한 고유 식별 문자열(W2_TO_W3_REPEATING_ANCHOR와 동일 개념). */
  anchorText: string;
  requiredHeaders: string[];
}

export interface TemplateSchema {
  version: string;
  /** 상단 기본정보에 반드시 있어야 하는 Label. */
  requiredLabels: string[];
  /** "■ 품질 승인 현황" Header에 반드시 있어야 하는 열 이름 — W3/W4만 해당. */
  approvalHeader?: string[];
  /** 상세 검사영역 Header Signature — W3/W4만 해당. */
  detailHeaderSignature?: string[];
  /** 반드시 존재해야 하는 "■ Section" 제목(■ 기호 없이). */
  requiredSections?: string[];
  /** W2의 "1. 검사 계획"처럼 Label/Section이 아닌 반복 Table — W2만 해당. */
  repeatingTable?: RepeatingTableSchema;
}

/** 문서에 명시적으로 Version이 적혀 있을 때 찾는 Label 이름. */
export const TEMPLATE_VERSION_LABEL = "템플릿 버전";

const INSPECTION_BLOCK_HEADER_SIGNATURE = ["순", "판정 일자", "검사 항목", "검사 중요도", "판정 기준", "종합 판정", "이슈 증상"];
const APPROVAL_HEADER_SIGNATURE = ["검사 순서", "유형", "시험 종류", "검사 항목", "검사 중요도", "종합 판정", "판정 사유", "조치 방향", "조치 사항"];
const DETAIL_SECTION_NAMES = ["외관", "구성품", "기능/성능", "규격", "신뢰성", "외부 의뢰"];

/**
 * 기존 현재 양식을 V1으로 등록한다(요청사항 4). 향후 V2가 추가돼도 이 Map에
 * 항목만 늘리면 되고, V1은 그대로 계속 지원된다 — 버전별 완전히 독립된 Schema다.
 */
export const W2_TEMPLATE_SCHEMAS: Record<string, TemplateSchema> = {
  V1: {
    version: "V1",
    requiredLabels: ["산출물 ID", "품목", "작성자", "차기 샘플 입고일", "시작일", "제품명", "목표 출시일", "완료일", "대상 기종"],
    repeatingTable: {
      anchorText: "검사 순서",
      requiredHeaders: ["검사 순서", "유형", "시험 종류", "검사 항목", "검사 중요도", "판정 기준"],
    },
  },
};

export const W3_TEMPLATE_SCHEMAS: Record<string, TemplateSchema> = {
  V1: {
    version: "V1",
    requiredLabels: ["산출물 ID", "품목", "작성자", "차기 샘플 입고일", "시작일", "제품명", "목표 출시일", "완료일", "대상 기종", "샘플 차수"],
    approvalHeader: APPROVAL_HEADER_SIGNATURE,
    detailHeaderSignature: INSPECTION_BLOCK_HEADER_SIGNATURE,
    requiredSections: ["품질 승인 현황", ...DETAIL_SECTION_NAMES],
  },
};

export const W4_TEMPLATE_SCHEMAS: Record<string, TemplateSchema> = {
  V1: {
    version: "V1",
    requiredLabels: ["산출물 ID", "품목", "작성자", "차기 샘플 입고일", "시작일", "제품명", "목표 출시일", "완료일", "대상 기종", "샘플 차수", "적용 기종"],
    approvalHeader: APPROVAL_HEADER_SIGNATURE,
    detailHeaderSignature: INSPECTION_BLOCK_HEADER_SIGNATURE,
    requiredSections: ["개선 변경점", "품질 승인 현황", ...DETAIL_SECTION_NAMES],
  },
};

function stripSectionMarker(cell: string): string {
  return cell.replace(/^■\s*/, "").replace(/^\d+\.\s*/, "").trim();
}

/** 문서 전체에서 "■.../N. ..." Section 제목들을 전부 모은다(마커 제외, 정규화). */
function findSectionTitles(grid: string[][]): Set<string> {
  const titles = new Set<string>();
  for (const row of grid) {
    if (!isSectionBoundary(row)) continue;
    const firstCell = (row.find((c) => c && c.trim() !== "") ?? "").trim();
    titles.add(normalizeHeader(stripSectionMarker(firstCell)));
  }
  return titles;
}

/** 이 Section 제목 바로 다음의 첫 비어있지 않은 행을 Header 후보로 본다. */
function findFirstHeaderRowInSection(grid: string[][], sectionTitle: string): string[] | null {
  const normalizedTitle = normalizeHeader(sectionTitle);
  let sectionStart = -1;
  for (let r = 0; r < grid.length; r++) {
    if (!isSectionBoundary(grid[r])) continue;
    const firstCell = (grid[r].find((c) => c && c.trim() !== "") ?? "").trim();
    if (normalizeHeader(stripSectionMarker(firstCell)) === normalizedTitle) {
      sectionStart = r;
      break;
    }
  }
  if (sectionStart === -1) return null;

  for (let r = sectionStart + 1; r < grid.length; r++) {
    if (isSectionBoundary(grid[r])) return null;
    if (isBlankRow(grid[r])) continue;
    return grid[r];
  }
  return null;
}

/** 문서 상단 Label 목록에서 명시적 Version 값을 찾는다 — 없으면 null. */
function detectExplicitVersion(grid: string[][]): string | null {
  const table = extractLabelValueTable(grid);
  const idx = table.headers.findIndex((h) => normalizeHeader(h) === normalizeHeader(TEMPLATE_VERSION_LABEL));
  if (idx === -1) return null;
  const value = (table.rows[0]?.[idx] ?? "").trim();
  return value === "" ? null : value;
}

function checkAgainstSchema(grid: string[][], schema: TemplateSchema): string[] {
  const issues: string[] = [];

  const labelTable = extractLabelValueTable(grid);
  const presentLabels = new Set(labelTable.headers.map((h) => normalizeHeader(h)));
  for (const label of schema.requiredLabels) {
    if (!presentLabels.has(normalizeHeader(label))) issues.push(`"${label}" Label 누락`);
  }

  if (schema.approvalHeader) {
    const headerRow = findFirstHeaderRowInSection(grid, "품질 승인 현황");
    if (headerRow) {
      const present = new Set(headerRow.filter((h) => h && h.trim() !== "").map((h) => normalizeHeader(h)));
      for (const h of schema.approvalHeader) {
        if (!present.has(normalizeHeader(h))) issues.push(`품질 승인 현황 "${h}" Header 누락`);
      }
    }
    // headerRow가 null이면 requiredSections 체크에서 이미 "■ 품질 승인 현황 Section
    // 미발견"으로 보고되므로 여기서 중복 보고하지 않는다.
  }

  if (schema.detailHeaderSignature && schema.requiredSections) {
    const detailSectionNames = schema.requiredSections.filter((s) => s !== "품질 승인 현황" && s !== "개선 변경점");
    for (const sectionName of detailSectionNames) {
      const headerRow = findFirstHeaderRowInSection(grid, sectionName);
      if (!headerRow) continue; // Section 자체 누락은 requiredSections 체크가 담당한다.
      const present = new Set(headerRow.filter((h) => h && h.trim() !== "").map((h) => normalizeHeader(h)));
      for (const h of schema.detailHeaderSignature) {
        if (!present.has(normalizeHeader(h))) issues.push(`"■ ${sectionName}" Section "${h}" Header 누락`);
      }
    }
  }

  if (schema.requiredSections) {
    const titles = findSectionTitles(grid);
    for (const section of schema.requiredSections) {
      if (!titles.has(normalizeHeader(section))) issues.push(`"■ ${section}" Section 미발견`);
    }
  }

  if (schema.repeatingTable) {
    const table = findRepeatingTable(grid, schema.repeatingTable.anchorText);
    if (!table) {
      issues.push(`"${schema.repeatingTable.anchorText}" 반복 Table을 찾지 못함`);
    } else {
      const present = new Set(table.headers.filter((h) => h && h.trim() !== "").map((h) => normalizeHeader(h)));
      for (const h of schema.repeatingTable.requiredHeaders) {
        if (!present.has(normalizeHeader(h))) issues.push(`"${h}" Header 누락`);
      }
    }
  }

  return issues;
}

/**
 * 실제 Sheet Grid를 Schema Registry와 대조한다. 문서에 Version이 명시돼 있으면
 * 그 Version의 Schema로만 검사하고(다른 Version과 매칭을 시도하지 않는다 — 요청사항
 * "추측 매핑 금지"), 없으면 V1으로 판정해 V1 Schema로 검사한다(요청사항 4).
 */
export function checkTemplateCompatibility(
  grid: string[][],
  schemas: Record<string, TemplateSchema>,
): TemplateCompatibilityInfo {
  const explicitVersion = detectExplicitVersion(grid);
  const version = explicitVersion ?? "V1";
  const schema = schemas[version];

  if (!schema) {
    return {
      version,
      status: "TEMPLATE_CHANGED",
      issues: [`지원하지 않는 Template Version입니다: "${version}"`],
    };
  }

  const issues = checkAgainstSchema(grid, schema);
  return { version, status: issues.length === 0 ? "COMPATIBLE" : "TEMPLATE_CHANGED", issues };
}

export function checkW2TemplateCompatibility(grid: string[][]): TemplateCompatibilityInfo {
  return checkTemplateCompatibility(grid, W2_TEMPLATE_SCHEMAS);
}

export function checkW3TemplateCompatibility(grid: string[][]): TemplateCompatibilityInfo {
  return checkTemplateCompatibility(grid, W3_TEMPLATE_SCHEMAS);
}

export function checkW4TemplateCompatibility(grid: string[][]): TemplateCompatibilityInfo {
  return checkTemplateCompatibility(grid, W4_TEMPLATE_SCHEMAS);
}

export interface CombinedCompatibility {
  status: TemplateCompatibilityStatus;
  issues: string[];
  parts: { label: string; version: string; status: TemplateCompatibilityStatus }[];
}

/** 여러 문서(예: W2+W3, 또는 W3+W4)의 Compatibility 결과를 하나로 합친다 —
 * 하나라도 TEMPLATE_CHANGED면 전체가 TEMPLATE_CHANGED다. */
export function combineCompatibility(parts: { label: string; info: TemplateCompatibilityInfo }[]): CombinedCompatibility {
  const issues: string[] = [];
  for (const { label, info } of parts) {
    for (const issue of info.issues) issues.push(`[${label}] ${issue}`);
  }
  const status: TemplateCompatibilityStatus = issues.length === 0 ? "COMPATIBLE" : "TEMPLATE_CHANGED";
  return { status, issues, parts: parts.map(({ label, info }) => ({ label, version: info.version, status: info.status })) };
}
