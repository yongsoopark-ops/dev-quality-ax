"use client";

import { useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer, type DateHeaderProps, type SlotInfo, type View } from "react-big-calendar";
import withDragAndDrop, { type EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";
import { addDays, format, getDay, isSameDay, parse, startOfWeek } from "date-fns";
import { ko } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import { TaskCategory, TaskStatus } from "@/app/generated/prisma/enums";
import { mapTasksToEventsWithRecurrence, type CalendarTaskEvent } from "@/lib/schedule/calendarMapper";
import { TASK_CATEGORY_TINTS, isTaskOverdue } from "@/lib/schedule/constants";
import { EMPTY_SCHEDULE_FILTERS, filterTasks, type ScheduleFilters } from "@/lib/schedule/filters";
import type { ScheduleUser, TaskWithRelations } from "@/lib/schedule/types";
import { updateTaskDatesAction } from "./actions";
import { CalendarToolbar } from "./CalendarToolbar";
import { CustomWeekView, WeekViewUsersContext } from "./CustomWeekView";
import { ScheduleFilterBar } from "./ScheduleFilterBar";

/**
 * Month 날짜 숫자 표시(요청사항 8) — 일요일은 약한 Red, 토요일은 약한 Blue,
 * 평일은 Navy/Gray, 오늘은 숫자에 작은 Navy Circle을 준다. isOffRange(다른 달
 * 날짜)/rbc-current 클래스 등 기존 처리는 RBC가 Wrapper에서 그대로 계속
 * 담당하므로 여기서는 label 자체의 색/오늘 표시만 신경 쓴다. drilldownView가
 * 없으면(현재 Day View 미등록) 기존 기본 DateHeader와 동일하게 클릭 불가능한
 * 순수 텍스트로 남긴다 — 동작 자체는 바꾸지 않는다.
 */
function MonthDateHeader({ date, label, drilldownView, onDrillDown }: DateHeaderProps) {
  const day = date.getDay();
  const today = isSameDay(date, new Date());
  const weekdayColor = day === 0 ? "text-red-400" : day === 6 ? "text-blue-400" : "text-navy-950/60";

  const content = today ? (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
      {label}
    </span>
  ) : (
    <span className={`text-xs font-medium ${weekdayColor}`}>{label}</span>
  );

  return (
    <div className="flex justify-end px-1 pt-1">
      {drilldownView ? (
        <button type="button" className="rbc-button-link" onClick={onDrillDown}>
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ko }),
  getDay,
  locales: { ko },
});

const messages = {
  today: "오늘",
  previous: "이전",
  next: "다음",
  month: "월",
  week: "주",
  day: "일",
  agenda: "일정",
  date: "날짜",
  time: "시간",
  event: "업무",
  noEventsInRange: "표시할 업무가 없습니다.",
  showMore: (total: number) => `+${total} 더보기`,
};

const DnDCalendar = withDragAndDrop<CalendarTaskEvent>(Calendar);

/** MEETING/HALF_DAY는 하루짜리 일정이라 Resize를 금지한다(요청사항). */
const NON_RESIZABLE_CATEGORIES = new Set<TaskCategory>([TaskCategory.MEETING, TaskCategory.HALF_DAY]);

function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * react-big-calendar는 React 19에서 uncontrolled 내부 view/date state가 정상
 * 동작하지 않는 것을 이전 Step 스모크 테스트에서 확인했다 — 그래서 view/date를
 * 항상 이 Component가 직접 소유하고(controlled) view/onView, date/onNavigate를
 * 반드시 함께 넘긴다. uncontrolled로 되돌리지 않는다.
 *
 * Week는 react-big-calendar 기본 시간 Grid 대신 CustomWeekView(날짜 단위 Task
 * Bar만 있는 View)를 쓴다 — Month는 기본 View를 그대로 쓴다.
 *
 * Drag/Resize는 Month(withDragAndDrop addon)와 Week(CustomWeekView 자체 구현)가
 * 서로 다른 메커니즘을 쓰지만, 최종적으로는 이 컴포넌트의 commitDateChange 하나로
 * 합쳐진다 — 낙관적 업데이트 → updateTaskDatesAction 저장 → 실패 시 롤백 로직을
 * View별로 중복시키지 않기 위함이다.
 */
export function CalendarView({
  tasks,
  users,
  onSelectTask,
  onSelectSlot,
}: {
  tasks: TaskWithRelations[];
  users: ScheduleUser[];
  onSelectTask: (task: TaskWithRelations) => void;
  onSelectSlot: (range: { start: Date; end: Date }) => void;
}) {
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState<Date>(new Date());
  const [filters, setFilters] = useState<ScheduleFilters>(EMPTY_SCHEDULE_FILTERS);
  const [dragError, setDragError] = useState<string | null>(null);

  // Drag/Resize 낙관적 표시를 위한 override만 별도로 들고, tasks 자체는 복제하지
  // 않는다. Server Action의 revalidatePath로 새 tasks prop이 도착하면(결국 서버가
  // 진실이므로) override를 전부 비운다 — Effect+setState 대신 렌더 중 비교로
  // 처리해 불필요한 추가 커밋 사이클을 만들지 않는다(React가 권장하는 "props가
  // 바뀌면 파생 state를 리셋" 패턴).
  const [prevTasks, setPrevTasks] = useState(tasks);
  const [overrides, setOverrides] = useState<Record<string, { startDate: string; dueDate: string }>>({});
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setOverrides({});
  }

  const localTasks = useMemo(
    () => tasks.map((t) => (overrides[t.id] ? { ...t, ...overrides[t.id] } : t)),
    [tasks, overrides],
  );
  const visibleTasks = useMemo(() => filterTasks(localTasks, filters), [localTasks, filters]);
  // Step 5B-1(반복 일정) — Month/Week 어느 View든 넉넉히 덮도록 현재 date 기준
  // 앞뒤 45일을 계산 구간으로 쓴다. 이 프로젝트는 Month/Week 이동이 서버
  // 재조회 없이 client 상태(date)만 바뀌는 구조라(page.tsx가 항상 전체 Task를
  // 한 번에 내려줌), 이 구간 밖으로 이동하면 date가 바뀌며 구간 자체가 함께
  // 다시 계산된다 — 반복 회차가 "그 시점엔 안 보이다가" 갑자기 사라지는 경계는
  // 사실상 발생하지 않는다(한 화면에 필요한 범위보다 훨씬 넓다).
  const recurrenceRange = useMemo(() => ({ start: addDays(date, -45), end: addDays(date, 45) }), [date]);
  const events = useMemo(
    () => mapTasksToEventsWithRecurrence(visibleTasks, recurrenceRange.start, recurrenceRange.end),
    [visibleTasks, recurrenceRange],
  );

  /**
   * Drag/Resize 공통 저장 경로. 화면은 즉시 이동된 것처럼 낙관적으로 갱신하고,
   * Server Action(updateTaskDatesAction — Task 날짜만 바꾸고 담당자/참석자/
   * 업무구분별 상세는 절대 건드리지 않는다)이 실패하면 override를 지워 원래
   * 날짜로 되돌리고 오류를 배너로 보여준다. 사유 입력 등은 이번 Step 범위가 아니다.
   */
  async function commitDateChange(task: TaskWithRelations, newStart: Date, newEnd: Date) {
    const newStartDate = toDateOnly(newStart);
    const newDueDate = toDateOnly(newEnd);
    if (newStartDate === task.startDate.slice(0, 10) && newDueDate === task.dueDate.slice(0, 10)) return;

    setDragError(null);
    setOverrides((prev) => ({
      ...prev,
      [task.id]: { startDate: `${newStartDate}T00:00:00.000Z`, dueDate: `${newDueDate}T00:00:00.000Z` },
    }));

    function rollback(message: string) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
      setDragError(message);
    }

    // Server Action이 결과값 대신 예외로 실패하는 경우(예: 세션 만료로 auth()가
    // 던지는 경우)도 반드시 롤백해야 한다 — try/catch 없이 await만 하면 이 경로는
    // 롤백 없이 낙관적 상태가 그대로 남는 실제 버그가 된다.
    try {
      const res = await updateTaskDatesAction(task.id, newStartDate, newDueDate);
      if (res.error) rollback(res.error);
    } catch {
      rollback("날짜 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  function handleEventDrop({ event, start, end }: EventInteractionArgs<CalendarTaskEvent>) {
    // Step 5B-1 — 반복 일정의 "계산된" 회차는 실제 Task Row가 없어 여기로 오면
    // 안 된다. draggableAccessor가 이미 막지만, 방어적으로 한 번 더 확인한다.
    if (event.isRecurringOccurrence) return;
    void commitDateChange(event.task, new Date(start), new Date(end));
  }

  function handleEventResize({ event, start, end }: EventInteractionArgs<CalendarTaskEvent>) {
    if (event.isRecurringOccurrence) return;
    void commitDateChange(event.task, new Date(start), new Date(end));
  }

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="mb-2 shrink-0 space-y-1">
        <ScheduleFilterBar users={users} filters={filters} onChange={setFilters} />
        {dragError && <p className="text-xs text-red-600">{dragError}</p>}
      </div>
      <style>{`
        .rbc-event-content { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rbc-event { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rbc-row-segment { overflow: hidden; }
        /* Task Bar를 compact/저채도로(요청사항 9) — 높이/여백을 줄이고 radius를
           작게 준다. Month은 RBC가 여러 주(row)에 걸친 이벤트를 각 주마다 별도
           segment로 나눠 그리므로, 연속된 하나의 막대처럼 보이려면(요청사항 10)
           주가 바뀌지 않는 한 조각나 보이면 안 된다 — RBC가 이미 각 segment에
           rbc-event-continues-prior/-after 클래스를 붙여주므로, 그 방향의
           radius만 지워 이어붙는 쪽은 사각으로 맞춘다(border-radius는 inline
           style보다 우선순위가 낮아야 해서 eventPropGetter가 아니라 여기 CSS에서만
           준다).
           Sat→Sun 중복 표시 버그 재발 방지용 dueDate 23:59:59.999 boundary
           fix(calendarMapper.ts)는 이 CSS와 무관하게 그대로 유지된다. */
        .rbc-event { border-radius: 4px; padding: 2px 6px; min-height: 24px; }
        .rbc-event.rbc-event-continues-prior { border-top-left-radius: 0; border-bottom-left-radius: 0; }
        .rbc-event.rbc-event-continues-after { border-top-right-radius: 0; border-bottom-right-radius: 0; }
        .rbc-row-segment .rbc-event { margin: 1px 0; }
        /* dragAndDrop addon의 좌/우 Resize 손잡이는 기본적으로 너비가 없어(아이콘
           선 두께만큼만) 실제로 집기 매우 어렵다 — CustomWeekView의 Resize 손잡이와
           동일한 체감(10px hit 영역)이 되도록 넓히되, 아이콘 자체는 justify-content로
           원래 가장자리에 그대로 고정해 시각적 폭은 그대로 얇게 유지한다.
           평소엔 손잡이 아이콘 자체를 감춰 뒀다가(요청사항 11) hover 시에만
           보이게 한다 — hit 영역(10px)은 항상 그대로 유지한다. */
        .rbc-addons-dnd-resize-ew-anchor { width: 10px; display: flex; }
        .rbc-addons-dnd-resize-ew-anchor:first-child { justify-content: flex-start; }
        .rbc-addons-dnd-resize-ew-anchor:last-child { justify-content: flex-end; }
        .rbc-addons-dnd-resize-ew-icon { opacity: 0; transition: opacity 0.1s; }
        .rbc-event:hover .rbc-addons-dnd-resize-ew-icon { opacity: 0.9; }
        /* 오늘 Column/Cell 배경은 아주 연하게만(요청사항 8) — Cell 전체를 강한
           색으로 채우지 않는다. */
        .rbc-day-bg.rbc-today { background-color: var(--color-navy-50); }
      `}</style>
      <div className="min-h-0 flex-1">
        <WeekViewUsersContext.Provider
          value={{
            users,
            onEventDateChange: (event, newStart, newEnd) => void commitDateChange(event.task, newStart, newEnd),
          }}
        >
          <DnDCalendar
            localizer={localizer}
            culture="ko"
            messages={messages}
            views={{ month: true, week: CustomWeekView }}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            events={events}
            startAccessor="start"
            endAccessor="end"
            allDayAccessor="allDay"
            components={{ toolbar: CalendarToolbar, month: { dateHeader: MonthDateHeader } }}
            popup
            selectable
            resizable
            resizableAccessor={(event: CalendarTaskEvent) => !event.isRecurringOccurrence && !NON_RESIZABLE_CATEGORIES.has(event.task.category)}
            draggableAccessor={(event: CalendarTaskEvent) => !event.isRecurringOccurrence}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            onSelectEvent={(event: CalendarTaskEvent) => onSelectTask(event.task)}
            onSelectSlot={(slot: SlotInfo) => onSelectSlot({ start: slot.start, end: slot.end })}
            eventPropGetter={(event: CalendarTaskEvent) => {
              const overdue = isTaskOverdue(event.task.dueDate, event.task.status);
              const done = event.task.status === "DONE";
              const onHold = event.task.status === TaskStatus.ON_HOLD;
              const tint = TASK_CATEGORY_TINTS[event.task.category];
              return {
                style: {
                  backgroundColor: tint.bg,
                  color: tint.text,
                  // 업무구분 색은 왼쪽 얇은 accent 띠로만 표시하고(요청사항 9:
                  // 담당자색이 아니라 Category색, 상태는 이를 덮어쓰지 않고
                  // 보조 표현), Overdue의 얇은 red border(요청사항)와 서로
                  // 다른 CSS 속성(boxShadow vs border)을 써서 절대 충돌하지
                  // 않게 한다.
                  boxShadow: `inset 3px 0 0 0 ${tint.border}`,
                  border: overdue ? "1px solid #dc2626" : "1px solid transparent",
                  opacity: done ? 0.55 : onHold ? 0.7 : 1,
                  textDecoration: done ? "line-through" : undefined,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                },
              };
            }}
            style={{ height: "100%" }}
          />
        </WeekViewUsersContext.Provider>
      </div>
    </div>
  );
}
