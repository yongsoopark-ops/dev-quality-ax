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

  // 성능 개선(초기 /schedule 조회 경량화, 진단 Step 근거): Calendar/Filter가
  // 실제로 렌더링에 쓰는 필드만 조회한다 — scheduleRevisions의 "이력 전체"
  // (reasonText/작성자/수정 시각 등)와 meetingDetail, comments·replies(Rich
  // Text 본문 포함)는 더 이상 여기서 eager load하지 않는다. 단, "최신 유효
  // 일정"(Calendar가 실제로 그려야 하는 날짜)은 최신 Revision 1건의 날짜만
  // 알면 계산할 수 있으므로, reasonText/creator 없이 딱 그 2개 필드만 가볍게
  // 함께 가져온다 — 이걸 빼면 공식 일정 변경이 있는 Task가 Calendar에 예전
  // 날짜로 잘못 표시되는 회귀가 생긴다. projectDetail은 Calendar Title
  // 생성에 projectName이 필요해 가볍게(projectName만) 포함하고, categoryId는
  // Task Modal을 열 때 getTaskDetailAction으로 채운다. Comment/Reply "개수"만
  // `_count`로 함께 받아 "💬 업데이트 N" 배지를 목록을 펼치지 않고도 정확히 표시한다.
  const [tasks, users, projectCategories] = await Promise.all([
    prisma.task.findMany({
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        startDate: true,
        dueDate: true,
        goalName: true,
        assignees: { select: { userId: true } },
        projectDetail: { select: { projectName: true } },
        // 이름은 scheduleRevisions 그대로지만(Prisma relation 필드명은 select
        // key로 바꿀 수 없다) orderBy+take:1로 최신 1건의 날짜만 가져온다 —
        // 이력 전체(reasonText/creator 등)는 조회하지 않는다.
        scheduleRevisions: { orderBy: { revisionNo: "desc" }, take: 1, select: { startDate: true, dueDate: true } },
        _count: { select: { comments: true } },
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
    // "최신 유효 일정" 계산 자체는 기존과 동일한 규칙이다(Revision 있으면 최신,
    // 없으면 Task 원본) — 다만 이제 최신 1건의 날짜만 가볍게 들고 있다가 계산한다.
    const latestRevision = task.scheduleRevisions[0] ?? null;
    return {
      id: task.id,
      title: task.title,
      category: task.category,
      startDate: (latestRevision?.startDate ?? task.startDate).toISOString(),
      dueDate: (latestRevision?.dueDate ?? task.dueDate).toISOString(),
      // Task 상세를 열기 전까지는 "최초 일정" 표시용 임시값으로 effective 날짜를
      // 그대로 쓴다 — Task Modal이 열리자마자 getTaskDetailAction 결과로 즉시
      // 정확한 원본 값으로 교체된다(TaskDetailPanel).
      originalStartDate: task.startDate.toISOString(),
      originalDueDate: task.dueDate.toISOString(),
      status: task.status,
      memo: null,
      goalName: task.goalName,
      halfDayPeriod: null,
      assigneeIds: task.assignees.map((a) => a.userId),
      projectDetail: task.projectDetail ? { projectName: task.projectDetail.projectName, categoryId: null } : null,
      meetingDetail: null,
      scheduleRevisions: [],
      comments: [],
      commentCount: task._count.comments,
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
