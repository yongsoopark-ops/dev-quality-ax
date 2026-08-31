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

/**
 * Step 5B-3(원래 구조화 Editor)에서 쓰던 8종 + table 라벨. Step 5B-3.2부터
 * Editor는 이 중 heading/text/list/table 4종만 사용자에게 노출한다
 * (meeting-info/agenda-list/project-list/action-item-list/review-list는
 * "회의록 내부 block type을 사용자가 선택하지 않게 한다"는 요청사항에 따라
 * Editor의 "+ 추가" 메뉴에서 제거됨) — 다만 타입/검증/DB 구조 자체는
 * 그대로 남겨둔다(요청사항: 당장 삭제하지 않는다). 이 라벨 맵은 여전히
 * block.type의 사람이 읽을 수 있는 이름이 필요할 때(예: 디버깅) 참조용으로
 * 남긴다 — Editor의 실제 "추가" 메뉴는 아래 lib/meetingTemplates/defaults.ts의
 * FREE_BLOCK_MENU_ITEMS를 쓴다. */
export const BLOCK_TYPE_LABELS: Record<MeetingTemplateBlockType, string> = {
  heading: "제목",
  text: "텍스트",
  list: "목록",
  table: "표",
  "meeting-info": "회의 정보",
  "agenda-list": "안건 목록",
  "project-list": "프로젝트 목록",
  "action-item-list": "Action Item 목록",
  "review-list": "재검토 필요 목록",
};

export const BLOCK_SOURCE_LABELS: Record<MeetingTemplateBlockSource, string> = {
  AUTO: "자동(Schedule 등)",
  USER: "사용자 입력",
  AI: "AI 보완",
};

export const BLOCK_SOURCE_OPTIONS: MeetingTemplateBlockSource[] = ["AUTO", "USER", "AI"];
