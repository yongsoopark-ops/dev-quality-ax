import type { MeetingTemplateType } from "@/app/generated/prisma/enums";

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
