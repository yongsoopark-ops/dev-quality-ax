import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { TaskWithRelations } from "@/lib/schedule/types";
import { ScheduleClient } from "./ScheduleClient";

export default async function SchedulePage({
  searchParams,
}: {
  /** Bell Notification Deep Link(요청사항 9): /schedule?task=<taskId>&comment=<commentId> */
  searchParams: Promise<{ task?: string; comment?: string }>;
}) {
  const rawParams = await searchParams;
  // (shell) layout이 이미 로그인/DISABLED 여부를 확인한 뒤에만 이 페이지가
  // 렌더링되므로, 여기서 다시 부르는 auth()는 session.user가 항상 존재한다 —
  // Update/Reply/Revision 수정·삭제 버튼을 보여줄지 Client가 판단하는 데만 쓴다.
  const session = await auth();
  const currentUser = { id: session!.user.id, role: session!.user.role };

  const [tasks, users, projectCategories] = await Promise.all([
    prisma.task.findMany({
      orderBy: { startDate: "asc" },
      include: {
        assignees: true,
        projectDetail: true,
        meetingDetail: { include: { attendees: true } },
        scheduleRevisions: {
          orderBy: { revisionNo: "asc" },
          include: { creator: { select: { name: true } } },
        },
        comments: {
          where: { parentId: null },
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: { name: true } },
            replies: {
              orderBy: { createdAt: "asc" },
              include: { author: { select: { name: true } } },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.projectCategory.findMany({ orderBy: { name: "asc" } }),
  ]);

  const tasksForClient: TaskWithRelations[] = tasks.map((task) => {
    // "최신 유효 일정" = Revision이 있으면 가장 큰 revisionNo, 없으면 Task 원본.
    // Calendar/Drag/Resize는 이 계산 결과(effective)만 보고, Task 원본은 별도
    // 필드(originalStartDate/DueDate)로 항상 그대로 노출한다.
    const latestRevision = task.scheduleRevisions.at(-1) ?? null;
    return {
      id: task.id,
      title: task.title,
      category: task.category,
      startDate: (latestRevision?.startDate ?? task.startDate).toISOString(),
      dueDate: (latestRevision?.dueDate ?? task.dueDate).toISOString(),
      originalStartDate: task.startDate.toISOString(),
      originalDueDate: task.dueDate.toISOString(),
      status: task.status,
      memo: task.memo,
      goalName: task.goalName,
      halfDayPeriod: task.halfDayPeriod,
      assigneeIds: task.assignees.map((a) => a.userId),
      projectDetail: task.projectDetail
        ? {
            projectName: task.projectDetail.projectName,
            categoryId: task.projectDetail.categoryId,
          }
        : null,
      meetingDetail: task.meetingDetail
        ? {
            department: task.meetingDetail.department,
            time: task.meetingDetail.time ? task.meetingDetail.time.toISOString() : null,
            location: task.meetingDetail.location,
            attendeeIds: task.meetingDetail.attendees.map((a) => a.userId),
          }
        : null,
      scheduleRevisions: task.scheduleRevisions.map((rev) => ({
        id: rev.id,
        revisionNo: rev.revisionNo,
        startDate: rev.startDate.toISOString(),
        dueDate: rev.dueDate.toISOString(),
        reasonText: rev.reasonText,
        createdBy: rev.createdBy,
        createdByName: rev.creator.name,
        createdAt: rev.createdAt.toISOString(),
      })),
      comments: task.comments.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        authorName: c.author.name,
        parentId: c.parentId,
        contentJson: c.contentJson,
        plainText: c.plainText,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        replies: c.replies.map((r) => ({
          id: r.id,
          authorId: r.authorId,
          authorName: r.author.name,
          parentId: r.parentId,
          contentJson: r.contentJson,
          plainText: r.plainText,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          replies: [],
        })),
      })),
    };
  });

  // Notification Deep Link — 존재하지 않는 taskId는 그냥 무시하고(요청사항 9)
  // 평소와 똑같은 /schedule 화면을 보여준다. commentId 존재 여부는 여기서
  // 확인하지 않는다 — 삭제된 Comment라도 Task Modal/Update Modal은 정상적으로
  // 열려야 하고, 스크롤 대상만 못 찾을 뿐이라 UpdateModal 쪽에서 안전하게 무시된다.
  const targetTask = rawParams.task ? tasksForClient.find((t) => t.id === rawParams.task) : undefined;
  const initialFocus = targetTask ? { taskId: targetTask.id, commentId: rawParams.comment } : undefined;

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden p-8">
      <div className="shrink-0">
        <h1 className="text-lg font-semibold text-navy-950">일정 관리</h1>
        <p className="mt-1 text-sm text-navy-950/60">빈 날짜를 클릭해 새 업무를 등록하고, 업무를 클릭해 수정합니다.</p>
      </div>
      <div className="mt-6 min-h-0 flex-1">
        <ScheduleClient
          tasks={tasksForClient}
          users={users}
          projectCategories={projectCategories}
          currentUser={currentUser}
          initialFocus={initialFocus}
        />
      </div>
    </div>
  );
}
