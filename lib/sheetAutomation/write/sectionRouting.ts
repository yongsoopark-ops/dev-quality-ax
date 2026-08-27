import { normalizeHeader } from "@/lib/sheetAutomation/mappingEngine";

/**
 * W2 검사 계획의 "시험 종류" 값을 W3의 어느 "■ 섹션"에 넣을지 결정한다.
 * AI/Semantic 추정을 하지 않는다 — 기본은 Exact Match(정규화 후 완전히 같은 문자열)이고,
 * 실제 문서를 비교해 이름이 다르지만 같은 개념임을 확인한 경우에만 아래 표에 명시적으로
 * 추가한다.
 *
 * 실제 확인된 예외: W2 "시험 종류" = "외관 검사" ↔ W3 Section "■ 외관". 나머지
 * ("구성품", "기능/성능", "신뢰성")는 이름이 정확히 같아 예외가 필요 없었다.
 */
const EXPLICIT_ROUTING: Record<string, string> = {
  "외관 검사": "외관",
};

/**
 * testType(W2 시험 종류 값)이 실제로 존재하는 W3 Section 이름 중 하나와 일치하는지
 * 찾는다. 일치하는 게 없으면 null — 이 경우 자동 배정하지 않고 WARNING으로 표시한다.
 */
export function resolveTargetSection(testType: string, availableSections: string[]): string | null {
  const normalized = normalizeHeader(testType);
  const explicit = EXPLICIT_ROUTING[normalized];
  if (explicit && availableSections.some((s) => normalizeHeader(s) === normalizeHeader(explicit))) {
    return explicit;
  }
  return availableSections.find((s) => normalizeHeader(s) === normalized) ?? null;
}
