import { differenceInCalendarDays } from "date-fns";
import { TaskCategory } from "@/app/generated/prisma/enums";
import { computeRecurringOccurrenceDates } from "@/lib/schedule/recurrence";
import type { TaskWithRelations } from "@/lib/schedule/types";

export interface CalendarTaskEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: true;
  task: TaskWithRelations;
  /** Step 5B-1(반복 일정) — true면 반복 규칙으로 "계산된" 회차(실제 Task Row가
   * 아님)다. task는 항상 그 반복의 원본(첫 회차) Task를 그대로 가리킨다 —
   * 그래서 이 이벤트를 클릭하면 원본 Task 수정 화면이 열린다(V1: 반복 일정
   * 전체만 수정 가능). Drag/Resize는 이 값이 true면 항상 막는다(호출부:
   * CalendarView.tsx의 draggableAccessor/resizableAccessor, CustomWeekView.tsx의
   * EventBar) — 실제 Task Row가 없어 updateTaskDatesAction으로 저장할 대상
   * 자체가 없기 때문이다. */
  isRecurringOccurrence?: boolean;
}

/**
 * Calendar에 보여줄 제목 — PROJECT는 "프로젝트명 | 업무명", PERSONAL_GOAL은
 * "목표명 | 업무명", 나머지는 업무명 그대로. 조건에 필요한 값이 비어 있으면
 * (아직 Detail이 없는 등) 업무명만 보여준다.
 */
export function buildEventTitle(task: TaskWithRelations): string {
  if (task.category === TaskCategory.PROJECT && task.projectDetail?.projectName) {
    return `${task.projectDetail.projectName} | ${task.title}`;
  }
  if (task.category === TaskCategory.PERSONAL_GOAL && task.goalName) {
    return `${task.goalName} | ${task.title}`;
  }
  return task.title;
}

/**
 * Task(시작일~마감일, 둘 다 포함하는 날짜)를 react-big-calendar의 all-day 이벤트로
 * 바꾼다. end를 "마감일 다음날 00:00"(배타적 경계)으로 두면, 마감일이 마침 그 주의
 * 마지막 날(토요일)일 때 react-big-calendar Month View가 그 경계를 다음 주 첫째 날
 * (일요일)까지 걸치는 것으로 오인해 다음 줄에 중복 막대를 그리는 버그가 실제로
 * 있었다(실사용 검증에서 발견). end를 "마감일 당일의 마지막 순간"으로 두면 같은
 * 날짜 범위를 동일하게 표현하면서 이 경계 겹침이 생기지 않는다.
 */
export function mapTaskToEvent(task: TaskWithRelations): CalendarTaskEvent {
  const start = new Date(task.startDate);
  const end = new Date(task.dueDate);
  end.setHours(23, 59, 59, 999);
  return { id: task.id, title: buildEventTitle(task), start, end, allDay: true, task };
}

export function mapTasksToEvents(tasks: TaskWithRelations[]): CalendarTaskEvent[] {
  return tasks.map(mapTaskToEvent);
}

/**
 * Step 5B-1(반복 일정) — 원본(첫 회차) Task는 항상 mapTaskToEvent와 동일하게
 * 그린다(기존 동작 그대로, 회귀 없음). recurrence.type이 "NONE"이 아니면
 * [rangeStart, rangeEnd] 구간 안에서 "계산된" 추가 회차를 함께 만든다 — 미리
 * DB에 Row를 만들지 않고 순수 함수로 그때그때 계산한다(lib/schedule/recurrence.ts).
 * 계산된 회차의 id는 `${task.id}::${occurrence 날짜}`로 원본과 절대 겹치지
 * 않게 하고, task는 항상 원본 그대로 참조한다(클릭 시 원본 수정 화면이 열림).
 */
export function mapTasksToEventsWithRecurrence(tasks: TaskWithRelations[], rangeStart: Date, rangeEnd: Date): CalendarTaskEvent[] {
  const events: CalendarTaskEvent[] = [];

  for (const task of tasks) {
    const anchorEvent = mapTaskToEvent(task);
    events.push(anchorEvent);

    if (task.recurrence.type === "NONE") continue;

    const anchorStart = new Date(task.startDate);
    // 원본 Task의 시작~마감 날짜 간격(대부분 0, 즉 하루짜리)을 그대로 모든
    // 계산된 회차에 적용한다 — 회의 하나가 여러 날에 걸치는 경우도 동일한
    // 길이로 반복된다.
    const daySpan = differenceInCalendarDays(new Date(task.dueDate), anchorStart);

    const occurrenceDates = computeRecurringOccurrenceDates(task.recurrence, anchorStart, rangeStart, rangeEnd);
    for (const occStart of occurrenceDates) {
      const occEnd = new Date(occStart);
      occEnd.setDate(occEnd.getDate() + daySpan);
      occEnd.setHours(23, 59, 59, 999);
      events.push({
        id: `${task.id}::${occStart.toISOString().slice(0, 10)}`,
        title: buildEventTitle(task),
        start: occStart,
        end: occEnd,
        allDay: true,
        task,
        isRecurringOccurrence: true,
      });
    }
  }

  return events;
}
