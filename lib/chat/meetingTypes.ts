/**
 * 회의록 Skill V1 회의 유형 — 최소 구성(요청사항). 향후 Gemini Prompt가
 * 유형별로 달라질 수 있으므로 여기 하나에 목록을 모아 두고, UI는 이 배열만
 * 순회한다(하드코딩 분기 없음).
 */
export type MeetingType = "GENERAL" | "QUALITY_ISSUE" | "DEV_REVIEW";

export interface MeetingTypeOption {
  id: MeetingType;
  label: string;
}

export const MEETING_TYPE_OPTIONS: MeetingTypeOption[] = [
  { id: "GENERAL", label: "일반 회의" },
  { id: "QUALITY_ISSUE", label: "품질 이슈 회의" },
  { id: "DEV_REVIEW", label: "개발 검토 회의" },
];
