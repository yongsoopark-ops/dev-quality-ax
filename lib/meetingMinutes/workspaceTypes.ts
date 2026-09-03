import type { MeetingTemplateType } from "@/app/generated/prisma/enums";

/**
 * Step(회의록 Workspace 회의유형 공통화) — 이번 Step 대상은 PART_WEEKLY_MEETING/
 * KICK_OFF/GATE_REVIEW 3종이다. EXECUTIVE_WEEKLY_REPORT는 후순위로 유지한다
 * (요청사항). DB enum과 기존 Template 데이터는 전혀 건드리지 않고, 회의록
 * 작성 화면의 "회의 유형 선택" 목록에서만 이 목록으로 활성/비활성(Coming
 * Soon)을 가른다 — lib/meetingMinutes/draft.ts의 Builder map도 동일하게
 * 이 3종만 실제로 처리한다.
 */
export const SUPPORTED_MEETING_MINUTES_TYPES: readonly MeetingTemplateType[] = ["PART_WEEKLY_MEETING", "KICK_OFF", "GATE_REVIEW"];

export function isSupportedMeetingMinutesType(type: MeetingTemplateType): boolean {
  return (SUPPORTED_MEETING_MINUTES_TYPES as readonly string[]).includes(type);
}
