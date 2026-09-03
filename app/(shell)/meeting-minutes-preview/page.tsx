import { redirect } from "next/navigation";

/**
 * Meeting Minutes 통합 Step — "회의록 Preview" 화면이 "/meeting-minutes"(작성
 * 모드, 기본 진입)로 합쳐졌다. 이 Route는 삭제하지 않고 리다이렉트만 한다 —
 * app/(shell)/meeting-templates/page.tsx와 동일한 처리. 실제 Component
 * (MeetingMinutesPreviewClient)와 Server Action(lib/meetingMinutes/actions.ts)
 * 은 삭제하지 않고 "/meeting-minutes"가 그대로 import해서 재사용한다.
 */
export default function MeetingMinutesPreviewLegacyRedirect() {
  redirect("/meeting-minutes");
}
