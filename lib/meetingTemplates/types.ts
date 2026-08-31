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

export interface ListBlockConfig {
  style: "bullet" | "numbered";
  items?: string[];
  icon?: BlockIcon;
}
export interface ListBlock extends MeetingTemplateBlockBase {
  type: "list";
  config: ListBlockConfig;
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
}
export interface ProjectListBlock extends MeetingTemplateBlockBase {
  type: "project-list";
  config: ProjectListBlockConfig;
}

export interface ActionItemListBlockConfig {
  columns: TemplateTableColumn[];
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
}
export interface ReviewListBlock extends MeetingTemplateBlockBase {
  type: "review-list";
  config: ReviewListBlockConfig;
}

export type MeetingTemplateBlock =
  | HeadingBlock
  | TextBlock
  | ListBlock
  | MeetingInfoBlock
  | AgendaListBlock
  | ProjectListBlock
  | ActionItemListBlock
  | ReviewListBlock;

/** DB(MeetingTemplate.templateSchema)에 JSON 문자열로 저장되는 실제 값. */
export type MeetingTemplateSchema = MeetingTemplateBlock[];
