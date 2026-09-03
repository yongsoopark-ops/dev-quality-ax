import { MeetingReportSection } from "@/app/generated/prisma/enums";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(Template/Preview 분리 검증 + Rich Text 매핑 안정화) — 회의록 자동입력
 * 대상 5개 섹션의 heading을 "지금 화면에 보이는 문자열"이 아니라 heading
 * node의 내부 attribute(attrs.meetingSection)로 식별한다. 사용자가 heading에
 * 이모지를 붙이거나 문구를 다듬어도(예: "정규 프로젝트" → "🏗️ 정규
 * 프로젝트") 자동입력이 깨지지 않아야 한다(요청사항) — Task 쪽의
 * TaskCategoryOption.meetingReportSection(5B-9 보완)과 같은 enum을 그대로
 * 재사용해 "회의록 섹션"이라는 개념 하나를 두 곳(업무 구분/heading)에서
 * 일관되게 쓴다.
 *
 * attrs.meetingSection이 있으면 항상 그 값을 최우선으로 쓰고(요청사항:
 * "Preview injection은 표시 문자열이 아니라 이 semantic attribute를 우선
 * 사용한다"), 아직 attribute가 없는 legacy heading에 한해서만 정규화된
 * 텍스트 비교로 fallback 판별한다.
 */

export const SECTION_HEADING_DEFS: { section: MeetingReportSection; canonicalText: string }[] = [
  { section: MeetingReportSection.REGULAR_PROJECT, canonicalText: "정규 프로젝트" },
  { section: MeetingReportSection.SUB_PROJECT, canonicalText: "서브 프로젝트" },
  { section: MeetingReportSection.EXCEPTION, canonicalText: "예외 업무" },
  { section: MeetingReportSection.BUSINESS_TRIP, canonicalText: "출장 업무" },
  { section: MeetingReportSection.COMMON, canonicalText: "공통 업무" },
];

const VALID_SECTIONS = new Set<string>(Object.values(MeetingReportSection));

/** heading 표시 텍스트를 "의미 비교용"으로 정규화한다: trim → 맨 앞 이모지/
 * 기호(문자·숫자가 아닌 선행 문자) 제거 → 다시 trim → 연속 공백을 하나로.
 * "🏗️ 정규 프로젝트" → "정규 프로젝트", "✈️  출장   업무" → "출장 업무". */
export function normalizeHeadingText(raw: string): string {
  return raw
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** 정규화한 텍스트가 5개 canonical 이름 중 하나와 완전히 같을 때만 매칭한다
 * (부분 일치/포함 관계는 다른 heading을 잘못 집을 위험이 있어 쓰지 않는다). */
export function matchSectionByNormalizedText(rawText: string): MeetingReportSection | null {
  const normalized = normalizeHeadingText(rawText);
  return SECTION_HEADING_DEFS.find((d) => d.canonicalText === normalized)?.section ?? null;
}

function extractHeadingText(node: JSONContent): string {
  if (!Array.isArray(node.content)) return "";
  return node.content.map((n) => (n.type === "text" ? (n.text ?? "") : "")).join("");
}

/** heading node 하나의 semantic section을 판별한다 — attrs.meetingSection이
 * 유효한 값이면 최우선으로 쓰고, 없거나 알 수 없는 값이면 legacy fallback으로
 * 표시 텍스트를 정규화해 비교한다(injectDocument.ts가 이 함수로 heading을
 * 찾는다). */
export function resolveHeadingSection(node: JSONContent): MeetingReportSection | null {
  const attrValue = node.attrs?.meetingSection;
  if (typeof attrValue === "string" && VALID_SECTIONS.has(attrValue)) {
    return attrValue as MeetingReportSection;
  }
  return matchSectionByNormalizedText(extractHeadingText(node));
}

/**
 * documentContent 전체를 재귀 순회하며, semantic attribute가 아직 없는
 * heading에 한해서만 정규화 텍스트로 추론해 attrs.meetingSection을 채워
 * 넣는다. 이미 attribute가 있는 heading은 텍스트가 그 사이 바뀌었어도 절대
 * 덮어쓰지 않는다 — "표시명이 바뀌어도 identity가 유지된다"가 이 기능의
 * 핵심이라, 한 번 부여된 attribute는 이후 텍스트와 무관하게 유지돼야 한다.
 *
 * lib/meetingTemplates/actions.ts의 create/updateMeetingTemplateAction이
 * 저장 직전 이 함수를 거친다(요청사항: "기존 Template을 강제로 즉시 DB
 * 변경하지 말고 Template 저장 시 정상적으로 attribute가 함께 저장되도록
 * 하는 방식 우선 검토") — 즉 지금 이 순간 DB의 기존 Row를 일괄 변경하는
 * 별도 마이그레이션은 만들지 않고, 다음 저장부터 자연스럽게 채워진다.
 */
export function attachMissingMeetingSectionAttributes(documentContent: JSONContent): JSONContent {
  const cloned: JSONContent = JSON.parse(JSON.stringify(documentContent));

  function walk(node: JSONContent) {
    if (node.type === "heading") {
      const already = node.attrs?.meetingSection;
      if (!(typeof already === "string" && VALID_SECTIONS.has(already))) {
        const inferred = matchSectionByNormalizedText(extractHeadingText(node));
        if (inferred) {
          node.attrs = { ...(node.attrs ?? {}), meetingSection: inferred };
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  }

  walk(cloned);
  return cloned;
}
