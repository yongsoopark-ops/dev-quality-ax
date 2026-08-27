import { TaskCategory } from "@/app/generated/prisma/enums";
import type { TaskWithRelations } from "@/lib/schedule/types";

export interface CalendarTaskEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: true;
  task: TaskWithRelations;
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
