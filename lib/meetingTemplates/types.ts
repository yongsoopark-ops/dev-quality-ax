/**
 * Step 5B-2(회의록 Template) — 완전 자유 HTML이 아니라, AI(Gemini)와 DOCX
 * 생성 양쪽이 그대로 이해할 수 있는 구조화 block 배열로 Template을 표현한다.
 * 이 파일은 그 block들의 형태(타입)만 정의한다 — 실제 검증은
 * lib/meetingTemplates/validate.ts, 실제 내용(어떤 회의에 어떤 heading을
 * 쓸지 등)은 여기 코드가 아니라 DB에 저장된 Template Row(MeetingTemplate.
 * templateSchema)가 갖는다.
 */

export type MeetingTemplateBlockType =
  | "heading"
  | "text"
  | "list"
  | "table"
  | "meeting-info"
  | "agenda-list"
  | "project-list"
  | "action-item-list"
  | "review-list";

/**
 * 이 블록의 내용이 최종적으로 어디서 채워지는지 — 향후 "Template + Schedule
 * AUTO 데이터 + 사용자 사전 입력 + Clova TXT → Gemini 보완" 결합 단계에서
 * 그대로 라우팅 기준이 된다.
 * - AUTO: Schedule 등 시스템 데이터에서 자동으로 채워진다(예: 회의 일시/참석자).
 * - USER: 회의 전/후 사용자가 직접 입력한다.
 * - AI: Gemini가 원문(Clova TXT 등)을 바탕으로 보완/생성한다.
 */
export type MeetingTemplateBlockSource = "AUTO" | "USER" | "AI";

/** 모든 block 공통 필드. */
export interface MeetingTemplateBlockBase {
  /** Template 안에서만 고유하면 된다(전역 고유 아님) — Editor의 순서 변경/삭제 시
   * 안정적인 참조로 쓴다. */
  id: string;
  type: MeetingTemplateBlockType;
  /** Template Editor(다음 Step)에서 이 block을 가리키는 이름 — 실제 렌더링
   * 텍스트가 아니라 관리용 라벨이다(예: "회의 정보", "결정 사항"). */
  label: string;
  /** Template 안에서의 표시 순서. */
  order: number;
  /** 이 block을 생략할 수 없게 할지 — Editor가 삭제를 막는 데 쓴다. */
  required: boolean;
  /** Gemini가 이 block의 내용을 채우거나 고칠 수 있는지. */
  aiEditable: boolean;
  /** 사용자가 (미래 Preview 화면에서) 이 block을 직접 편집할 수 있는지. */
  userEditable: boolean;
  source: MeetingTemplateBlockSource;
}

/** heading/list의 icon, meeting-info의 필드별 icon 등에서 공통으로 쓰는
 * "이모지 1~2글자" 표현 — 새 아이콘 시스템을 만들지 않는다. */
export type BlockIcon = string;

export interface HeadingBlockConfig {
  level: 1 | 2 | 3;
  text: string;
  icon?: BlockIcon;
}
export interface HeadingBlock extends MeetingTemplateBlockBase {
  type: "heading";
  config: HeadingBlockConfig;
}

export interface TextBlockConfig {
  /** Editor가 미리 채워둔 고정 문구(source="USER"/"AI"면 실제 회의 시점에
   * 덮어써질 초기값 또는 placeholder로 쓰인다). */
  text?: string;
  placeholder?: string;
}
export interface TextBlock extends MeetingTemplateBlockBase {
  type: "text";
  config: TextBlockConfig;
}

/** Step 5B-3.2.1(목록 들여쓰기) — 항목 하나 = 텍스트 + depth(들여쓰기 단계,
 * 0부터 시작)뿐이다. "중첩 목록"이라는 별도 block을 만들지 않고, 기존 list
 * block 안에서 depth만으로 표현한다(요청사항). depth 상한은
 * lib/meetingTemplates/validate.ts의 MAX_LIST_DEPTH를 따른다. */
export interface ListItemNode {
  text: string;
  depth: number;
}
export interface ListBlockConfig {
  style: "bullet" | "numbered";
  /** 예전 형식(문자열 배열, depth 없음)도 읽을 때는 depth 0으로 취급해
   * 그대로 받아들인다 — validate.ts가 이 하위호환을 처리한다. Editor가 새로
   * 만들거나 저장하는 값은 항상 ListItemNode[]다. */
  items?: ListItemNode[];
  icon?: BlockIcon;
}
export interface ListBlock extends MeetingTemplateBlockBase {
  type: "list";
  config: ListBlockConfig;
}

/** Step 5B-3.2(자유 문서 Editor) — Word처럼 자유롭게 만드는 실제 표. 행/열
 * 구조만 있고 값은 전부 사용자가 입력한 문자열이다(project-list/
 * action-item-list의 columns처럼 "열 정의"만 있는 게 아니라 실제 셀 값을
 * 담는다) — rows[0]이 특별히 헤더 행인 것은 아니고, 그냥 첫 행일 뿐이다. */
export interface TableBlockConfig {
  rows: string[][];
}
export interface TableBlock extends MeetingTemplateBlockBase {
  type: "table";
  config: TableBlockConfig;
}

export interface MeetingInfoField {
  /** 실제 값을 채울 때 참조하는 key(예: "meetingDate", "attendees") — 향후
   * Schedule 연동 단계가 이 key로 AUTO 값을 매핑한다. */
  key: string;
  label: string;
  icon?: BlockIcon;
}
export interface MeetingInfoBlockConfig {
  /** 배열 순서가 곧 표시 순서(field order)다. */
  fields: MeetingInfoField[];
  /** Step 5B-3.1(문서형 Editor) — 이 섹션 자체의 아이콘(예: "📅"). 필드별
   * icon(MeetingInfoField.icon)과는 별개다. */
  icon?: BlockIcon;
}
export interface MeetingInfoBlock extends MeetingTemplateBlockBase {
  type: "meeting-info";
  config: MeetingInfoBlockConfig;
}

export interface AgendaListBlockConfig {
  numbered?: boolean;
  icon?: BlockIcon;
}
export interface AgendaListBlock extends MeetingTemplateBlockBase {
  type: "agenda-list";
  config: AgendaListBlockConfig;
}

export interface TemplateTableColumn {
  key: string;
  label: string;
}

export interface ProjectListBlockConfig {
  /** 배열 순서가 곧 표시 열 순서다(field order). */
  columns: TemplateTableColumn[];
  /** Step 5B-3.1(문서형 Editor) — 이 섹션 자체의 아이콘(예: "📦"). 같은
   * project-list 타입이어도 섹션마다("정규 프로젝트" vs "서브 프로젝트")
   * 다른 아이콘을 가질 수 있다. */
  icon?: BlockIcon;
}
export interface ProjectListBlock extends MeetingTemplateBlockBase {
  type: "project-list";
  config: ProjectListBlockConfig;
}

export interface ActionItemListBlockConfig {
  columns: TemplateTableColumn[];
  icon?: BlockIcon;
}
export interface ActionItemListBlock extends MeetingTemplateBlockBase {
  type: "action-item-list";
  config: ActionItemListBlockConfig;
}

export interface ReviewListBlockConfig {
  /** true면 이전 회차에서 해결되지 않은 항목이 이 block에 계속 누적되는
   * "향후 재검토 필요" 영역이다. 실제 이월 계산 로직은 이번 Step 범위 밖이고,
   * 여기서는 그런 성격의 block임을 구조적으로 표현만 한다. */
  accumulatesAcrossMeetings?: boolean;
  icon?: BlockIcon;
}
export interface ReviewListBlock extends MeetingTemplateBlockBase {
  type: "review-list";
  config: ReviewListBlockConfig;
}

export type MeetingTemplateBlock =
  | HeadingBlock
  | TextBlock
  | ListBlock
  | TableBlock
  | MeetingInfoBlock
  | AgendaListBlock
  | ProjectListBlock
  | ActionItemListBlock
  | ReviewListBlock;

/** DB(MeetingTemplate.templateSchema)에 JSON 문자열로 저장되는 실제 값. */
export type MeetingTemplateSchema = MeetingTemplateBlock[];
