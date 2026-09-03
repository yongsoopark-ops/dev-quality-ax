"use client";

import { useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer, type DateHeaderProps, type SlotInfo, type View } from "react-big-calendar";
import withDragAndDrop, { type EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";
import { addDays, format, getDay, isSameDay, parse, startOfWeek } from "date-fns";
import { ko } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import { mapTasksToEventsWithRecurrence, type CalendarTaskEvent } from "@/lib/schedule/calendarMapper";
import {
  TASK_CATEGORY_KEY as TaskCategory,
  TASK_STATUS_KEY as TaskStatus,
  isTaskOverdue,
  tintFromColor,
} from "@/lib/schedule/constants";
import { suppressClicksAfterDragInteraction } from "@/lib/schedule/dragInteraction";
import { EMPTY_SCHEDULE_FILTERS, filterTasks, type ScheduleFilters } from "@/lib/schedule/filters";
import { getHolidayName } from "@/lib/schedule/holidays";
import { getEffectiveTaskStatus } from "@/lib/schedule/meetingStatus";
import type { ProjectCategoryOption, ScheduleOptionInfo, ScheduleUser, TaskWithRelations } from "@/lib/schedule/types";
import { updateTaskDatesAction } from "./actions";
import { CalendarToolbar } from "./CalendarToolbar";
import { CustomWeekView, WeekViewUsersContext } from "./CustomWeekView";
import { ScheduleFilterBar } from "./ScheduleFilterBar";

/**
 * Month 날짜 숫자 표시(요청사항 8, Step(일정 관리 + 회의록 UI Polish)에서
 * 요청사항 4로 개선) — 일요일은 약한 Red, 토요일은 약한 Blue, 평일은
 * Navy/Gray. 오늘은 기존 "검정(navy-900) 동그라미로 숫자를 채우는" 표현을
 * 약화하고(요청사항: "검정색 원 중심 표현은 제거 또는 약화") 대신 굵은
 * accent 텍스트 + 아주 작은 "오늘" 배지로 바꿨다 — 한 눈에 "오늘"이라는
 * 단어 자체가 보이는 편이 원 모양보다 더 명확하다는 요청 취지를 따른다.
 * Step(Month/Week 오늘 배경 제거)에서 옅은 Column 배경(.rbc-day-bg.rbc-today)
 * 자체는 제거했다 — 오늘 표시는 이 텍스트 강조 + "오늘" badge만으로 충분하다는
 * 요청사항에 따른다. isOffRange(다른 달 날짜)/rbc-current 클래스 등 기존 처리는
 * RBC가 Wrapper에서 그대로
 * 계속 담당하므로 여기서는 label 자체의 색/오늘 표시만 신경 쓴다.
 * drilldownView가 없으면(현재 Day View 미등록) 기존 기본 DateHeader와
 * 동일하게 클릭 불가능한 순수 텍스트로 남긴다 — 동작 자체는 바꾸지 않는다.
 */
function MonthDateHeader({ date, label, drilldownView, onDrillDown }: DateHeaderProps) {
  const day = date.getDay();
  const today = isSameDay(date, new Date());
  const weekdayColor = day === 0 ? "text-red-400" : day === 6 ? "text-blue-400" : "text-navy-950/60";
  const holidayName = getHolidayName(date);

  const content = today ? (
    <span className="flex items-center gap-1">
      <span className="text-sm font-bold text-blue-600">{label}</span>
      <span className="rounded bg-blue-600 px-1 py-0.5 text-[9px] font-bold leading-none text-white">오늘</span>
    </span>
  ) : (
    <span className={`text-xs font-medium ${holidayName ? "text-red-500" : weekdayColor}`}>{label}</span>
  );

  return (
    <div className="flex flex-col items-end px-1 pt-1">
      {drilldownView ? (
        <button type="button" className="rbc-button-link" onClick={onDrillDown}>
          {content}
        </button>
      ) : (
        content
      )}
      {/* Step(한국 공휴일 표시, 요청사항 6) — Task/Gantt bar보다 시각적으로
          강하지 않게, 아주 작은 글씨로 날짜 아래 표시한다. */}
      {holidayName && <span className="max-w-full truncate text-[9px] font-medium text-red-500/80">{holidayName}</span>}
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

/** MEETING/HALF_DAY는 하루짜리 일정이라 Resize를 금지한다(요청사항). 시스템
 * 예약 key(문자열)만 비교하므로 사용자가 label을 바꿔도 그대로 동작한다. */
const NON_RESIZABLE_CATEGORIES = new Set<string>([TaskCategory.MEETING, TaskCategory.HALF_DAY]);

/** categoryOptionId/statusOptionId(문자열 id)로 색상을 찾는다 — 못 찾으면
 * (예: 데이터 정합성 문제) 중립 회색으로 안전하게 대체한다. */
function findTint(options: ScheduleOptionInfo[], id: string) {
  const option = options.find((o) => o.id === id);
  return tintFromColor(option?.color ?? "#94a3b8");
}

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
  taskCategoryOptions,
  taskStatusOptions,
  projectCategories,
  onSelectTask,
  onSelectSlot,
}: {
  tasks: TaskWithRelations[];
  users: ScheduleUser[];
  taskCategoryOptions: ScheduleOptionInfo[];
  taskStatusOptions: ScheduleOptionInfo[];
  /** Step(일정 관리 + 회의록 UI Polish) — "프로젝트 카테고리" 필터(요청사항
   * 2)에 그대로 넘긴다. */
  projectCategories: ProjectCategoryOption[];
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
    // Step(Month/Week Drag·Resize UX 통일) — Month(handleEventDrop/
    // handleEventResize, react-big-calendar 자체 DnD)와 Week(CustomWeekView
    // 자체 pointer 구현) 양쪽의 "drag 결과를 최종 commit하는" 공통 지점이
    // 바로 여기다. react-big-calendar는 Selection 유틸로 click/drag는
    // 스스로 구분하지만 그 이후 브라우저가 별도로 합성하는 native click까지
    // 막아주지는 않는다 — 실측 결과 Month View도 Week View와 동일하게
    // resize 직후 Bar/빈 셀 click이 그대로 통과해 팝업이 잘못 열리는 문제가
    // 재현됐다(lib/schedule/dragInteraction.ts 참고). 이 함수는 실제
    // drag/resize가 threshold를 넘겨 커밋될 때만 호출되므로(Month는
    // react-big-calendar의 5px tolerance를 넘겨야 handleEventDrop/
    // handleEventResize 자체가 호출됨, Week는 CustomWeekView가 자체
    // DRAG_THRESHOLD_PX 통과 후에만 호출) 여기 한 곳에서만 억제해도 두 View
    // 모두 커버된다.
    suppressClicksAfterDragInteraction();

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
        <ScheduleFilterBar
          users={users}
          categoryOptions={taskCategoryOptions}
          statusOptions={taskStatusOptions}
          projectCategories={projectCategories}
          filters={filters}
          onChange={setFilters}
        />
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
        /* Step(Month/Week Drag·Resize UX 통일, 요청사항 2) — react-big-calendar
           기본 아이콘(border-left: 3px double, 이중선 모양)을 지우고
           CustomWeekView의 손잡이(w-1 rounded-full, 업무구분 accent 색)와
           같은 모양(가늘고 둥근 세로 막대)으로 맞춘다. 색은 eventPropGetter가
           style에 심어주는 --handle-color 변수를 그대로 쓴다(업무구분 accent
           tint.border) — Bar마다 색이 다르므로 고정값을 못 쓴다. anchor가
           .rbc-addons-dnd-resizable(항상 부모 content-box 안, width/height
           100%)의 padding 안쪽에서만 절대배치되므로 3px overdue border와는
           애초에 겹치지 않는다(border는 그 바깥쪽 border-box에 그려짐). */
        /* react-big-calendar.css의 기본 규칙(.rbc-addons-dnd .rbc-addons-dnd-resize-ew-anchor
           .rbc-addons-dnd-resize-ew-icon)이 클래스 3단 선택자라 여기 1단
           선택자보다 우선순위가 높다 — border-left/height는 !important 없이는
           덮이지 않는 것을 실측으로 확인했다(라이브러리 기본값을 의도적으로
           덮어쓰는 지점이라 !important 사용이 타당하다). */
        .rbc-addons-dnd-resize-ew-icon {
          border: none !important;
          width: 4px;
          height: 60% !important;
          margin: auto 0;
          border-radius: 9999px;
          background-color: var(--handle-color, currentColor);
          opacity: 0;
          transition: opacity 0.1s;
        }
        .rbc-event:hover .rbc-addons-dnd-resize-ew-icon { opacity: 0.9; }
        /* Step(Month/Week 오늘 배경 제거) — 오늘 Cell 전체를 채우던 옅은
           background tint를 제거하고 흰색(다른 날짜와 동일)으로 통일한다.
           오늘 여부는 MonthDateHeader의 파란 텍스트 + "오늘" badge만으로
           표현한다(요청사항) — 그 둘은 이 CSS와 무관하게 그대로 유지된다.
           react-big-calendar.css 기본값(.rbc-today 셀렉터에 background-color:
           #eaf6ff, 우리가 쓴 적 없는 라이브러리 자체 색)이 이 요소에도
           그대로 적용되고 있어(실측 확인) 이전 커스텀 override 규칙을
           단순히 지우기만 해서는 배경이 사라지지 않는다 — .rbc-day-bg.
           rbc-today(클래스 2개, 라이브러리의 .rbc-today 단독 선택자보다
           우선순위가 높음)로 명시적으로 투명 처리해야 실제로 흰색이 된다. */
        .rbc-day-bg.rbc-today { background-color: transparent; }
        /* Step(월 경계 표현 개선, 요청사항 5) — react-big-calendar 기본값은
           이전/다음 달 날짜의 Cell 배경 전체를 회색으로 채워, 실제 업무일
           (예: 9월 첫 주에 보이는 8/31)이 "비활성"처럼 보이는 문제가 있었다
           (요청사항 예시 그대로 재현 확인). Cell 배경은 완전히 투명하게 두고
           (평일 배경과 동일하게), 날짜 숫자/월 표시만 흐리게 하는 건
           MonthDateHeader의 opacity(아래)로 대신한다 — "월 경계"와 "비활성
           날짜"가 시각적으로 섞이지 않게 한다. */
        .rbc-off-range-bg { background-color: transparent; }
        .rbc-off-range { opacity: 0.45; }
      `}</style>
      <div className="min-h-0 flex-1">
        <WeekViewUsersContext.Provider
          value={{
            users,
            taskCategoryOptions,
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
              // Step 5B-7(미팅 회차별 자동 상태) — MEETING은 저장된 statusOptionId가
              // 아니라 "이 회차(event.start)의 날짜 + 시작/종료 시각 + 지금 시각"으로
              // 매 렌더마다 다시 계산한 상태를 쓴다(단발/반복 공용, 원본 Task Row는
              // 절대 건드리지 않는다). MEETING이 아니거나 사용자가 직접 예외 상태
              // (보류 등)로 바꿨다면 이 함수가 그대로 저장된 값을 돌려준다.
              const effectiveStatus = getEffectiveTaskStatus(event.task, event.start);
              const overdue = isTaskOverdue(event.task.dueDate, effectiveStatus, event.task.category);
              const done = effectiveStatus === TaskStatus.DONE;
              const onHold = effectiveStatus === TaskStatus.ON_HOLD;
              const tint = findTint(taskCategoryOptions, event.task.category);
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
                  // Step(Month View overdue border 가시성 보완) — Week View
                  // (CustomWeekView.tsx EventBar)에 이미 적용된 기준(3px solid
                  // #dc2626 / 비지연 3px solid transparent)을 Month View에도
                  // 동일하게 맞춘다. eventPropGetter가 반환하는 이 style은
                  // react-big-calendar가 .rbc-event에 인라인으로 그대로
                  // 적용하므로(react-big-calendar.css의 `.rbc-event { border:
                  // none }`는 class 기반 규칙이라 인라인 style보다 우선순위가
                  // 낮다 — 확인 완료, 별도 override 불필요) 이 값이 곧
                  // 최종 computed border다. 비지연 Bar도 동일 폭(3px
                  // transparent)으로 맞춰 상태에 따라 Bar 크기가 흔들리지
                  // 않게 한다.
                  border: overdue ? "3px solid #dc2626" : "3px solid transparent",
                  opacity: done ? 0.55 : onHold ? 0.7 : 1,
                  textDecoration: done ? "line-through" : undefined,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                  // Step(Month/Week Drag·Resize UX 통일) — 아래 CSS의 resize
                  // 손잡이(.rbc-addons-dnd-resize-ew-icon)가 이 Bar의
                  // 업무구분 accent 색(tint.border)을 그대로 쓰도록 CSS
                  // 변수로 전달한다. React CSSProperties 타입에는 커스텀
                  // property가 없어 캐스팅이 필요하다.
                  "--handle-color": tint.border,
                } as React.CSSProperties,
              };
            }}
            style={{ height: "100%" }}
          />
        </WeekViewUsersContext.Provider>
      </div>
    </div>
  );
}
