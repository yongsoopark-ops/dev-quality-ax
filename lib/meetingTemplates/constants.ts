import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import type { MeetingTemplateBlockSource, MeetingTemplateBlockType } from "./types";

/**
 * Step 5B-2 — 현재 정해진 회의 유형 4종("파트 주간회의 → Kick Off → Gate
 * Review → 대표 주간 보고로 확장" 요청사항). 유형 자체(어떤 회의 종류가
 * 있는지)는 TaskCategory/Role처럼 코드로 관리되는 고정 분류이고, 각 유형의
 * 실제 Template 내용(templateSchema)만 하드코딩하지 않는다.
 */
export const MEETING_TEMPLATE_TYPE_LABELS: Record<MeetingTemplateType, string> = {
  PART_WEEKLY_MEETING: "파트 주간회의",
  KICK_OFF: "Kick Off",
  GATE_REVIEW: "Gate Review",
  EXECUTIVE_WEEKLY_REPORT: "대표 주간 보고",
};

export const MEETING_TEMPLATE_TYPE_OPTIONS: MeetingTemplateType[] = [
  "PART_WEEKLY_MEETING",
  "KICK_OFF",
  "GATE_REVIEW",
  "EXECUTIVE_WEEKLY_REPORT",
];

/** Step 5B-3(Editor) — "블록 추가" 목록/블록 헤더에 쓰는 라벨. block.type
 * 자체는 추가 시점에만 고르고 이후에는 바꿀 수 없다(요청사항: AI/자동화가
 * 의존하는 식별값 보호) — 그래서 이 라벨은 Editor의 "추가" 버튼과 각 블록의
 * 읽기 전용 타입 표시에만 쓰인다. */
export const BLOCK_TYPE_LABELS: Record<MeetingTemplateBlockType, string> = {
  heading: "제목",
  text: "텍스트",
  list: "목록",
  "meeting-info": "회의 정보",
  "agenda-list": "안건 목록",
  "project-list": "프로젝트 목록",
  "action-item-list": "Action Item 목록",
  "review-list": "재검토 필요 목록",
};

export const BLOCK_TYPE_OPTIONS: MeetingTemplateBlockType[] = [
  "heading",
  "text",
  "list",
  "meeting-info",
  "agenda-list",
  "project-list",
  "action-item-list",
  "review-list",
];

export const BLOCK_SOURCE_LABELS: Record<MeetingTemplateBlockSource, string> = {
  AUTO: "자동(Schedule 등)",
  USER: "사용자 입력",
  AI: "AI 보완",
};

export const BLOCK_SOURCE_OPTIONS: MeetingTemplateBlockSource[] = ["AUTO", "USER", "AI"];
