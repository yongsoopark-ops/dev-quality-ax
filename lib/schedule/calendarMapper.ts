import { differenceInCalendarDays } from "date-fns";
import { formatKstTime } from "@/lib/kst";
import { TASK_CATEGORY_KEY as TaskCategory } from "@/lib/schedule/constants";
import { computeRecurringOccurrenceDates } from "@/lib/schedule/recurrence";
import type { ScheduleOptionInfo, TaskWithRelations } from "@/lib/schedule/types";

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
  /** Step(Month Calendar 실제 표시 순서 보장) — sortEventsForMonthCalendar가
   * 계산해 찍어두는 tier 값(getMonthCalendarSortTier 참고). react-big-calendar
   * Month view가 주(week) 단위로 이벤트 순서를 자체 재계산(sortWeekEvents →
   * localizer.sortEvents, start/end/allDay만 참조)해 애플리케이션 레벨 정렬
   * 순서를 되돌리기 때문에, TierAwareMonthView가 이 값을 이벤트 객체에서 직접
   * 읽어 react-big-calendar의 재정렬 결과 위에 안정 정렬 한 번을 더 적용한다. */
  monthCalendarTier?: number;
}

/**
 * Step(Final V1.1 Fix — 누락된 미팅 Calendar Label) — MEETING도 PROJECT/
 * PERSONAL_GOAL과 같은 "핵심 정보 | 부가 정보" 구조로 통일한다: "미팅명 |
 * HH:mm-HH:mm 미팅"(요청사항 예시: "선제적 품질 강화 | 10:00-11:20 미팅").
 * 시:분은 항상 Asia/Seoul 기준으로 뽑는다(lib/kst.ts formatKstTime — 서버
 * 런타임 timezone과 무관, Hotfix Step에서 이미 검증된 helper를 그대로
 * 재사용) — Calendar는 클라이언트에서만 렌더링돼 브라우저 local timezone이
 * 곧 KST이므로 원래도 안전하지만, "시간대: Asia/Seoul"을 명시적으로
 * 보장하기 위해 로컬 접근자(getHours 등) 대신 이 helper를 쓴다.
 *
 * 반복 미팅도 이 함수 하나만 쓴다(anchor/계산된 회차 둘 다 mapTaskToEvent/
 * mapTasksToEventsWithRecurrence가 항상 원본 task를 그대로 넘기므로) —
 * meetingDetail.time/endTime은 반복 규칙 전체에서 시:분이 고정이라 회차
 * 날짜와 무관하게 항상 같은 값이다. endTime이 없는 legacy 미팅은 "HH:mm
 * 미팅"으로, time 자체가 없거나 파싱 실패하면 시간 표시 없이 제목만
 * 보여준다(요청사항: "파싱 실패 시 기존 title만 표시하는 graceful
 * fallback"). DB의 Task.title/meetingDetail은 전혀 수정하지 않는다 —
 * Calendar에 보여줄 문자열만 조합한다.
 */
export function formatMeetingTimeLabel(timeIso: string | null, endTimeIso: string | null): string | null {
  if (!timeIso) return null;
  const start = new Date(timeIso);
  if (Number.isNaN(start.getTime())) return null;
  const startLabel = formatKstTime(start);

  if (endTimeIso) {
    const end = new Date(endTimeIso);
    if (!Number.isNaN(end.getTime())) {
      return `${startLabel}-${formatKstTime(end)} 미팅`;
    }
  }
  return `${startLabel} 미팅`;
}

/**
 * Calendar에 보여줄 제목 — PROJECT는 "프로젝트명 | 업무명", PERSONAL_GOAL은
 * "목표명 | 업무명", MEETING은 "미팅명 | HH:mm-HH:mm 미팅", 나머지는 업무명
 * 그대로. 조건에 필요한 값이 비어 있으면(아직 Detail이 없는 등) 제목만
 * 보여준다.
 */
export function buildEventTitle(task: TaskWithRelations): string {
  if (task.category === TaskCategory.PROJECT && task.projectDetail?.projectName) {
    return `${task.projectDetail.projectName} | ${task.title}`;
  }
  if (task.category === TaskCategory.PERSONAL_GOAL && task.goalName) {
    return `${task.goalName} | ${task.title}`;
  }
  if (task.category === TaskCategory.MEETING) {
    const timeLabel = formatMeetingTimeLabel(task.meetingDetail?.time ?? null, task.meetingDetail?.endTime ?? null);
    if (timeLabel) return `${task.title} | ${timeLabel}`;
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

/** Step(월 캘린더 정렬 우선순위) — meetingReportSection 값 → 정렬 순번.
 * 요청사항 순서(정규 프로젝트 > 서브 > 공통 > 예외 > 출장) 그대로다. */
const MONTH_CALENDAR_SECTION_PRIORITY: Record<string, number> = {
  REGULAR_PROJECT: 1,
  SUB_PROJECT: 2,
  COMMON: 3,
  EXCEPTION: 4,
  BUSINESS_TRIP: 5,
};

/**
 * "파트 공통 일정"(task.isCommonAssignee — 담당자를 지정하지 않고 의도적으로
 * 팀 전체 업무로 등록한 일정)이 항상 최우선(0)이다. 이는 업무구분의 "공통"
 * (TaskCategoryOption.meetingReportSection === "COMMON")과 서로 다른 개념이라
 * 혼동하지 않는다 — 파트 공통 일정이 아니면 categoryOptionId로 조회한
 * meetingReportSection 순서를 따른다. meetingReportSection이 없는 업무구분
 * (MEETING/VACATION/HALF_DAY 등)은 요청사항에 우선순위가 명시돼 있지 않아
 * 안전하게 맨 뒤(6)로 둔다.
 */
export function getMonthCalendarSortTier(event: CalendarTaskEvent, options: ScheduleOptionInfo[]): number {
  if (event.task.isCommonAssignee) return 0;
  const section = options.find((o) => o.id === event.task.category)?.meetingReportSection;
  return section ? (MONTH_CALENDAR_SECTION_PRIORITY[section] ?? 6) : 6;
}

/**
 * Step(월 캘린더 일정 정렬 우선순위 변경) — 같은 날짜에 여러 일정이 있을 때
 * Month View 표시 순서: 파트 공통 일정 > 정규 프로젝트 > 서브 > 공통 > 예외 >
 * 출장(getMonthCalendarSortTier 참고). Array.prototype.sort는 안정 정렬이라
 * 같은 tier 안의 상대 순서는 건드리지 않는다 — 그래서 기존 2차 정렬(page.tsx의
 * startDate asc 조회 + 반복 회차 계산 순서)이 tier가 같은 일정끼리는 그대로
 * 보존된다(요청사항 4-1). 입력 배열을 그 자리에서 정렬(in-place)하고 그대로
 * 반환한다 — mapTasksToEventsWithRecurrence가 매번 새 배열을 만들어 주므로
 * 호출부에서 별도 복제가 필요 없다.
 *
 * Step(Month Calendar 실제 표시 순서 보장) — 이 함수의 정렬 결과는
 * react-big-calendar Month view 내부에서 그대로 유지되지 않는다(감사 결과:
 * Month.js가 주 단위로 자체 sortWeekEvents를 다시 실행해 덮어씀). 그래서 각
 * 이벤트에 계산된 tier 값을 `monthCalendarTier`로 함께 찍어둔다 —
 * TierAwareMonthView(app/(shell)/schedule/TierAwareMonthView.tsx)가
 * react-big-calendar 자체 정렬 결과 위에 이 값 기준 안정 정렬을 한 번 더
 * 적용할 때 재사용한다(같은 tier 우선순위 map을 중복 정의하지 않기 위함).
 */
export function sortEventsForMonthCalendar(events: CalendarTaskEvent[], options: ScheduleOptionInfo[]): CalendarTaskEvent[] {
  for (const event of events) {
    event.monthCalendarTier = getMonthCalendarSortTier(event, options);
  }
  return events.sort((a, b) => getMonthCalendarSortTier(a, options) - getMonthCalendarSortTier(b, options));
}

/**
 * Step(Month Calendar 실제 표시 순서 보장) — react-big-calendar Month view가
 * 주(week) 단위로 자체 정렬(sortWeekEvents, "기존 second-order")을 다시 계산한
 * 결과 위에, tier 기준 안정 정렬을 한 번 더 적용해 실제 화면 순서를 확정한다.
 * TierAwareMonthView.tsx(react-big-calendar Month 클래스를 상속한 커스텀 View,
 * renderWeek 재정의)에서 호출하는 것과 정확히 같은 함수를 여기 두어, DOM 없이
 * (react-big-calendar의 순수 유틸 sortWeekEvents/inRange만으로) 실제 library
 * ordering 경로 수준에서 단위 테스트할 수 있게 한다. tier가 없는(계산 안 된)
 * 이벤트는 가장 낮은 우선순위(6, 기타)로 취급한다.
 */
export function applyMonthCalendarTierOrder(librarySorted: CalendarTaskEvent[]): CalendarTaskEvent[] {
  return [...librarySorted].sort((a, b) => (a.monthCalendarTier ?? 6) - (b.monthCalendarTier ?? 6));
}
