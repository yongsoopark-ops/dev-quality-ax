import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMeetingMinutesDraftAction } from "@/lib/meetingMinutes/draft";
import { listMeetingTemplatesAction } from "@/lib/meetingTemplates/actions";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import { MeetingMinutesWorkspace } from "./MeetingMinutesWorkspace";

/**
 * Step(회의록 Workspace 회의유형 공통화) — 이 화면이 사실상 PART_WEEKLY_MEETING
 * 전용으로 동작하던 것을 고친다(요청사항). "초기 진입 기본값은 현재 사용
 * 중인 파트 주간 회의로 해도 된다"(요청사항)는 그대로 따르되, 실제 회의
 * 유형별 작성본 생성은 이제 lib/meetingMinutes/draft.ts의 Builder map이
 * 담당한다 — 이 페이지는 그 결과를 최초 1회 서버에서 미리 받아 Workspace에
 * 넘길 뿐이다(회의 유형을 바꾸는 이후 요청은 Client가 getMeetingMinutesDraftAction을
 * 직접 호출한다).
 */
const DEFAULT_MEETING_TYPE: MeetingTemplateType = "PART_WEEKLY_MEETING";

export default async function MeetingMinutesPage() {
  const session = await auth();
  if (!session?.user) redirect("/home");

  const isAdmin = session.user.role === "ADMIN";

  const draftRes = await getMeetingMinutesDraftAction(DEFAULT_MEETING_TYPE);

  // "양식 설정" 모드는 ADMIN 전용이다(요청사항) — MEMBER에게는 애초에
  // Template 목록을 내려주지 않는다(기존 통합 Step과 동일한 정책 유지).
  const templatesRes = isAdmin ? await listMeetingTemplatesAction() : null;

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden p-8">
      <MeetingMinutesWorkspace
        isAdmin={isAdmin}
        initialType={DEFAULT_MEETING_TYPE}
        initialDraft={draftRes.draft ?? null}
        initialDraftError={draftRes.draft ? null : (draftRes.error ?? "회의록을 불러오지 못했습니다.")}
        initialTemplates={templatesRes?.templates ?? []}
        initialTemplatesError={templatesRes && !templatesRes.templates ? (templatesRes.error ?? "Template 목록을 불러오지 못했습니다.") : null}
      />
    </div>
  );
}
