import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Step(MANUAL 안건 생성 범위 제한) — "안건 추가" 버튼은 TemplateRichTextEditor의
 * enableManualAgenda prop(기본값 false)으로만 노출된다. 이 프로젝트의 vitest
 * 설정은 environment:"node"(jsdom/컴포넌트 렌더링 테스트 인프라 없음,
 * vitest.config.ts 주석 참고)라 실제로 두 화면을 마운트해 버튼 DOM 유무를
 * 확인하는 대신, 두 소비처(Template 편집/실제 Draft 편집)가 이 prop을
 * 어떻게 넘기는지 소스 코드 수준에서 정적으로 검증한다 — "컴포넌트를
 * 복제하지 않고 최소 prop으로 구분한다"는 요구사항이 실제로 지켜지고
 * 있는지 확인하는 회귀 테스트다(누군가 실수로 Template 쪽에 prop을 추가하거나
 * Draft 쪽에서 지워도 이 테스트가 잡아낸다).
 *
 * 실제 DOM 렌더링/버튼 클릭 여부까지는 검증하지 못한다는 한계를 명시한다 —
 * 이 프로젝트에 새로 jsdom+testing-library 인프라를 들이는 것은 이번 Step
 * 범위를 벗어난다고 판단해 도입하지 않았다(완료 보고 참고).
 */

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("MANUAL 안건 생성 — Editor mode 정적 검증", () => {
  it("1. Template 편집(TemplateEditor.tsx)은 enableManualAgenda를 넘기지 않는다(기본값 false로 버튼 숨김)", () => {
    const source = readSource("./TemplateEditor.tsx");
    const usageMatch = /<TemplateRichTextEditor[\s\S]*?\/>/.exec(source);
    expect(usageMatch).not.toBeNull();
    expect(usageMatch![0]).not.toMatch(/enableManualAgenda/);
  });

  it("2. 실제 Draft 편집(MeetingMinutesPreviewClient.tsx)은 enableManualAgenda를 명시적으로 넘긴다", () => {
    const source = readSource("../meeting-minutes-preview/MeetingMinutesPreviewClient.tsx");
    const usageMatch = /<TemplateRichTextEditor[\s\S]*?\/>/.exec(source);
    expect(usageMatch).not.toBeNull();
    expect(usageMatch![0]).toMatch(/enableManualAgenda/);
  });

  it("TemplateRichTextEditor의 enableManualAgenda 기본값이 false다(컴포넌트 자체 회귀 방지)", () => {
    const source = readSource("./TemplateRichTextEditor.tsx");
    expect(source).toMatch(/enableManualAgenda\s*=\s*false/);
  });
});
