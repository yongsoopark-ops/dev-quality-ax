"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NotificationType, TaskCategory } from "@/app/generated/prisma/enums";
import { Prisma } from "@/app/generated/prisma/client";
import { resolveMentionedUserIds } from "@/lib/schedule/mention";
import type {
  ProjectCategoryOption,
  TaskCommentInfo,
  TaskFormInput,
  TaskScheduleRevisionInfo,
} from "@/lib/schedule/types";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("FORBIDDEN");
  return session;
}

/**
 * Update/Reply/Revision 공통 권한 규칙(요청사항 27): 작성자 본인이거나 ADMIN만
 * 수정/삭제할 수 있다. Client가 authorId/changedBy 등을 임의로 보내 우회할 수
 * 없도록, 항상 서버가 DB에서 다시 읽은 실제 authorId와 현재 Session을 비교한다
 * — UI에서 버튼을 숨기는 것과 별개로 이 검사가 최종 방어선이다.
 */
function assertCanModify(session: { user: { id: string; role: string } }, authorId: string): string | null {
  if (session.user.id === authorId || session.user.role === "ADMIN") return null;
  return "본인이 작성했거나 관리자만 수정/삭제할 수 있습니다.";
}

function validate(input: TaskFormInput): string | null {
  if (!input.title.trim()) return "업무명을 입력해 주세요.";

  if (input.category === TaskCategory.MEETING) {
    if (!input.meetingDate) return "미팅 날짜를 입력해 주세요.";
  } else {
    if (!input.startDate || !input.dueDate) return "시작일/마감일을 입력해 주세요.";
    if (new Date(input.dueDate).getTime() < new Date(input.startDate).getTime()) {
      return "마감일은 시작일보다 빠를 수 없습니다.";
    }
  }
  if (input.category === TaskCategory.PROJECT && !input.projectName.trim()) {
    return "프로젝트명을 입력해 주세요.";
  }
  if (input.category === TaskCategory.PERSONAL_GOAL && !input.goalName.trim()) {
    return "목표명을 입력해 주세요.";
  }
  if (input.category === TaskCategory.HALF_DAY && !input.halfDayPeriod) {
    return "오전/오후를 선택해 주세요.";
  }
  return null;
}

/**
 * goalName/halfDayPeriod은 해당 구분일 때만 남기고 나머지는 명시적으로 비운다.
 * MEETING은 사용자에게 시작일/마감일을 별도로 받지 않는다 — Calendar/Task 구조는
 * 그대로 유지하기 위해 서버에서 startDate=dueDate=meetingDate로 강제한다.
 */
function buildBaseTaskData(input: TaskFormInput) {
  const isMeeting = input.category === TaskCategory.MEETING;
  const meetingDate = isMeeting ? new Date(input.meetingDate) : null;

  return {
    title: input.title.trim(),
    category: input.category,
    startDate: isMeeting ? meetingDate! : new Date(input.startDate),
    dueDate: isMeeting ? meetingDate! : new Date(input.dueDate),
    status: input.status,
    memo: input.memo.trim() || null,
    goalName: input.category === TaskCategory.PERSONAL_GOAL ? input.goalName.trim() || null : null,
    halfDayPeriod: input.category === TaskCategory.HALF_DAY ? input.halfDayPeriod || null : null,
  };
}

/** meetingDate(날짜) + meetingStartTime(시간)을 기존 TaskMeetingDetail.time
 * DateTime 컬럼 하나로 결합한다 — Schema/저장 방식은 그대로 두고 입력 UI만
 * 두 필드로 나눈 것이라, 저장 직전에 다시 하나로 합치기만 하면 안전하다. */
function combineMeetingDateTime(input: TaskFormInput): Date | null {
  if (!input.meetingDate) return null;
  return new Date(`${input.meetingDate}T${input.meetingStartTime || "00:00"}`);
}

/**
 * category에 따라 필요 없는 조건부 Detail은 명시적으로 지운다(요청사항: 업무
 * 구분과 무관한 조건부 값은 저장하지 않음). TaskMeetingDetail 삭제는 Schema의
 * onDelete: Cascade로 TaskMeetingAttendee까지 함께 정리된다.
 *
 * pwStage(PW 단계)는 UI/저장 로직에서 제거됐다 — 여기서는 더 이상 읽거나 쓰지
 * 않는다. update에서 생략하면 기존 값(예: 레거시 "PW3")은 그대로 보존되고,
 * create에서 생략하면 nullable 컬럼이라 null로 남는다.
 */
async function syncTaskDetails(tx: Prisma.TransactionClient, taskId: string, input: TaskFormInput) {
  if (input.category === TaskCategory.PROJECT) {
    await tx.taskMeetingDetail.deleteMany({ where: { taskId } });
    await tx.taskProjectDetail.upsert({
      where: { taskId },
      update: { projectName: input.projectName.trim(), categoryId: input.categoryId || null },
      create: {
        taskId,
        projectName: input.projectName.trim(),
        categoryId: input.categoryId || null,
      },
    });
  } else if (input.category === TaskCategory.MEETING) {
    await tx.taskProjectDetail.deleteMany({ where: { taskId } });
    const meetingTime = combineMeetingDateTime(input);
    await tx.taskMeetingDetail.upsert({
      where: { taskId },
      update: {
        department: input.department.trim() || null,
        time: meetingTime,
        location: input.location.trim() || null,
      },
      create: {
        taskId,
        department: input.department.trim() || null,
        time: meetingTime,
        location: input.location.trim() || null,
      },
    });
    await tx.taskMeetingAttendee.deleteMany({ where: { meetingTaskId: taskId } });
    if (input.attendeeIds.length > 0) {
      await tx.taskMeetingAttendee.createMany({
        data: input.attendeeIds.map((userId) => ({ meetingTaskId: taskId, userId })),
      });
    }
  } else {
    await tx.taskProjectDetail.deleteMany({ where: { taskId } });
    await tx.taskMeetingDetail.deleteMany({ where: { taskId } });
  }
}

/**
 * 신규 Task는 담당자를 사용자가 고르지 않는다(요청사항 7) — 로그인된 Session의
 * User를 서버에서 그대로 유일한 TaskAssignee로 등록한다. Client는 userId를
 * 절대 넘기지 않으며, 여기서 현재 User가 ACTIVE 상태인지도 함께 검증한다.
 */
export async function createTaskAction(input: TaskFormInput): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  if (session.user.status !== "ACTIVE") {
    return { error: "활성 상태의 계정만 업무를 등록할 수 있습니다." };
  }

  const validationError = validate(input);
  if (validationError) return { error: validationError };

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: { ...buildBaseTaskData(input), createdBy: session.user.id },
    });

    await tx.taskAssignee.create({
      data: { taskId: task.id, userId: session.user.id },
    });

    await syncTaskDetails(tx, task.id, input);
  });

  revalidatePath("/schedule");
  return { ok: true };
}

/** 담당자 변경 기능은 이번 Step에서 다루지 않는다 — 기존 TaskAssignee는 건드리지 않는다. */
export async function updateTaskAction(
  taskId: string,
  input: TaskFormInput,
): Promise<{ ok?: true; error?: string }> {
  await requireUser();

  const validationError = validate(input);
  if (validationError) return { error: validationError };

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: buildBaseTaskData(input) });
    await syncTaskDetails(tx, taskId, input);
  });

  revalidatePath("/schedule");
  return { ok: true };
}

/**
 * Calendar Drag(이동)/Resize 전용 최소 Action — 날짜만 바꾼다. updateTaskAction과
 * 달리 업무구분별 상세(TaskProjectDetail 등)나 TaskAssignee/참석자는 절대 건드리지
 * 않는다(요청사항: Drag/Resize는 날짜만 변경, 담당자 변경은 이번 Step 범위 아님).
 *
 * "공식 일정 변경"(+ 일정 변경) 기능이 생긴 뒤로는 이 Action이 실제로 고치는
 * 대상이 갈린다 — Drag/Resize는 미세조정이라 새 이력(Revision)을 만들지 않고:
 *   - 이 Task에 Revision이 하나도 없으면: 지금까지처럼 Task.startDate/dueDate를 고친다.
 *   - Revision이 있으면: "가장 최신"(revisionNo 최대) Revision의 날짜만 그 자리에서
 *     고친다 — Task 원본이나 그보다 이전 Revision은 건드리지 않는다.
 *
 * MEETING/HALF_DAY는 하루짜리 일정이라 Client에서 Resize 자체를 막지만, 여기서도
 * 방어적으로 dueDate를 startDate에 맞춰 하루로 되돌린다. MEETING은 Task.startDate/
 * dueDate와 별개로 TaskMeetingDetail.time에도 날짜가 들어있어(시:분 포함), 두 값이
 * 어긋나지 않도록 시간(시:분)은 유지한 채 날짜만 함께 옮긴다(MEETING은 Revision을
 * 만들지 않는 범위라 이 분기는 항상 Task 원본 쪽에서만 일어난다).
 */
export async function updateTaskDatesAction(
  taskId: string,
  startDate: string,
  dueDate: string,
): Promise<{ ok?: true; error?: string }> {
  await requireUser();
  if (!startDate || !dueDate) return { error: "날짜가 올바르지 않습니다." };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      meetingDetail: true,
      scheduleRevisions: { orderBy: { revisionNo: "desc" }, take: 1 },
    },
  });
  if (!task) return { error: "업무를 찾을 수 없습니다." };

  const isSingleDayOnly = task.category === TaskCategory.MEETING || task.category === TaskCategory.HALF_DAY;
  const newStart = new Date(startDate);
  const newDue = isSingleDayOnly ? newStart : new Date(dueDate);
  if (newDue.getTime() < newStart.getTime()) {
    return { error: "마감일은 시작일보다 빠를 수 없습니다." };
  }

  const latestRevision = task.scheduleRevisions[0] ?? null;

  await prisma.$transaction(async (tx) => {
    if (latestRevision) {
      await tx.taskScheduleRevision.update({
        where: { id: latestRevision.id },
        data: { startDate: newStart, dueDate: newDue },
      });
    } else {
      await tx.task.update({ where: { id: taskId }, data: { startDate: newStart, dueDate: newDue } });
    }

    if (task.category === TaskCategory.MEETING && task.meetingDetail?.time) {
      const oldTime = task.meetingDetail.time;
      const newTime = new Date(newStart);
      newTime.setHours(oldTime.getHours(), oldTime.getMinutes(), 0, 0);
      await tx.taskMeetingDetail.update({ where: { taskId }, data: { time: newTime } });
    }
  });

  revalidatePath("/schedule");
  return { ok: true };
}

/** startDate/dueDate/reasonText 공통 검증 — "+ 일정 변경 적용"과 저장된 Revision
 * 수정 양쪽에서 재사용한다. 공식 변경이므로 변경 사유는 필수다(요청사항 16). */
function validateRevisionInput(startDate: string, dueDate: string, reasonText: string): string | null {
  if (!startDate || !dueDate) return "변경 시작일/마감일을 입력해 주세요.";
  if (new Date(dueDate).getTime() < new Date(startDate).getTime()) {
    return "변경 마감일은 변경 시작일보다 빠를 수 없습니다.";
  }
  if (!reasonText.trim()) return "변경 사유를 입력해 주세요.";
  return null;
}

/**
 * "변경 적용" — 업무상 의미 있는 공식 일정 변경만 여기로 쌓인다(Drag/Resize와
 * 정책이 명확히 분리됨). "+ 일정 변경" 클릭 자체는 Client Draft만 만들고 이
 * Action을 호출하지 않는다 — 날짜/사유를 채우고 "변경 적용"을 눌렀을 때만
 * 실제로 Row가 생긴다(요청사항 14). MEETING/HALF_DAY는 하루짜리 일정 특성상
 * 공식 Revision 관리 대상에서 제외한다(요청사항 26) — Client도 버튼을 아예
 * 숨기지만, 여기서도 방어적으로 한 번 더 막는다.
 *
 * revisionNo는 Client가 정하지 않는다. "지금까지 실제로 쓰인 가장 큰 번호"를
 * Task.lastRevisionNo(삭제해도 줄지 않는 단조 카운터)로 기억해 두고, 매번
 * max(lastRevisionNo, 현재 살아있는 Revision 중 최댓값) + 1로 계산한다 — 뒤쪽
 * max는 이 카운터가 아직 없던 과거에 만들어진 Row와의 충돌까지 방어한다.
 * 그래도 동시 클릭으로 두 요청이 같은 값을 계산하면 (taskId, revisionNo) 유니크
 * 제약이 최종 방어선이라 하나는 반드시 실패하고(P2002), 다시 시도하도록 안내한다.
 */
export async function addTaskScheduleRevisionAction(
  taskId: string,
  startDate: string,
  dueDate: string,
  reasonText: string,
): Promise<{ revision?: TaskScheduleRevisionInfo; error?: string }> {
  const session = await requireUser();

  const validationError = validateRevisionInput(startDate, dueDate, reasonText);
  if (validationError) return { error: validationError };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: { scheduleRevisions: { orderBy: { revisionNo: "desc" }, take: 1 } },
      });
      if (!task) throw new Error("업무를 찾을 수 없습니다.");
      if (task.category === TaskCategory.MEETING || task.category === TaskCategory.HALF_DAY) {
        throw new Error("미팅/반차 업무는 공식 일정 변경 이력을 지원하지 않습니다.");
      }

      const currentMaxLive = task.scheduleRevisions[0]?.revisionNo ?? 0;
      const nextRevisionNo = Math.max(task.lastRevisionNo, currentMaxLive) + 1;

      const revision = await tx.taskScheduleRevision.create({
        data: {
          taskId,
          revisionNo: nextRevisionNo,
          startDate: new Date(startDate),
          dueDate: new Date(dueDate),
          reasonText: reasonText.trim(),
          createdBy: session.user.id,
        },
        include: { creator: { select: { name: true } } },
      });
      await tx.task.update({ where: { id: taskId }, data: { lastRevisionNo: nextRevisionNo } });
      return revision;
    });

    revalidatePath("/schedule");
    return {
      revision: {
        id: created.id,
        revisionNo: created.revisionNo,
        startDate: created.startDate.toISOString(),
        dueDate: created.dueDate.toISOString(),
        reasonText: created.reasonText,
        createdBy: created.createdBy,
        createdByName: created.creator.name,
        createdAt: created.createdAt.toISOString(),
      },
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "동시에 다른 변경이 저장되었습니다. 새로고침 후 다시 시도해 주세요." };
    }
    return { error: err instanceof Error ? err.message : "일정 변경을 적용하지 못했습니다." };
  }
}

/**
 * 저장된 Revision(차수 무관 — 최신이든 과거 이력이든)의 날짜/사유를 고친다
 * (요청사항 21: 과거 Revision도 수정 가능, 다만 Calendar에는 최신 Revision만
 * 영향을 준다 — 그 판단은 page.tsx의 "최신 유효 일정" 계산이 항상 최신
 * revisionNo를 보는 것으로 자동 처리되어 여기서 따로 분기할 필요가 없다).
 * revisionNo/createdBy/createdAt은 이 Action으로 절대 바꿀 수 없다.
 *
 * 권한: 작성자 본인 또는 ADMIN만(요청사항 27) — Client가 숨기는 것과 별개로
 * 서버에서 다시 검증한다.
 */
export async function updateTaskScheduleRevisionAction(
  revisionId: string,
  startDate: string,
  dueDate: string,
  reasonText: string,
): Promise<{ revision?: TaskScheduleRevisionInfo; error?: string }> {
  const session = await requireUser();

  const validationError = validateRevisionInput(startDate, dueDate, reasonText);
  if (validationError) return { error: validationError };

  const revision = await prisma.taskScheduleRevision.findUnique({ where: { id: revisionId } });
  if (!revision) return { error: "일정 변경 이력을 찾을 수 없습니다." };

  const permissionError = assertCanModify(session, revision.createdBy);
  if (permissionError) return { error: permissionError };

  const updated = await prisma.taskScheduleRevision.update({
    where: { id: revisionId },
    data: { startDate: new Date(startDate), dueDate: new Date(dueDate), reasonText: reasonText.trim() },
    include: { creator: { select: { name: true } } },
  });

  revalidatePath("/schedule");
  return {
    revision: {
      id: updated.id,
      revisionNo: updated.revisionNo,
      startDate: updated.startDate.toISOString(),
      dueDate: updated.dueDate.toISOString(),
      reasonText: updated.reasonText,
      createdBy: updated.createdBy,
      createdByName: updated.creator.name,
      createdAt: updated.createdAt.toISOString(),
    },
  };
}

/**
 * 저장된 Revision 삭제(요청사항 23). revisionNo는 재사용하지 않으므로(Task.
 * lastRevisionNo가 그대로 남아 있음) 삭제 후 "다음 생성"은 항상 새 번호로
 * 만들어진다 — 별도 재번호 로직이 필요 없다. Calendar에 표시될 "최신 유효
 * 일정"은 page.tsx가 매 조회 시 "남아있는 Revision 중 최댓값"으로 다시 계산하므로
 * (없으면 Task 원본으로) 여기서 별도로 손댈 것이 없다.
 */
export async function deleteTaskScheduleRevisionAction(revisionId: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();

  const revision = await prisma.taskScheduleRevision.findUnique({ where: { id: revisionId } });
  if (!revision) return { error: "일정 변경 이력을 찾을 수 없습니다." };

  const permissionError = assertCanModify(session, revision.createdBy);
  if (permissionError) return { error: permissionError };

  await prisma.taskScheduleRevision.delete({ where: { id: revisionId } });

  revalidatePath("/schedule");
  return { ok: true };
}

// ---------------- Task Comment(말풍선형 Update/답변) ----------------
// Task.memo(단순 Free Text)를 대체하는 시스템. 작성자는 항상 Session User로
// 서버에서 기록하고, Client는 authorId를 절대 넘기지 못한다.

function commentToInfo(comment: {
  id: string;
  authorId: string;
  author: { name: string | null };
  parentId: string | null;
  contentJson: string;
  plainText: string;
  createdAt: Date;
  updatedAt: Date;
}): TaskCommentInfo {
  return {
    id: comment.id,
    authorId: comment.authorId,
    authorName: comment.author.name,
    parentId: comment.parentId,
    contentJson: comment.contentJson,
    plainText: comment.plainText,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    replies: [],
  };
}

/**
 * Update/답변의 contentJson 안 Mention Node(@단일/@복수/@All)를 분석해 대상 User
 * 각각에게 Notification을 만든다(요청사항 3, 4). @All은 ACTIVE User 전체로
 * 펼쳐지고, 작성자 본인은 항상 제외한다(resolveMentionedUserIds가 처리) — 이름을
 * AI로 추론/매칭하지 않고 Tiptap Mention Node의 attrs.id(userId/"ALL")만 신뢰한다
 * (요청사항 13, AI API 0회).
 *
 * 같은 commentId + userId + type(MENTION) 조합은 Schema의 @@unique 제약이 최종
 * 방어선이지만, 여기서도 먼저 "이미 이 Comment로 알림을 받은 User" 목록을 조회해
 * 새로 추가된 대상에게만 만든다(요청사항 5) — Comment 수정으로 Mention이
 * 추가/삭제돼도 기존에 받은 알림은 건드리지 않고, 중복도 생성하지 않는다. Comment
 * 저장과 항상 같은 Transaction 안에서 실행된다(요청사항 4).
 */
async function createMentionNotifications(
  tx: Prisma.TransactionClient,
  params: {
    taskId: string;
    taskTitle: string;
    commentId: string;
    actorId: string;
    actorName: string | null;
    contentJson: string;
    plainText: string;
  },
) {
  const activeUsers = await tx.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const mentionedUserIds = resolveMentionedUserIds(
    params.contentJson,
    activeUsers.map((u) => u.id),
    params.actorId,
  );
  if (mentionedUserIds.length === 0) return;

  const alreadyNotified = await tx.notification.findMany({
    where: { commentId: params.commentId, type: NotificationType.MENTION, userId: { in: mentionedUserIds } },
    select: { userId: true },
  });
  const alreadyNotifiedIds = new Set(alreadyNotified.map((n) => n.userId));
  const newTargets = mentionedUserIds.filter((id) => !alreadyNotifiedIds.has(id));
  if (newTargets.length === 0) return;

  const title = `${params.actorName ?? "알 수 없음"}님이 회원님을 멘션했습니다`;
  const message = `${params.taskTitle} · ${params.plainText.slice(0, 80)}`;

  await tx.notification.createMany({
    data: newTargets.map((userId) => ({
      userId,
      type: NotificationType.MENTION,
      taskId: params.taskId,
      commentId: params.commentId,
      actorId: params.actorId,
      title,
      message,
    })),
  });
}

/** 새 업데이트(원문) 작성 — parentId 없이 최상위로 만든다. */
export async function createTaskCommentAction(
  taskId: string,
  contentJson: string,
  plainText: string,
): Promise<{ comment?: TaskCommentInfo; error?: string }> {
  const session = await requireUser();
  if (!plainText.trim()) return { error: "내용을 입력해 주세요." };

  const created = await prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({
      data: { taskId, authorId: session.user.id, contentJson, plainText: plainText.trim() },
      include: { author: { select: { name: true } } },
    });
    const task = await tx.task.findUnique({ where: { id: taskId }, select: { title: true } });
    await createMentionNotifications(tx, {
      taskId,
      taskTitle: task?.title ?? "",
      commentId: comment.id,
      actorId: session.user.id,
      actorName: comment.author.name,
      contentJson: comment.contentJson,
      plainText: comment.plainText,
    });
    return comment;
  });

  revalidatePath("/schedule");
  return { comment: commentToInfo(created) };
}

/**
 * 답변 작성 — 반드시 최상위 Comment에만 달린다(1단계 제한). parent 자신이 이미
 * 답변(parentId가 있음)이면 "답변의 답변"이 되므로 거부한다. 단순 답변 작성만으로
 * 원문 작성자에게 자동 Notification을 보내지는 않는다(요청사항 6) — 답변 안에
 * 명시적 @Mention이 있을 때만 알림이 생긴다.
 */
export async function createTaskCommentReplyAction(
  parentId: string,
  contentJson: string,
  plainText: string,
): Promise<{ comment?: TaskCommentInfo; error?: string }> {
  const session = await requireUser();
  if (!plainText.trim()) return { error: "내용을 입력해 주세요." };

  const parent = await prisma.taskComment.findUnique({ where: { id: parentId } });
  if (!parent) return { error: "원본 업데이트를 찾을 수 없습니다." };
  if (parent.parentId !== null) return { error: "답변에는 다시 답변할 수 없습니다." };

  const created = await prisma.$transaction(async (tx) => {
    const reply = await tx.taskComment.create({
      data: { taskId: parent.taskId, authorId: session.user.id, parentId, contentJson, plainText: plainText.trim() },
      include: { author: { select: { name: true } } },
    });
    const task = await tx.task.findUnique({ where: { id: parent.taskId }, select: { title: true } });
    await createMentionNotifications(tx, {
      taskId: parent.taskId,
      taskTitle: task?.title ?? "",
      commentId: reply.id,
      actorId: session.user.id,
      actorName: reply.author.name,
      contentJson: reply.contentJson,
      plainText: reply.plainText,
    });
    return reply;
  });

  revalidatePath("/schedule");
  return { comment: commentToInfo(created) };
}

/**
 * Update/답변 공용 수정 — 둘 다 TaskComment 한 테이블이라 같은 Action을 그대로
 * 쓴다(요청사항 28: Reply는 별도 Action 없이 재사용). 권한: 작성자 본인 또는
 * ADMIN만(요청사항 27), 서버에서 다시 검증한다. updatedAt은 Prisma의
 * @updatedAt이 자동으로 갱신한다.
 *
 * 수정으로 새 Mention이 추가되면 그 대상에게만 Notification을 만든다(요청사항
 * 5) — createMentionNotifications의 dedupe가 "이미 이 Comment로 알림을 받은
 * User"를 걸러내므로 기존 Mention 대상에게 다시 만들어지지 않고, Mention이
 * 삭제된 경우에도 이미 보낸 Notification은 그대로 남겨둔다(자동 삭제하지 않음).
 */
export async function updateTaskCommentAction(
  commentId: string,
  contentJson: string,
  plainText: string,
): Promise<{ comment?: TaskCommentInfo; error?: string }> {
  const session = await requireUser();
  if (!plainText.trim()) return { error: "내용을 입력해 주세요." };

  const existing = await prisma.taskComment.findUnique({ where: { id: commentId } });
  if (!existing) return { error: "업데이트를 찾을 수 없습니다." };

  const permissionError = assertCanModify(session, existing.authorId);
  if (permissionError) return { error: permissionError };

  const updated = await prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.update({
      where: { id: commentId },
      data: { contentJson, plainText: plainText.trim() },
      include: { author: { select: { name: true } } },
    });
    const task = await tx.task.findUnique({ where: { id: comment.taskId }, select: { title: true } });
    await createMentionNotifications(tx, {
      taskId: comment.taskId,
      taskTitle: task?.title ?? "",
      commentId: comment.id,
      actorId: comment.authorId,
      actorName: comment.author.name,
      contentJson: comment.contentJson,
      plainText: comment.plainText,
    });
    return comment;
  });

  revalidatePath("/schedule");
  return { comment: commentToInfo(updated) };
}

/**
 * Update/답변 공용 삭제. 원문 Update를 지우면 Schema의 self-relation
 * onDelete: Cascade로 그 아래 답변도 함께 지워진다(요청사항 9) — 답변만 지울
 * 때는 그 답변 하나만 사라지고 원문은 그대로 남는다(요청사항 12).
 */
export async function deleteTaskCommentAction(commentId: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();

  const existing = await prisma.taskComment.findUnique({ where: { id: commentId } });
  if (!existing) return { error: "업데이트를 찾을 수 없습니다." };

  const permissionError = assertCanModify(session, existing.authorId);
  if (permissionError) return { error: permissionError };

  await prisma.taskComment.delete({ where: { id: commentId } });

  revalidatePath("/schedule");
  return { ok: true };
}

export async function deleteTaskAction(taskId: string): Promise<{ ok?: true; error?: string }> {
  await requireUser();
  if (!taskId) return { error: "삭제할 업무를 찾을 수 없습니다." };

  // Task 삭제 시 TaskAssignee/TaskProjectDetail/TaskMeetingDetail(+참석자)이
  // Schema의 onDelete: Cascade로 함께 정리된다 — 별도 정리 코드가 필요 없다.
  await prisma.task.delete({ where: { id: taskId } });

  revalidatePath("/schedule");
  return { ok: true };
}

// ---------------- 프로젝트 카테고리(ProjectCategory) 관리 ----------------
// 별도 화면 없이 Task Form 안에서 바로 추가/삭제한다 — 사용자 화면에서 관리
// 가능해야 하고 불필요한 새 Route/마스터 관리 UI를 따로 만들 필요가 없어서다.

export async function createProjectCategoryAction(
  name: string,
): Promise<{ category?: ProjectCategoryOption; error?: string }> {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { error: "카테고리명을 입력해 주세요." };

  const existing = await prisma.projectCategory.findUnique({ where: { name: trimmed } });
  if (existing) {
    if (!existing.active) {
      const reactivated = await prisma.projectCategory.update({ where: { id: existing.id }, data: { active: true } });
      revalidatePath("/schedule");
      return { category: reactivated };
    }
    return { error: "이미 존재하는 카테고리명입니다." };
  }

  const category = await prisma.projectCategory.create({ data: { name: trimmed } });
  revalidatePath("/schedule");
  return { category };
}

/** 사용 이력(TaskProjectDetail 참조)이 있으면 삭제 대신 비활성화한다. */
export async function removeProjectCategoryAction(
  id: string,
): Promise<{ ok?: true; deactivated?: true; error?: string }> {
  await requireUser();

  const usageCount = await prisma.taskProjectDetail.count({ where: { categoryId: id } });
  if (usageCount > 0) {
    await prisma.projectCategory.update({ where: { id }, data: { active: false } });
    revalidatePath("/schedule");
    return { deactivated: true };
  }

  await prisma.projectCategory.delete({ where: { id } });
  revalidatePath("/schedule");
  return { ok: true };
}

export async function toggleProjectCategoryActiveAction(
  id: string,
  active: boolean,
): Promise<{ ok?: true; error?: string }> {
  await requireUser();
  await prisma.projectCategory.update({ where: { id }, data: { active } });
  revalidatePath("/schedule");
  return { ok: true };
}
