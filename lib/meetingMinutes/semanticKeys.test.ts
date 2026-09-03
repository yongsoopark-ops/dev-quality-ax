import { describe, expect, it } from "vitest";
import { resolveHeadingSection, matchSectionByNormalizedText } from "./sectionHeadings";
import { resolveFieldKey, matchFieldKeyByLabel } from "./fieldSemantics";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(V1 코드 건강도 / 안정화 점검) — "visible label 변경으로 자동화/merge가
 * 깨지지 않는지"가 이번 Step의 핵심 점검 항목이다. semantic attribute가 있으면
 * 항상 최우선이고, 표시 텍스트는 attribute가 없는 legacy 케이스에서만
 * fallback으로 쓰인다는 순서를 회귀 테스트로 고정한다.
 */

function heading(text: string, meetingSection?: string): JSONContent {
  return {
    type: "heading",
    attrs: meetingSection ? { meetingSection } : {},
    content: [{ type: "text", text }],
  };
}

describe("resolveHeadingSection — semantic attr 우선, 텍스트는 legacy fallback", () => {
  it("attrs.meetingSection이 있으면 표시 텍스트가 완전히 달라도 그 값을 그대로 쓴다", () => {
    const node = heading("아무 말이나 적어도 되는 제목", "REGULAR_PROJECT");
    expect(resolveHeadingSection(node)).toBe("REGULAR_PROJECT");
  });

  it("attrs가 없는 legacy heading은 정규화된 텍스트로 판별한다", () => {
    const node = heading("🏗️ 정규 프로젝트");
    expect(resolveHeadingSection(node)).toBe("REGULAR_PROJECT");
  });

  it("attrs도 없고 텍스트도 일치하지 않으면 null이다(추측 매칭하지 않음)", () => {
    const node = heading("전혀 다른 제목");
    expect(resolveHeadingSection(node)).toBeNull();
  });

  it("이모지/공백을 정규화한 뒤 완전히 일치해야 매칭된다(부분 일치 금지)", () => {
    expect(matchSectionByNormalizedText("✈️  출장   업무")).toBe("BUSINESS_TRIP");
    expect(matchSectionByNormalizedText("정규 프로젝트 관련 논의")).toBeNull();
  });
});

function tableCell(text: string, fieldKey?: string): JSONContent {
  return {
    type: "tableCell",
    attrs: fieldKey ? { fieldKey } : {},
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("resolveFieldKey — semantic attr 우선, 텍스트는 legacy fallback", () => {
  it("attrs.fieldKey가 있으면 셀 텍스트가 바뀌어도 그 값을 그대로 쓴다", () => {
    const cell = tableCell("완전히 다른 라벨", "MEETING_WEEK");
    expect(resolveFieldKey(cell)).toBe("MEETING_WEEK");
  });

  it("attrs가 없는 legacy 셀은 정규화된 라벨 텍스트로 판별한다", () => {
    const cell = tableCell("회의 주차");
    expect(resolveFieldKey(cell)).toBe("MEETING_WEEK");
  });

  it("AGENDA_OWNER는 '담당자' 텍스트만으로는 legacy fallback되지 않는다(OWNER와 텍스트가 같아 의도적으로 제외)", () => {
    expect(matchFieldKeyByLabel("담당자")).toBe("OWNER");
    // attrs로 명시하지 않으면 안건 담당자(AGENDA_OWNER)는 텍스트만으로 구분 불가 — OWNER로 잡히는 것이 문서화된 현재 동작.
    const cell = tableCell("담당자", "AGENDA_OWNER");
    expect(resolveFieldKey(cell)).toBe("AGENDA_OWNER");
  });
});
