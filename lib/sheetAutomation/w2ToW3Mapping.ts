import type { MappingRuleConfig } from "@/lib/sheetAutomation/types";

/**
 * W2(품질검증설계 승인서) → W3(품질 적합성 평가 보고서) Template Definition.
 *
 * 실제 Template Sheet(PW2/PW3 Tab)를 직접 열어 구조를 확인했다. 짐작했던 "Header
 * 한 줄 + 데이터 행" Table이 아니라 두 영역이 섞여 있었다:
 *
 * 1. 상단 프로젝트 기본 정보 — 한 Row 안에 "Label 칸 → 2칸 뒤 Value 칸" 쌍이 여러 개
 *    반복되는 Form 영역(예: "제품명" 다음다음 칸에 실제 값). W2/W3 모두 같은 자리에
 *    "제품명", "대상 기종", "품목", "작성자", "차기 샘플 입고일", "목표 출시일" Label이
 *    동일하게 존재함을 확인했다 — 이 필드들은 이름이 정확히 같으므로 별도 Config 없이
 *    Exact Header Match만으로 이미 정상 매칭된다(lib/sheetAutomation/sheetGridReader.ts
 *    의 extractLabelValueTable 참고).
 *
 * 2. "■ 품질 승인 현황" / "1. 검사 계획" 같은 반복 Table 영역 — 검사 항목이 여러 행
 *    반복된다. W2의 "1. 검사 계획" Table Header("검사 순서/유형/시험 종류/검사 항목/
 *    검사 중요도/검사 방법/판정 기준")와 W3의 "■ 품질 승인 현황" Table Header("검사
 *    순서/유형/시험 종류/검사 항목/검사 중요도/종합 판정/판정 사유")를 실제 데이터로
 *    대조해, 검사 순서=4번 행이 두 Table에서 유형·시험 종류·검사 항목·검사 중요도가
 *    정확히 일치함을 확인했다(예: "핵심 CTQ / 기능/성능 / 점착·들뜸 검사 / Major").
 *    즉 "검사 순서"를 기준으로 W2 계획 → W3 승인 현황이 행 단위로 이어진다. 이 5개
 *    Header도 이름이 정확히 같아 별도 Config 없이 Exact Match로 매칭된다.
 *
 * 그래서 이 Config는 지금도 비어 있다 — 실제 문서에서 이름이 다른데 같은 의미인
 * Header 쌍을 아직 발견하지 못했기 때문이다(예: 있다면 여기 추가). "소재"(W2) ↔
 * "샘플 차수"(W3)처럼 이름이 다르고 실제로 다른 개념인 항목은 의도적으로 매칭하지
 * 않았다(Semantic 추정 금지 원칙).
 *
 * W3의 "■ 외관/■ 구성품/■ 기능·성능/■ 규격/■ 신뢰성/■ 외부 의뢰" 개별 Table에 있는
 * "판정 기준" 칸은 W2 검사 계획의 "판정 기준"과 이름은 같지만, 어떤 W2 행이 어떤
 * W3 카테고리 Table로 가야 하는지(분류 규칙)는 실제 업무 규칙 확인 없이는 알 수
 * 없어 이번 Step 범위에 포함하지 않았다 — "■ 품질 승인 현황" Table 하나만 다룬다.
 */
export const W2_TO_W3_MAPPING: MappingRuleConfig[] = [];

/**
 * W2/W3 모두에서 "검사 계획/검사 결과" 반복 Table의 Header Row를 찾기 위한 고유
 * 식별 문자열. 두 문서 모두 이 Header Row에만 "검사 순서"라는 문구가 등장한다
 * (다른 카테고리별 Table은 "순"만 사용해 구분된다).
 */
export const W2_TO_W3_REPEATING_ANCHOR = "검사 순서";
