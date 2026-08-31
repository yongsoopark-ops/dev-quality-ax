import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listMeetingTemplatesAction } from "@/lib/meetingTemplates/actions";
import { MeetingTemplateManager } from "./MeetingTemplateManager";

/**
 * Step 5B-3 — ADMIN 전용 회의록 Template 관리 화면. Sidebar에서 MEMBER에게는
 * 메뉴 자체가 보이지 않지만(lib/sidebar/sidebarConfig.ts의 requiredRole),
 * URL을 직접 알아도 접근하지 못하도록 서버에서도 다시 확인한다 —
 * app/(shell)/admin/layout.tsx와 동일한 패턴.
 */
export default async function MeetingTemplatesPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/home");
  }

  const res = await listMeetingTemplatesAction();

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden p-8">
      <div className="shrink-0">
        <h1 className="text-lg font-semibold text-navy-950">회의록 Template</h1>
        <p className="mt-1 text-sm text-navy-950/60">회의 유형별 회의록 양식을 관리합니다.</p>
      </div>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        <MeetingTemplateManager initialTemplates={res.templates ?? []} initialError={res.templates ? null : (res.error ?? "Template 목록을 불러오지 못했습니다.")} />
      </div>
    </div>
  );
}
