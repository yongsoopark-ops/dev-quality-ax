import { redirect } from "next/navigation";

/**
 * Meeting Minutes 통합 Step — "회의록 Template"과 "회의록 Preview"가 하나의
 * "/meeting-minutes" 화면(작성 모드 ↔ 양식 설정 모드)으로 합쳐졌다(요청사항:
 * "중복 기능을 두 개 유지하지 말 것"). 이 Route는 제거하지 않고 새 통합
 * 화면으로 리다이렉트만 한다 — 기존에 이 URL을 즐겨찾기/공유해 둔 사용자가
 * 있어도 깨지지 않는다. 실제 화면/Component/Server Action(MeetingTemplateManager,
 * TemplateEditor, lib/meetingTemplates/actions.ts)은 전혀 삭제하지 않고 그대로
 * "/meeting-minutes"가 import해서 재사용한다(app/(shell)/meeting-minutes/
 * MeetingMinutesWorkspace.tsx 참고) — ADMIN 전용 권한 검사도 그 Server
 * Action들 안에서 그대로 유지된다.
 */
export default function MeetingTemplatesLegacyRedirect() {
  redirect("/meeting-minutes");
}
