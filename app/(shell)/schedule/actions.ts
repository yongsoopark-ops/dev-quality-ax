"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/cache/memoCache";
import {
  DEFAULT_PROJECT_CATEGORY_GROUP_ID,
  PROJECT_CATEGORIES_CACHE_KEY,
  PROJECT_CATEGORY_GROUPS_CACHE_KEY,
  TASK_CATEGORY_KEY as TaskCategory,
  TASK_CATEGORY_OPTIONS_CACHE_KEY,
  TASK_STATUS_KEY as TaskStatus,
  TASK_STATUS_OPTIONS_CACHE_KEY,
} from "@/lib/schedule/constants";
import { NotificationType } from "@/app/generated/prisma/enums";
import { Prisma } from "@/app/generated/prisma/client";
import { resolveMentionedUserIds } from "@/lib/schedule/mention";
import { MONTHLY_WEEK_ORDINAL_OPTIONS, WEEKDAY_ORDER } from "@/lib/schedule/recurrence";
import type {
  ProjectCategoryGroupOption,
  ProjectCategoryOption,
  ScheduleOptionInfo,
  TaskCommentInfo,
  TaskDetailInfo,
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

/** Step 5B-4(사용자 정의 상태/업무구분 설정) — 이 설정은 전체 Schedule 화면에
 * 영향을 주므로 lib/meetingTemplates/actions.ts의 requireAdmin과 동일한
 * 패턴으로 ADMIN만 변경 가능하게 한다. Client가 role을 속일 수 없도록 항상
 * 서버 Session에서 다시 확인한다. */
function requireAdminRole(session: { user: { role: string } }): string | null {
  if (session.user.role !== "ADMIN") return "관리자만 설정을 변경할 수 있습니다.";
  return null;
}

function validate(input: TaskFormInput): string | null {
  if (!input.title.trim()) return "업무명을 입력해 주세요.";

  if (input.category === TaskCategory.MEETING) {
    // Step 5B-7 — 반복(매주/매월)일 때는 Client가 반복 규칙으로 미리 계산한
    // 값을 meetingDate에 채워 보낸다(RecurrenceFields 주석 참고) — 서버는
    // "비어 있지 않은가"만 확인하면 되고, 그 값이 실제로 반복 요일/규칙과
    // 맞는지까지 재검증하지는 않는다(Client 계산 로직을 신뢰 — 사용자가 직접
    // 입력할 수 없는 값이라 조작 여지가 project startDate만큼 크지 않다).
    if (!input.meetingDate) return "미팅 날짜를 입력해 주세요.";
    if (!input.meetingStartTime) return "시작 시간을 입력해 주세요.";
    if (!input.meetingEndTime) return "종료 시간을 입력해 주세요.";
    if (input.meetingEndTime <= input.meetingStartTime) return "종료 시간은 시작 시간보다 이후여야 합니다.";
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

  // Step(담당자 UX 개선) — "직접 지정"은 최소 1명 선택해야 한다. "내 일정"/
  // "공통"은 서버가 각각 로그인 사용자/빈 배열로 강제하므로 여기서 검증할
  // 것이 없다.
  if (input.assigneeMode === "CUSTOM" && input.assigneeIds.length === 0) {
    return "담당자를 1명 이상 선택해 주세요.";
  }

  // Step 5B-1(반복 일정) — recurrenceType이 NONE이면 검증할 것이 없다(기존과 동일).
  // Step(반복 일정 UX 개선) — interval은 모든 반복 타입 공용으로 항상
  // 양의 정수여야 한다.
  if (input.recurrenceType !== "NONE") {
    const interval = Number(input.recurrenceInterval);
    if (!Number.isInteger(interval) || interval < 1) return "반복 간격은 1 이상의 정수여야 합니다.";
  }

  if (input.recurrenceType === "WEEKLY") {
    if (input.recurrenceWeekdays.length === 0) return "반복 요일을 선택해 주세요.";
    if (!input.recurrenceWeekdays.every((w) => WEEKDAY_ORDER.includes(w))) {
      return "반복 요일이 올바르지 않습니다.";
    }
  } else if (input.recurrenceType === "MONTHLY") {
    if (input.recurrenceMonthlyRuleType === "DAY_OF_MONTH") {
      const day = Number(input.recurrenceMonthDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) return "반복할 날짜(1~31)를 선택해 주세요.";
    } else if (input.recurrenceMonthlyRuleType === "NTH_WEEKDAY") {
      if (!WEEKDAY_ORDER.includes(input.recurrenceMonthlyWeekday)) return "반복 요일을 선택해 주세요.";
      const ordinal = Number(input.recurrenceMonthlyWeekOrdinal);
      if (!MONTHLY_WEEK_ORDINAL_OPTIONS.includes(ordinal)) return "몇째 주인지 선택해 주세요.";
    } else {
      return "매월 반복 방식을 선택해 주세요.";
    }
  }
  // Step(반복 일정 UX 개선) — 종료 조건 3가지(종료일 지정/N회 반복/무한 반복)
  // 중 선택한 한쪽만 검증한다. DAILY/YEARLY도 WEEKLY/MONTHLY와 동일하게
  // 이 종료 조건 검증을 공유한다.
  if (input.recurrenceType !== "NONE") {
    if (input.recurrenceEndType === "DATE") {
      if (!input.recurrenceEndDate) return "반복 종료일을 선택해 주세요.";
      const anchorDate = input.category === TaskCategory.MEETING ? input.meetingDate : input.startDate;
      if (anchorDate && new Date(input.recurrenceEndDate).getTime() < new Date(anchorDate).getTime()) {
        return "반복 종료일은 시작일보다 빠를 수 없습니다.";
      }
    } else if (input.recurrenceEndType === "COUNT") {
      const count = Number(input.recurrenceCount);
      if (!Number.isInteger(count) || count < 1) return "반복 횟수는 1 이상의 정수여야 합니다.";
    }
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
    // Step 5B-4 — 진짜 값은 categoryOptionId/statusOptionId뿐이다. 레거시
    // category/status enum 컬럼(nullable로 완화됨)에는 더 이상 쓰지 않는다 —
    // 사용자가 새로 추가한 업무구분/상태는 애초에 대응하는 enum 값이 없다.
    categoryOptionId: input.category,
    startDate: isMeeting ? meetingDate! : new Date(input.startDate),
    dueDate: isMeeting ? meetingDate! : new Date(input.dueDate),
    statusOptionId: input.status,
    memo: input.memo.trim() || null,
    goalName: input.category === TaskCategory.PERSONAL_GOAL ? input.goalName.trim() || null : null,
    halfDayPeriod: input.category === TaskCategory.HALF_DAY ? input.halfDayPeriod || null : null,
    // Step(담당자 UX 개선) — "공통"을 고른 경우에만 true. "내 일정"/"직접
    // 지정"은 항상 false(assignees로 실제 담당자를 표현하므로).
    isCommonAssignee: input.assigneeMode === "COMMON",
    ...buildRecurrenceData(input),
  };
}

/**
 * Step 5B-1(반복 일정) — recurrenceType에 따라 관련 없는 필드는 항상 명시적으로
 * null/빈 배열로 비운다(goalName/halfDayPeriod와 같은 패턴).
 * Step(반복 일정 UX 개선) — interval을 더 이상 1로 고정하지 않고 input에서
 * 그대로 읽는다(요청사항: 격주=WEEKLY+interval 2, 매일 N일마다 등 기존 interval
 * 컬럼 재사용). 종료 조건도 "종료일/N회/무한" 3가지 중 recurrenceEndType이
 * 가리키는 한쪽만 채우고 나머지는 항상 null로 비운다 — endDate와 count가
 * 동시에 값을 갖는 경우는 절대 없다(lib/schedule/recurrence.ts의 count 계산이
 * 이 불변조건을 전제로 한다).
 */
function buildRecurrenceData(input: TaskFormInput) {
  if (input.recurrenceType === "NONE") {
    return {
      recurrenceType: "NONE" as const,
      recurrenceInterval: 1,
      recurrenceWeekdays: [],
      recurrenceMonthlyRuleType: null,
      recurrenceMonthDay: null,
      recurrenceMonthlyWeekOrdinal: null,
      recurrenceMonthlyWeekday: null,
      recurrenceEndDate: null,
      recurrenceCount: null,
    };
  }

  const interval = Math.max(1, Math.floor(Number(input.recurrenceInterval)) || 1);
  const shared = {
    recurrenceInterval: interval,
    recurrenceEndDate: input.recurrenceEndType === "DATE" && input.recurrenceEndDate ? new Date(input.recurrenceEndDate) : null,
    recurrenceCount: input.recurrenceEndType === "COUNT" && input.recurrenceCount ? Number(input.recurrenceCount) : null,
  };

  if (input.recurrenceType === "DAILY") {
    return {
      recurrenceType: "DAILY" as const,
      ...shared,
      recurrenceWeekdays: [],
      recurrenceMonthlyRuleType: null,
      recurrenceMonthDay: null,
      recurrenceMonthlyWeekOrdinal: null,
      recurrenceMonthlyWeekday: null,
    };
  }

  if (input.recurrenceType === "YEARLY") {
    return {
      recurrenceType: "YEARLY" as const,
      ...shared,
      recurrenceWeekdays: [],
      recurrenceMonthlyRuleType: null,
      recurrenceMonthDay: null,
      recurrenceMonthlyWeekOrdinal: null,
      recurrenceMonthlyWeekday: null,
    };
  }

  if (input.recurrenceType === "WEEKLY") {
    return {
      recurrenceType: "WEEKLY" as const,
      ...shared,
      recurrenceWeekdays: input.recurrenceWeekdays,
      recurrenceMonthlyRuleType: null,
      recurrenceMonthDay: null,
      recurrenceMonthlyWeekOrdinal: null,
      recurrenceMonthlyWeekday: null,
    };
  }

  // MONTHLY
  if (input.recurrenceMonthlyRuleType === "NTH_WEEKDAY") {
    return {
      recurrenceType: "MONTHLY" as const,
      ...shared,
      recurrenceWeekdays: [],
      recurrenceMonthlyRuleType: "NTH_WEEKDAY" as const,
      recurrenceMonthDay: null,
      recurrenceMonthlyWeekOrdinal: Number(input.recurrenceMonthlyWeekOrdinal),
      recurrenceMonthlyWeekday: input.recurrenceMonthlyWeekday,
    };
  }
  return {
    recurrenceType: "MONTHLY" as const,
    ...shared,
    recurrenceWeekdays: [],
    recurrenceMonthlyRuleType: "DAY_OF_MONTH" as const,
    recurrenceMonthDay: Number(input.recurrenceMonthDay),
    recurrenceMonthlyWeekOrdinal: null,
    recurrenceMonthlyWeekday: null,
  };
}

/** meetingDate(날짜) + meetingStartTime(시간)을 기존 TaskMeetingDetail.time
 * DateTime 컬럼 하나로 결합한다 — Schema/저장 방식은 그대로 두고 입력 UI만
 * 두 필드로 나눈 것이라, 저장 직전에 다시 하나로 합치기만 하면 안전하다. */
function combineMeetingDateTime(input: TaskFormInput): Date | null {
  if (!input.meetingDate) return null;
  return new Date(`${input.meetingDate}T${input.meetingStartTime || "00:00"}`);
}

/** Step 5B-7(시작/종료시간) — endTime도 같은 날짜(meetingDate) + meetingEndTime을
 * 결합한다. "동일 날짜 내 미팅을 V1 기준으로 한다"(요청사항)라 자정을 넘기는
 * 경우는 다루지 않는다 — validate()가 이미 종료 시간 > 시작 시간을 문자열
 * 비교로 검증하므로 여기서 다시 확인하지 않는다. */
function combineMeetingEndDateTime(input: TaskFormInput): Date | null {
  if (!input.meetingDate || !input.meetingEndTime) return null;
  return new Date(`${input.meetingDate}T${input.meetingEndTime}`);
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
    const meetingEndTime = combineMeetingEndDateTime(input);
    await tx.taskMeetingDetail.upsert({
      where: { taskId },
      update: {
        department: input.department.trim() || null,
        time: meetingTime,
        endTime: meetingEndTime,
        location: input.location.trim() || null,
      },
      create: {
        taskId,
        department: input.department.trim() || null,
        time: meetingTime,
        endTime: meetingEndTime,
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
/**
 * Step(담당자 UX 개선) — assigneeMode에 따라 실제 저장할 담당자 목록을
 * 결정한다. "내 일정"은 Client가 currentUserId를 안 보내도(혹은 보내도)
 * 항상 서버가 로그인 사용자로 강제한다 — Client 조작으로 다른 사람을 "내
 * 일정"으로 등록할 수 없다. "공통"은 항상 빈 배열(TaskAssignee 없음,
 * isCommonAssignee=true가 buildBaseTaskData에서 이미 채워진다). "직접
 * 지정"은 validate()가 이미 1명 이상을 보장한 input.assigneeIds 그대로 쓴다.
 */
function resolveAssigneeUserIds(input: TaskFormInput, currentUserId: string): string[] {
  if (input.assigneeMode === "ME") return [currentUserId];
  if (input.assigneeMode === "COMMON") return [];
  return input.assigneeIds;
}

export async function createTaskAction(input: TaskFormInput): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  if (session.user.status !== "ACTIVE") {
    return { error: "활성 상태의 계정만 업무를 등록할 수 있습니다." };
  }

  const validationError = validate(input);
  if (validationError) return { error: validationError };

  const assigneeUserIds = resolveAssigneeUserIds(input, session.user.id);

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: { ...buildBaseTaskData(input), createdBy: session.user.id },
    });

    if (assigneeUserIds.length > 0) {
      await tx.taskAssignee.createMany({
        data: assigneeUserIds.map((userId) => ({ taskId: task.id, userId })),
      });
    }

    await syncTaskDetails(tx, task.id, input);
  });

  revalidatePath("/schedule");
  return { ok: true };
}

/**
 * Step(담당자 UX 개선) — 이전 Step까지는 담당자 변경을 다루지 않았지만
 * (기존 TaskAssignee를 그대로 보존), 이번 Step은 "직접 지정" 화면에서 실제로
 * 담당자를 바꿀 수 있어야 하므로 attendeeIds(참석자) 동기화와 같은 패턴
 * (deleteMany + createMany)으로 TaskAssignee를 새로 맞춘다. "내 일정"으로
 * 바꿔도 로그인 사용자로 덮어쓸 뿐 임의의 다른 사람으로는 절대 바뀌지 않는다.
 */
export async function updateTaskAction(
  taskId: string,
  input: TaskFormInput,
): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();

  const validationError = validate(input);
  if (validationError) return { error: validationError };

  const assigneeUserIds = resolveAssigneeUserIds(input, session.user.id);

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: buildBaseTaskData(input) });
    await tx.taskAssignee.deleteMany({ where: { taskId } });
    if (assigneeUserIds.length > 0) {
      await tx.taskAssignee.createMany({
        data: assigneeUserIds.map((userId) => ({ taskId, userId })),
      });
    }
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

  const isSingleDayOnly = task.categoryOptionId === TaskCategory.MEETING || task.categoryOptionId === TaskCategory.HALF_DAY;
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

    if (task.categoryOptionId === TaskCategory.MEETING && task.meetingDetail?.time) {
      const oldTime = task.meetingDetail.time;
      const newTime = new Date(newStart);
      newTime.setHours(oldTime.getHours(), oldTime.getMinutes(), 0, 0);
      // Step 5B-7 — endTime도 같은 날짜로 함께 옮긴다. 시:분은 그대로 두고
      // 날짜만 바뀌므로 시작~종료 길이는 항상 보존된다.
      const data: { time: Date; endTime?: Date } = { time: newTime };
      if (task.meetingDetail.endTime) {
        const oldEndTime = task.meetingDetail.endTime;
        const newEndTime = new Date(newStart);
        newEndTime.setHours(oldEndTime.getHours(), oldEndTime.getMinutes(), 0, 0);
        data.endTime = newEndTime;
      }
      await tx.taskMeetingDetail.update({ where: { taskId }, data });
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
      if (task.categoryOptionId === TaskCategory.MEETING || task.categoryOptionId === TaskCategory.HALF_DAY) {
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
 * Update Modal을 열 때만 호출하는 Lazy Load 전용 조회(성능 개선 요청사항 4) —
 * 최상위 Comment + 그 답변을 이 Task 1건 기준으로 가져온다. 초기 /schedule
 * 진입 시(page.tsx)에는 더 이상 Comment/Reply 본문을 eager load하지 않는다 —
 * "💬 업데이트 N" 배지는 page.tsx가 함께 내려준 가벼운 _count만 쓰다가, 이
 * Action이 처음 성공하면 그 이후로는 실제 목록 길이로 대체된다(TaskDetailPanel).
 */
export async function getTaskCommentsAction(taskId: string): Promise<{ comments?: TaskCommentInfo[]; error?: string }> {
  await requireUser();

  const comments = await prisma.taskComment.findMany({
    where: { taskId, parentId: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { name: true } },
      replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });

  return {
    comments: comments.map((c) => ({
      ...commentToInfo(c),
      replies: c.replies.map(commentToInfo),
    })),
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

/**
 * Task Modal을 열 때만 호출하는 Lazy Load 전용 조회(성능 개선 요청사항 3) —
 * page.tsx의 초기 목록 조회에서는 더 이상 담지 않는 "조건부 상세정보 전체 +
 * 일정 변경 이력"을 이 Task 1건 기준으로 가져온다. Comment/Reply는 여기 포함
 * 하지 않는다 — Update Modal을 열 때 getTaskCommentsAction으로 별도 조회한다.
 */
export async function getTaskDetailAction(taskId: string): Promise<{ detail?: TaskDetailInfo; error?: string }> {
  await requireUser();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      projectDetail: true,
      meetingDetail: { include: { attendees: true } },
      scheduleRevisions: { orderBy: { revisionNo: "asc" }, include: { creator: { select: { name: true } } } },
    },
  });
  if (!task) return { error: "업무를 찾을 수 없습니다." };

  return {
    detail: {
      originalStartDate: task.startDate.toISOString(),
      originalDueDate: task.dueDate.toISOString(),
      memo: task.memo,
      halfDayPeriod: task.halfDayPeriod,
      projectDetail: task.projectDetail
        ? { projectName: task.projectDetail.projectName, categoryId: task.projectDetail.categoryId }
        : null,
      meetingDetail: task.meetingDetail
        ? {
            department: task.meetingDetail.department,
            time: task.meetingDetail.time ? task.meetingDetail.time.toISOString() : null,
            endTime: task.meetingDetail.endTime ? task.meetingDetail.endTime.toISOString() : null,
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
    },
  };
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
// Step 5B-5(2단계 계층화)부터 "일정 설정 > 프로젝트 카테고리 관리"(ADMIN
// 전용)로 관리 창구가 옮겨갔다 — Task Form 안에 있던 인라인 "카테고리 관리"
// 빠른 추가/삭제 UI는 대분류를 고르지 않고는 의미가 없어 제거했다(요청사항:
// 대분류→중분류 2단계 선택 UX로 교체). 그래서 이 아래 create/remove/toggle도
// 이제부터는 ADMIN만 호출할 수 있게 막는다 — UI에서만 버튼을 숨기고 서버
// Action 자체는 열려 있으면 의미가 없기 때문이다.

export async function createProjectCategoryAction(
  name: string,
  groupId: string,
): Promise<{ category?: ProjectCategoryOption; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const trimmed = name.trim();
  if (!trimmed) return { error: "카테고리명을 입력해 주세요." };
  if (!groupId) return { error: "대분류를 선택해 주세요." };

  const existing = await prisma.projectCategory.findUnique({ where: { name: trimmed } });
  if (existing) {
    if (!existing.active) {
      const reactivated = await prisma.projectCategory.update({ where: { id: existing.id }, data: { active: true, groupId } });
      invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
      revalidatePath("/schedule");
      return { category: reactivated };
    }
    return { error: "이미 존재하는 카테고리명입니다." };
  }

  try {
    const category = await prisma.projectCategory.create({ data: { name: trimmed, groupId } });
    invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
    revalidatePath("/schedule");
    return { category };
  } catch {
    return { error: "카테고리를 추가하지 못했습니다. 대분류를 다시 확인해 주세요." };
  }
}

/** 사용 이력(TaskProjectDetail 참조)이 있으면 삭제 대신 비활성화한다. */
export async function removeProjectCategoryAction(
  id: string,
): Promise<{ ok?: true; deactivated?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const usageCount = await prisma.taskProjectDetail.count({ where: { categoryId: id } });
  if (usageCount > 0) {
    await prisma.projectCategory.update({ where: { id }, data: { active: false } });
    invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
    revalidatePath("/schedule");
    return { deactivated: true };
  }

  await prisma.projectCategory.delete({ where: { id } });
  invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

export async function toggleProjectCategoryActiveAction(
  id: string,
  active: boolean,
): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  await prisma.projectCategory.update({ where: { id }, data: { active } });
  invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

export async function updateProjectCategoryAction(
  id: string,
  patch: { name?: string; color?: string },
): Promise<{ category?: ProjectCategoryOption; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const data: { name?: string; color?: string } = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return { error: "카테고리명을 입력해 주세요." };
    data.name = trimmed;
  }
  if (patch.color !== undefined) data.color = patch.color;

  try {
    const updated = await prisma.projectCategory.update({ where: { id }, data });
    invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
    revalidatePath("/schedule");
    return { category: updated };
  } catch {
    return { error: "카테고리를 수정하지 못했습니다. 같은 이름이 이미 있는지 확인해 주세요." };
  }
}

/** Step 5B-5(2단계 계층화) — "다른 대분류로 이동"(요청사항). 이름/색상과
 * 독립된 별도 Action으로 둔 이유는 설정 화면에서 "이 중분류를 다른 그룹
 * 아래로 Drag" 같은 동작과 rename/색상 변경 흐름을 섞지 않기 위함이다. */
export async function moveProjectCategoryToGroupAction(id: string, groupId: string): Promise<{ category?: ProjectCategoryOption; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };
  if (!groupId) return { error: "대분류를 선택해 주세요." };

  try {
    const updated = await prisma.projectCategory.update({ where: { id }, data: { groupId } });
    invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
    revalidatePath("/schedule");
    return { category: updated };
  } catch {
    return { error: "대분류를 변경하지 못했습니다." };
  }
}

/** orderedIds 배열의 순서를 그대로 order(0부터)에 반영한다 — Drag & Drop
 * 결과를 한 번에 저장하는 용도라 항목별 순서를 계산할 필요가 없다. 같은
 * 대분류 안의 중분류끼리만 순서를 바꾸므로 orderedIds는 항상 그 그룹의
 * 중분류 id 목록이다. */
export async function reorderProjectCategoriesAction(orderedIds: string[]): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  await prisma.$transaction(orderedIds.map((id, order) => prisma.projectCategory.update({ where: { id }, data: { order } })));
  invalidateCache(PROJECT_CATEGORIES_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

// ---------------- 프로젝트 카테고리 대분류(ProjectCategoryGroup) 관리 ----------------
// Step 5B-6(대분류 삭제 기능 보완) — 5B-5에서는 삭제를 지원하지 않았지만,
// 테스트용/불필요한 대분류를 정리할 수 있어야 한다는 요청으로 "하위 중분류가
// 0개인 대분류만" 삭제를 허용한다. 하위 중분류가 있으면 삭제 자체를 거부하고
// (FK 제약상 실패하기도 하지만, Client가 상황을 정확히 안내할 수 있도록 서버가
// 먼저 개수를 세어 명시적으로 막는다) 시스템 기본 대분류 "미분류"는 삭제뿐
// 아니라 비활성화도 금지한다 — 그룹 없는 카테고리가 생기지 않을 안전한
// 임시 소속지가 항상 하나는 남아 있어야 하기 때문이다.

function toProjectCategoryGroupInfo(row: { id: string; name: string; order: number; active: boolean }): ProjectCategoryGroupOption {
  return { id: row.id, name: row.name, order: row.order, active: row.active };
}

export async function createProjectCategoryGroupAction(name: string): Promise<{ group?: ProjectCategoryGroupOption; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const trimmed = name.trim();
  if (!trimmed) return { error: "대분류 이름을 입력해 주세요." };

  try {
    const maxOrder = await prisma.projectCategoryGroup.aggregate({ _max: { order: true } });
    const created = await prisma.projectCategoryGroup.create({ data: { name: trimmed, order: (maxOrder._max.order ?? -1) + 1 } });
    invalidateCache(PROJECT_CATEGORY_GROUPS_CACHE_KEY);
    revalidatePath("/schedule");
    return { group: toProjectCategoryGroupInfo(created) };
  } catch {
    return { error: "대분류를 추가하지 못했습니다. 같은 이름이 이미 있는지 확인해 주세요." };
  }
}

export async function updateProjectCategoryGroupAction(id: string, name: string): Promise<{ group?: ProjectCategoryGroupOption; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const trimmed = name.trim();
  if (!trimmed) return { error: "대분류 이름을 입력해 주세요." };

  try {
    const updated = await prisma.projectCategoryGroup.update({ where: { id }, data: { name: trimmed } });
    invalidateCache(PROJECT_CATEGORY_GROUPS_CACHE_KEY);
    revalidatePath("/schedule");
    return { group: toProjectCategoryGroupInfo(updated) };
  } catch {
    return { error: "대분류 이름을 수정하지 못했습니다. 같은 이름이 이미 있는지 확인해 주세요." };
  }
}

export async function reorderProjectCategoryGroupsAction(orderedIds: string[]): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  await prisma.$transaction(orderedIds.map((id, order) => prisma.projectCategoryGroup.update({ where: { id }, data: { order } })));
  invalidateCache(PROJECT_CATEGORY_GROUPS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

export async function setProjectCategoryGroupActiveAction(id: string, active: boolean): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  if (id === DEFAULT_PROJECT_CATEGORY_GROUP_ID) return { error: "미분류는 비활성화할 수 없습니다." };

  await prisma.projectCategoryGroup.update({ where: { id }, data: { active } });
  invalidateCache(PROJECT_CATEGORY_GROUPS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

export async function deleteProjectCategoryGroupAction(id: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  if (id === DEFAULT_PROJECT_CATEGORY_GROUP_ID) return { error: "미분류는 삭제할 수 없습니다." };

  // Client의 "하위 중분류 0개" 판단만 믿지 않는다 — 서버에서 다시 실제 개수를
  // 센다(그 사이 다른 관리자가 중분류를 추가했을 수도 있다).
  const group = await prisma.projectCategoryGroup.findUnique({ where: { id }, select: { id: true } });
  if (!group) return { error: "이미 삭제된 대분류입니다." };

  const childCount = await prisma.projectCategory.count({ where: { groupId: id } });
  if (childCount > 0) {
    return { error: "하위 카테고리를 다른 대분류로 이동하거나 삭제한 후 다시 시도해 주세요." };
  }

  try {
    await prisma.projectCategoryGroup.delete({ where: { id } });
  } catch {
    // 두 요청이 동시에 들어와 방금 막 하위 카테고리가 추가된 경우 등 —
    // count 확인 이후에도 FK 제약이 최후의 안전망 역할을 한다.
    return { error: "하위 카테고리를 다른 대분류로 이동하거나 삭제한 후 다시 시도해 주세요." };
  }

  invalidateCache(PROJECT_CATEGORY_GROUPS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

// ---------------- 업무 구분(TaskCategoryOption) 설정 ----------------
// Step 5B-4 — "일정 설정" 화면(ADMIN 전용)에서 관리한다. 시스템 예약 7종
// (PROJECT 등)은 id가 고정 문자열이라 삭제하면 그 id를 참조하는 입력폼/
// 자동화가 전부 깨진다 — 그래서 시스템 예약 항목은 비활성화만 지원한다
// (요청사항: "시스템 핵심 유형을 완전히 삭제해서 기존 기능이 깨지는 구조는
// 금지"). 사용자가 새로 추가하는 업무구분은 cuid id를 받아 어떤 코드도 특별
// 취급하지 않으므로 자동으로 "일반(GENERIC)" 동작이 된다 — Step 5B-8부터는
// 이런 사용자 정의(CUSTOM) 항목에 한해 "참조 중인 Task가 0개면 실제 삭제"를
// 지원한다(TASK_CATEGORY_RESERVED_IDS 참고).

/** 시스템이 semantic key로 의존하는 예약 7종 — TASK_CATEGORY_KEY 객체의 값을
 * 그대로 가져와 하드코딩 목록을 따로 만들지 않는다(요청사항: "임의로 새 key를
 * 만들지 말 것" — 실제 코드가 의존하는 값과 항상 정확히 같은 목록이어야 한다). */
const TASK_CATEGORY_RESERVED_IDS: readonly string[] = Object.values(TaskCategory);
/** TASK_STATUS_KEY 4종 — isTaskOverdue 등이 의존한다. */
const TASK_STATUS_RESERVED_IDS: readonly string[] = Object.values(TaskStatus);

function toScheduleOptionInfo(row: { id: string; label: string; color: string; order: number; active: boolean }): ScheduleOptionInfo {
  return { id: row.id, label: row.label, color: row.color, order: row.order, active: row.active };
}

export async function createTaskCategoryOptionAction(
  label: string,
  color: string,
): Promise<{ option?: ScheduleOptionInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const trimmed = label.trim();
  if (!trimmed) return { error: "업무 구분 이름을 입력해 주세요." };

  const maxOrder = await prisma.taskCategoryOption.aggregate({ _max: { order: true } });
  const created = await prisma.taskCategoryOption.create({
    data: { label: trimmed, color, order: (maxOrder._max.order ?? -1) + 1 },
  });
  invalidateCache(TASK_CATEGORY_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { option: toScheduleOptionInfo(created) };
}

/** label/color만 바꿀 수 있다 — id(시스템 예약 key 포함)는 절대 바뀌지 않는다
 * (요청사항: 표시 이름을 바꿔도 기존 일정 연결이 깨지지 않아야 한다). */
export async function updateTaskCategoryOptionAction(
  id: string,
  patch: { label?: string; color?: string },
): Promise<{ option?: ScheduleOptionInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const data: { label?: string; color?: string } = {};
  if (patch.label !== undefined) {
    const trimmed = patch.label.trim();
    if (!trimmed) return { error: "업무 구분 이름을 입력해 주세요." };
    data.label = trimmed;
  }
  if (patch.color !== undefined) data.color = patch.color;

  const updated = await prisma.taskCategoryOption.update({ where: { id }, data });
  invalidateCache(TASK_CATEGORY_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { option: toScheduleOptionInfo(updated) };
}

export async function reorderTaskCategoryOptionsAction(orderedIds: string[]): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  await prisma.$transaction(orderedIds.map((id, order) => prisma.taskCategoryOption.update({ where: { id }, data: { order } })));
  invalidateCache(TASK_CATEGORY_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

/** 비활성화만 지원한다(삭제 없음) — 사용 중이든 아니든 항상 안전하다. 비활성
 * 옵션은 새 일정 등록 dropdown에서만 숨겨지고, 이미 그 업무구분으로 저장된
 * Task는 계속 정상 표시/편집된다(Client가 "현재 선택된 값은 항상 목록에
 * 포함" 규칙으로 처리 — TaskDetailPanel.tsx CategorySelect 참고). */
export async function setTaskCategoryOptionActiveAction(id: string, active: boolean): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  await prisma.taskCategoryOption.update({ where: { id }, data: { active } });
  invalidateCache(TASK_CATEGORY_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

/**
 * Step 5B-8 — 사용자 정의(CUSTOM) 업무구분만 실제 삭제를 지원한다. Client가
 * "사용 중이 아니다"라고 판단해 이 Action을 불러도, 그 사이 다른 사용자가
 * 그 업무구분으로 Task를 새로 만들었을 수 있으므로 여기서 Task 참조 개수를
 * 다시 센다(Client 조건만 믿지 않음).
 */
export async function deleteTaskCategoryOptionAction(id: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  if (TASK_CATEGORY_RESERVED_IDS.includes(id)) {
    return { error: "시스템 업무구분은 삭제할 수 없습니다." };
  }

  const option = await prisma.taskCategoryOption.findUnique({ where: { id }, select: { id: true } });
  if (!option) return { error: "이미 삭제된 업무구분입니다." };

  const usedCount = await prisma.task.count({ where: { categoryOptionId: id } });
  if (usedCount > 0) {
    return { error: "이 항목을 사용 중인 일정이 있어 삭제할 수 없습니다. 기존 일정을 다른 항목으로 변경한 후 다시 시도해 주세요." };
  }

  try {
    await prisma.taskCategoryOption.delete({ where: { id } });
  } catch {
    return { error: "이 항목을 사용 중인 일정이 있어 삭제할 수 없습니다. 기존 일정을 다른 항목으로 변경한 후 다시 시도해 주세요." };
  }

  invalidateCache(TASK_CATEGORY_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

// ---------------- 상태(TaskStatusOption) 설정 ----------------
// TaskCategoryOption과 완전히 동일한 정책 — 시스템 예약 4종("DONE"은 특히
// isTaskOverdue/getEffectiveTaskStatus가 신뢰하는 key)은 비활성화만, 사용자가
// 추가한 CUSTOM 상태는 미사용 시 실제 삭제를 지원한다(Step 5B-8).

export async function createTaskStatusOptionAction(
  label: string,
  color: string,
): Promise<{ option?: ScheduleOptionInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const trimmed = label.trim();
  if (!trimmed) return { error: "상태 이름을 입력해 주세요." };

  const maxOrder = await prisma.taskStatusOption.aggregate({ _max: { order: true } });
  const created = await prisma.taskStatusOption.create({
    data: { label: trimmed, color, order: (maxOrder._max.order ?? -1) + 1 },
  });
  invalidateCache(TASK_STATUS_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { option: toScheduleOptionInfo(created) };
}

export async function updateTaskStatusOptionAction(
  id: string,
  patch: { label?: string; color?: string },
): Promise<{ option?: ScheduleOptionInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  const data: { label?: string; color?: string } = {};
  if (patch.label !== undefined) {
    const trimmed = patch.label.trim();
    if (!trimmed) return { error: "상태 이름을 입력해 주세요." };
    data.label = trimmed;
  }
  if (patch.color !== undefined) data.color = patch.color;

  const updated = await prisma.taskStatusOption.update({ where: { id }, data });
  invalidateCache(TASK_STATUS_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { option: toScheduleOptionInfo(updated) };
}

export async function reorderTaskStatusOptionsAction(orderedIds: string[]): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  await prisma.$transaction(orderedIds.map((id, order) => prisma.taskStatusOption.update({ where: { id }, data: { order } })));
  invalidateCache(TASK_STATUS_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

export async function setTaskStatusOptionActiveAction(id: string, active: boolean): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  await prisma.taskStatusOption.update({ where: { id }, data: { active } });
  invalidateCache(TASK_STATUS_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}

/** Step 5B-8 — deleteTaskCategoryOptionAction과 동일한 정책/순서
 * (존재 확인 → 시스템 예약 여부 → 참조 개수 재확인 → 삭제). */
export async function deleteTaskStatusOptionAction(id: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdminRole(session);
  if (permissionError) return { error: permissionError };

  if (TASK_STATUS_RESERVED_IDS.includes(id)) {
    return { error: "시스템 상태는 삭제할 수 없습니다." };
  }

  const option = await prisma.taskStatusOption.findUnique({ where: { id }, select: { id: true } });
  if (!option) return { error: "이미 삭제된 상태입니다." };

  const usedCount = await prisma.task.count({ where: { statusOptionId: id } });
  if (usedCount > 0) {
    return { error: "이 항목을 사용 중인 일정이 있어 삭제할 수 없습니다. 기존 일정을 다른 항목으로 변경한 후 다시 시도해 주세요." };
  }

  try {
    await prisma.taskStatusOption.delete({ where: { id } });
  } catch {
    return { error: "이 항목을 사용 중인 일정이 있어 삭제할 수 없습니다. 기존 일정을 다른 항목으로 변경한 후 다시 시도해 주세요." };
  }

  invalidateCache(TASK_STATUS_OPTIONS_CACHE_KEY);
  revalidatePath("/schedule");
  return { ok: true };
}
