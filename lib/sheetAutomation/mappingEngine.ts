import type {
  MappingKind,
  MappingPreviewRow,
  MappingRuleConfig,
  MappingStatus,
  MappingSummary,
  SheetTable,
} from "@/lib/sheetAutomation/types";

/**
 * Header 비교를 위한 최소한의 안전한 정규화만 수행한다: 앞뒤 공백 제거, 연속
 * 공백/줄바꿈을 공백 1칸으로 정리. "검사기준"과 "판정 기준"처럼 의미가 비슷하다는
 * 이유로 같다고 추정하지 않는다(Semantic Guess 금지).
 */
export function normalizeHeader(header: string): string {
  return header.replace(/\s+/g, " ").trim();
}

function findColumnIndex(headers: string[], target: string): number {
  const normalizedTarget = normalizeHeader(target);
  return headers.findIndex((h) => normalizeHeader(h) === normalizedTarget);
}

/**
 * 실제로 적용할 Mapping Rule 목록을 만든다.
 * 1. Config에 명시된 Rule을 그대로 포함한다(Config가 Source of Truth, 요청사항 9).
 * 2. Config에서 다루지 않은 Source Header 중, Target에 동일한(정규화 후) Header가
 *    존재하는 것만 SINGLE/DIRECT Exact Match Rule로 자동 추가한다.
 * Config가 비어 있어도(아직 실제 W2/W3 예외 Header를 모를 때) Exact Match만으로
 * 기본 동작한다.
 */
export function buildMappingRules(
  sourceHeaders: string[],
  targetHeaders: string[],
  configRules: MappingRuleConfig[],
): MappingRuleConfig[] {
  const rules: MappingRuleConfig[] = [...configRules];
  const configuredSourceHeaders = new Set(configRules.map((r) => normalizeHeader(r.sourceHeader)));
  const normalizedTargets = new Map(targetHeaders.map((h) => [normalizeHeader(h), h]));

  for (const sourceHeader of sourceHeaders) {
    const normalized = normalizeHeader(sourceHeader);
    if (!normalized || configuredSourceHeaders.has(normalized)) continue;

    const matchedTarget = normalizedTargets.get(normalized);
    if (!matchedTarget) continue;

    rules.push({
      id: `AUTO_${normalized}`,
      sourceHeader,
      targetHeader: matchedTarget,
      required: false,
      transformType: "DIRECT",
      kind: "SINGLE",
    });
  }

  return rules;
}

function resolveStatus(
  kind: MappingKind,
  sourceIndex: number,
  targetIndex: number,
  sourceValue: string | null,
): MappingStatus {
  if (kind === "REPEATING") return "NOT_SUPPORTED";
  if (sourceIndex === -1) return "SOURCE_NOT_FOUND";
  if (targetIndex === -1) return "TARGET_NOT_FOUND";
  if (!sourceValue || sourceValue.trim() === "") return "EMPTY_SOURCE";
  return "READY";
}

/**
 * Rule 목록과 실제로 읽어온 Source/Target Sheet 데이터로 Preview를 계산한다.
 * REPEATING Rule은 이번 Step에서 실제 W2/W3 반복 영역 구조를 검증하지 못했으므로
 * 값을 계산하지 않고 NOT_SUPPORTED로만 표시한다(목록에는 포함해 구조는 보여준다).
 * sourceRowIndex는 SINGLE Mapping이 참조할 데이터 행(기본: 첫 번째 데이터 행)이다.
 */
export function computeMappingPreview(
  rules: MappingRuleConfig[],
  source: SheetTable,
  target: SheetTable,
  sourceRowIndex = 0,
): MappingPreviewRow[] {
  return rules.map((rule) => {
    if (rule.kind === "REPEATING") {
      return {
        mappingId: rule.id,
        sourceHeader: rule.sourceHeader,
        sourceValue: null,
        targetHeader: rule.targetHeader,
        status: "NOT_SUPPORTED",
        required: rule.required,
        kind: rule.kind,
      };
    }

    const sourceIndex = findColumnIndex(source.headers, rule.sourceHeader);
    const targetIndex = findColumnIndex(target.headers, rule.targetHeader);
    const sourceValue = sourceIndex !== -1 ? (source.rows[sourceRowIndex]?.[sourceIndex] ?? null) : null;

    return {
      mappingId: rule.id,
      sourceHeader: rule.sourceHeader,
      sourceValue,
      targetHeader: rule.targetHeader,
      status: resolveStatus(rule.kind, sourceIndex, targetIndex, sourceValue),
      required: rule.required,
      kind: rule.kind,
    };
  });
}

/** Required + 비정상 상태 = 오류. Optional + 비정상 상태 = 확인 필요. */
export function summarizeMappingPreview(preview: MappingPreviewRow[]): MappingSummary {
  let ready = 0;
  let errors = 0;
  let needsReview = 0;

  for (const row of preview) {
    if (row.status === "READY") {
      ready += 1;
    } else if (row.required) {
      errors += 1;
    } else {
      needsReview += 1;
    }
  }

  return { total: preview.length, ready, needsReview, errors };
}
