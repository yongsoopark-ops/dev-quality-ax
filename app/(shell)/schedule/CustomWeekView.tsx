"use client";

import { createContext, useContext, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, isSameDay, startOfWeek } from "date-fns";
import { Navigate, type NavigateAction } from "react-big-calendar";
import {
  COMMON_ASSIGNEE_TINT,
  TASK_CATEGORY_KEY as TaskCategory,
  TASK_STATUS_KEY as TaskStatus,
  UNASSIGNED_USER_TINT,
  getUserInitials,
  getUserTint,
  isTaskOverdue,
  tintFromColor,
  type UserTint,
} from "@/lib/schedule/constants";
import type { CalendarTaskEvent } from "@/lib/schedule/calendarMapper";
import { suppressClicksAfterDragInteraction } from "@/lib/schedule/dragInteraction";
import { getHolidayName } from "@/lib/schedule/holidays";
import { getEffectiveTaskStatus } from "@/lib/schedule/meetingStatus";
import type { ScheduleOptionInfo, ScheduleUser } from "@/lib/schedule/types";

/**
 * react-big-calendar는 View Component에 표준 Props(date/events/onSelectEvent/
 * onSelectSlot)만 넘겨준다. users나 Drag&Drop 콜백처럼 View 밖에서 온 값은
 * Props로 끼워 넣을 방법이 없어 Context로 전달한다 — CalendarView가 Provider로
 * 감싸고, 여기서 useContext로 읽는다.
 *
 * onEventDateChange(event, newStart, newEnd): Week Swimlane 안에서 같은 담당자
 * Row 내부로만 Drag/Resize한 결과를 CalendarView의 낙관적 업데이트+저장+롤백
 * 로직에 그대로 위임한다 — Month View(withDragAndDrop)와 저장 경로를 통일해
 * 로직 중복을 없앤다.
 */
export interface WeekViewContextValue {
  users: ScheduleUser[];
  /** Step 5B-4(사용자 정의 업무구분) — EventBar의 색상 계산에 필요하다. Month
   * View(CalendarView)와 마찬가지로 여기도 정적 TASK_CATEGORY_TINTS 대신 이
   * 목록에서 찾아 색을 계산한다. */
  taskCategoryOptions: ScheduleOptionInfo[];
  onEventDateChange: (event: CalendarTaskEvent, newStart: Date, newEnd: Date) => void;
}

export const WeekViewUsersContext = createContext<WeekViewContextValue>({
  users: [],
  taskCategoryOptions: [],
  onEventDateChange: () => {},
});

function findTint(options: ScheduleOptionInfo[], id: string) {
  const option = options.find((o) => o.id === id);
  return tintFromColor(option?.color ?? "#94a3b8");
}

/**
 * react-big-calendar 기본 Week View는 시간(00:00~23:00) Grid를 가진 Scheduler다.
 * 이 프로젝트는 시간 단위 일정이 아니라 "담당자별 날짜 단위 Task Bar"(Swimlane/
 * Gantt)가 필요해서, 시간축이 전혀 없는 완전 커스텀 Week View를 만든다.
 * react-big-calendar는 navigate/title 정적 메서드만 있으면 어떤 Component든
 * View로 등록할 수 있다(ViewStatic 계약) — Month View나 Toolbar의 controlled
 * date/onNavigate 구조는 그대로 재사용된다.
 *
 * Row=담당자(users), Column=월~일(Monday-start) 구조라 users/events만 갈아
 * 끼우면 이후 Home 주간 Gantt에도 그대로 재사용할 수 있게 WeekRow/packLanes를
 * 분리해 뒀다.
 *
 * Drag/Resize는 react-big-calendar의 dragAndDrop addon을 쓰지 않는다 — 그
 * addon은 라이브러리 자체 View(Month/TimeGrid)의 컴포넌트 슬롯(eventWrapper 등)
 * 에만 연결되고, 이 View는 그 슬롯을 전혀 쓰지 않는 완전 커스텀 DOM이라 addon이
 * 끼어들 지점이 없다. 대신 각 Bar에 순수 pointer 이벤트 기반의 최소 구현을
 * 둔다 — Bar는 항상 자신이 속한 Row(같은 담당자)의 CSS Grid 안에서만 존재하므로
 * 세로(다른 담당자 Row) 이동은 애초에 발생할 수 없고, 가로(날짜) 이동만 자연히
 * 허용된다.
 */
interface CustomWeekViewProps {
  date: Date;
  events: CalendarTaskEvent[];
  onSelectEvent: (event: CalendarTaskEvent) => void;
  onSelectSlot: (slot: { start: Date; end: Date }) => void;
}

/**
 * Step(주간 간트 가독성 개선) — 주간 간트는 업무일(월~금) 5일만 표시한다
 * (요청사항: "토요일/일요일을 제거한다"). 주 자체의 시작은 여전히 월요일
 * (startOfWeek weekStartsOn:1)이고 navigate(±7일)도 그대로 "달력 주" 단위로
 * 움직인다 — 바뀌는 건 "그 주의 며칠을 컬럼으로 그리는지"뿐이다. 주말에
 * 걸친 업무(예: 목~일)의 Task 데이터/날짜 자체는 전혀 건드리지 않고, 그 Bar를
 * 5번째 컬럼(금) 오른쪽 경계에서 시각적으로만 clip한다(주말 자체에만 있는
 * 업무는 이 5일 Grid에 표시할 칸이 없어 이 View에서는 보이지 않지만, 다른
 * 화면(Month/상세/필터)의 데이터에는 전혀 영향이 없다 — "표시 UI"만의 변경).
 */
const VISIBLE_WEEKDAYS = 5;
const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
/** Step(주간 Gantt 가독성 확대) — 기존 26px(요청사항: "현재 대비 약
 * 1.4~1.6배") → 40px(1.54배). Task Bar 자체 높이는 아래 EventBar에서
 * ROW_HEIGHT에서 여백을 뺀 값을 쓴다(기준 26~32px 요청 충족: 40-10=30px). */
const ROW_HEIGHT = 40;
const NAME_COL_WIDTH = 150;
const UNASSIGNED_ROW_LABEL = "미배정";
/** Step(담당자 UX 개선) — 특정 개인 담당자 없이 의도적으로 등록한 팀 공통
 * 업무. "담당자 미지정"(레거시 예외 상태, UNASSIGNED_ROW_LABEL)과는 완전히
 * 다른 의미라 별도 Row/label을 쓴다. */
const COMMON_ROW_LABEL = "공통";
const NON_RESIZABLE_CATEGORIES = new Set<string>([TaskCategory.MEETING, TaskCategory.HALF_DAY]);
const DRAG_THRESHOLD_PX = 4;

interface PlacedBar {
  event: CalendarTaskEvent;
  startCol: number;
  endCol: number;
  lane: number;
}

/** 겹치는 이벤트를 시작 컬럼 순으로 정렬해 위에서부터 빈 Lane에 채우는 단순
 * Greedy 배치(Month View와 같은 개념) — 담당자별 Row 하나 안에서만 겹침을
 * 계산한다(다른 담당자의 업무와는 겹쳐도 서로 다른 Row라 무관하다). */
function packLanes(
  eventsInRow: CalendarTaskEvent[],
  weekStart: Date,
  weekEndExclusive: Date,
): { placed: PlacedBar[]; laneCount: number } {
  const spans = eventsInRow
    .map((event) => {
      const clippedStart = event.start < weekStart ? weekStart : event.start;
      const startCol = differenceInCalendarDays(clippedStart, weekStart);
      // event.end는 "마감일 당일의 마지막 순간"(포함 경계)이라 그대로 day 차이를
      // 구하면 마감일의 "포함" 컬럼이 나온다 — CSS grid-column의 배타적 끝 값으로
      // 쓰려면 +1 해야 한다. 다만 주 범위를 넘어가 weekEndExclusive로 잘린
      // 경우엔 그 값 자체가 이미 배타적 경계라 +1을 더하지 않는다.
      const endCol =
        event.end > weekEndExclusive
          ? differenceInCalendarDays(weekEndExclusive, weekStart)
          : differenceInCalendarDays(event.end, weekStart) + 1;
      return { event, startCol, endCol };
    })
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));

  const laneEndCols: number[] = [];
  const placed = spans.map((s) => {
    let lane = laneEndCols.findIndex((end) => end <= s.startCol);
    if (lane === -1) {
      lane = laneEndCols.length;
      laneEndCols.push(s.endCol);
    } else {
      laneEndCols[lane] = s.endCol;
    }
    return { ...s, lane };
  });
  return { placed, laneCount: Math.max(laneEndCols.length, 1) };
}

type DragMode = "move" | "resize-start" | "resize-end";

function EventBar({
  event,
  startCol,
  endCol,
  lane,
  rowRef,
  onSelectEvent,
  onCommitDateChange,
}: {
  event: CalendarTaskEvent;
  startCol: number;
  endCol: number;
  lane: number;
  rowRef: React.RefObject<HTMLDivElement | null>;
  onSelectEvent: (event: CalendarTaskEvent) => void;
  onCommitDateChange: (event: CalendarTaskEvent, newStart: Date, newEnd: Date) => void;
}) {
  const [preview, setPreview] = useState<{ mode: DragMode; dayDelta: number } | null>(null);
  // Step(주간 Gantt Resize 직후 신규 일정 팝업 오동작 수정) — dayDelta를
  // React state(preview)뿐 아니라 이 ref에도 동기적으로 함께 기록해 둔다.
  // 아래 handlePointerUp의 click-억제 판단은 반드시 pointerup과 "같은
  // 동기 실행 구간"에서 끝나야 한다(뒤이어 브라우저가 곧바로 합성하는
  // 'click' 이벤트보다 늦게 window에 리스너가 붙으면 이미 늦다) — setState
  // updater 콜백은 React가 나중에(다음 렌더 때) 실행하므로 그 안에서
  // window.addEventListener를 부르면 타이밍이 보장되지 않는다. ref는 항상
  // 즉시 최신값을 읽을 수 있어 이 문제가 없다.
  const dragRef = useRef<{ mode: DragMode; startX: number; colWidth: number; moved: boolean; dayDelta: number } | null>(null);
  const { taskCategoryOptions, users } = useContext(WeekViewUsersContext);

  // Step 5B-1(반복 일정) — 계산된 회차(실제 Task Row 없음)는 Drag도 Resize도
  // 모두 막는다. Month View(CalendarView.tsx의 draggableAccessor/
  // resizableAccessor)와 동일한 기준이다.
  const draggable = !event.isRecurringOccurrence;
  const resizable = draggable && !NON_RESIZABLE_CATEGORIES.has(event.task.category);
  // Step 5B-7(미팅 회차별 자동 상태) — CalendarView(Month)와 동일한 계산을
  // Week View에도 그대로 적용한다(요청사항: Month/Week 양쪽 동일 적용).
  const effectiveStatus = getEffectiveTaskStatus(event.task, event.start);
  const overdue = isTaskOverdue(event.task.dueDate, effectiveStatus, event.task.category);
  const done = effectiveStatus === TaskStatus.DONE;
  const onHold = effectiveStatus === TaskStatus.ON_HOLD;
  const tint = findTint(taskCategoryOptions, event.task.category);

  // Step(업무 행 정보 위계, 요청사항 7) — "업무명 → 프로젝트명/목표명 →
  // 담당자" 우선순위로 정보를 탐색할 수 있게 한다. Bar 자체는 26px 높이라
  // 여러 줄을 넣으면 Lane 배치 수식(packLanes)이 가정하는 고정 행 높이가
  // 깨지므로(기존 기능 구조 유지 — 이번 Step은 UI polish만), 시각적으로는
  // 업무명만 굵게 강조하고 나머지는 hover 시 보이는 title(tooltip)에
  // 담아 클릭 없이도 확인할 수 있게 한다.
  const assigneeNames = event.task.assigneeIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is ScheduleUser => !!u)
    .map((u) => u.name ?? u.email);
  const secondaryLine = event.task.projectDetail?.projectName || event.task.goalName || null;
  const tooltipLines = [event.title, secondaryLine, assigneeNames.length > 0 ? `담당: ${assigneeNames.join(", ")}` : null].filter(
    (l): l is string => !!l,
  );

  function beginDrag(e: React.PointerEvent, mode: DragMode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rowRect = rowRef.current?.getBoundingClientRect();
    if (!rowRect) return;
    const colWidth = rowRect.width / VISIBLE_WEEKDAYS;
    dragRef.current = { mode, startX: e.clientX, colWidth, moved: false, dayDelta: 0 };
    setPreview({ mode, dayDelta: 0 });

    function handlePointerMove(ev: PointerEvent) {
      const s = dragRef.current;
      if (!s) return;
      const deltaPx = ev.clientX - s.startX;
      if (Math.abs(deltaPx) > DRAG_THRESHOLD_PX) s.moved = true;
      s.dayDelta = Math.round(deltaPx / s.colWidth);
      setPreview({ mode: s.mode, dayDelta: s.dayDelta });
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      const s = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      if (!s?.moved) return;

      // Step(Month/Week Drag·Resize UX 통일) — 이 interaction에서 파생된
      // 합성 click을 target(Bar 자신/빈 셀)과 무관하게 억제하는 로직을
      // Month View(CalendarView.tsx)와 공용 helper로 뺐다(lib/schedule/
      // dragInteraction.ts 참고 — {once:true}가 실측에서 부족했던 이유,
      // 300ms 시간창을 쓰는 이유 등 상세 배경은 그쪽 주석 참고). dayDelta가
      // 0이라 commitDrag(→commitDateChange)를 안 타는 경우에도(예: 드래그
      // 했다가 원래 자리로 돌아온 경우) 억제는 필요하므로 여기서 한 번
      // 호출해 둔다 — commitDateChange 안에서도 같은 helper를 호출하지만
      // (Month 경로 커버 목적) 두 번 호출돼도 단순히 같은 정책을 한 번 더
      // 적용할 뿐 부작용은 없다.
      suppressClicksAfterDragInteraction();

      if (s.dayDelta !== 0) {
        commitDrag(s.mode, s.dayDelta);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function commitDrag(mode: DragMode, dayDelta: number) {
    let newStart = event.start;
    let newEnd = event.end;
    if (mode === "move") {
      newStart = addDays(event.start, dayDelta);
      newEnd = addDays(event.end, dayDelta);
    } else if (mode === "resize-start") {
      newStart = addDays(event.start, dayDelta);
      if (newStart > newEnd) newStart = newEnd; // 방어: startDate > dueDate 금지
    } else {
      newEnd = addDays(event.end, dayDelta);
      if (newEnd < newStart) newEnd = newStart; // 방어: dueDate < startDate 금지
    }
    onCommitDateChange(event, newStart, newEnd);
  }

  const previewStartCol = preview?.mode === "move" || preview?.mode === "resize-start" ? startCol + (preview?.dayDelta ?? 0) : startCol;
  const previewEndCol = preview?.mode === "move" || preview?.mode === "resize-end" ? endCol + (preview?.dayDelta ?? 0) : endCol;
  const displayStartCol = Math.min(previewStartCol, previewEndCol - 1);
  const displayEndCol = Math.max(previewEndCol, previewStartCol + 1);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelectEvent(event);
      }}
      onPointerDown={draggable ? (e) => beginDrag(e, "move") : undefined}
      className="group relative z-10 mx-0.5 my-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2 text-left text-sm font-semibold"
      style={{
        gridColumn: `${displayStartCol + 1} / ${displayEndCol + 1}`,
        gridRow: lane + 1,
        backgroundColor: tint.bg,
        color: tint.text,
        // Task Bar 색은 담당자가 아니라 업무구분 기준이다(요청사항 24) — 왼쪽
        // 얇은 accent 띠로만 표시하고, 담당자 구분은 Row 배경(WeekRow)이 맡는다.
        boxShadow: `inset 3px 0 0 0 ${tint.border}`,
        // Step(예정/진행중 지연 border 가시성 강화, 2차) — 2px도 실제 화면
        // 기준 가시성이 부족하다는 피드백으로 3px로 재강화. 색/상태 의미
        // (overdue만, DONE/ON_HOLD는 그대로 미적용)는 그대로 둔다. border는
        // opacity/취소선 등 다른 상태 표현과 서로 다른 CSS 속성이라
        // hover/drag와 충돌하지 않는다. 비-overdue Bar도 동일하게 3px
        // transparent border를 써서 overdue Bar와 크기/레이아웃이 상태에
        // 따라 흔들리지 않게 한다(box-sizing: border-box).
        border: overdue ? "3px solid #dc2626" : "3px solid transparent",
        opacity: done ? 0.55 : onHold ? 0.7 : preview ? 0.85 : 1,
        textDecoration: done ? "line-through" : undefined,
        // Step(Task Bar 확대, 요청사항 2) — 26~32px 기준. ROW_HEIGHT(40)에서
        // 상하 여백(mx-0.5 my-1 = 4px×2)을 뺀 32px.
        height: ROW_HEIGHT - 8,
        lineHeight: `${ROW_HEIGHT - 8}px`,
        cursor: !draggable ? "pointer" : preview?.mode === "move" ? "grabbing" : "grab",
      }}
      title={tooltipLines.join("\n")}
    >
      {resizable && (
        // 시각적 표시(안쪽 막대, 4px)보다 실제 pointer hit 영역(바깥 span,
        // 10px)을 더 넓게 잡는다 — 좁은 Bar 손끝으로 정확히 맞추기 어렵다는
        // 피드백 반영. stopPropagation은 beginDrag 안에서 처리되어 가운데
        // Drag(이동) 영역과 겹치지 않는다. 평상시엔 거의 안 보이다가 hover 시에만
        // 나타난다(요청사항: hover 중심 정리) — Bar가 밝은 배경이라 흰색 대신
        // 업무구분 accent 색을 옅게 써서 눈에 띄게 한다.
        <span
          onPointerDown={(e) => beginDrag(e, "resize-start")}
          className="absolute inset-y-0 left-0 z-20 flex w-2.5 cursor-ew-resize items-stretch justify-start"
        >
          <span className="w-1 rounded-full opacity-0 group-hover:opacity-100" style={{ backgroundColor: tint.border }} />
        </span>
      )}
      {event.title}
      {resizable && (
        <span
          onPointerDown={(e) => beginDrag(e, "resize-end")}
          className="absolute inset-y-0 right-0 z-20 flex w-2.5 cursor-ew-resize items-stretch justify-end"
        >
          <span className="w-1 rounded-full opacity-0 group-hover:opacity-100" style={{ backgroundColor: tint.border }} />
        </span>
      )}
    </button>
  );
}

/** 담당자 원형 Avatar — 선택된 담당자면 이름 2글자, 미배정이면 회색 원 +
 * 사람 아이콘(ScheduleFilterBar의 Avatar와 같은 시각 언어를 공유한다). "공통"은
 * 같은 원형이지만 여러 명 아이콘으로 구분한다(요청사항: "필요 시 작은
 * 색상 dot"). */
function Avatar({ label, tint, icon }: { label: string; tint: UserTint; icon?: "unassigned" | "common" }) {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: tint.avatarBg, color: tint.avatarText }}
    >
      {icon === "unassigned" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 19.5c1.6-3.2 4.4-4.8 7.5-4.8s5.9 1.6 7.5 4.8" />
        </svg>
      ) : icon === "common" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <circle cx="8.5" cy="8" r="2.8" />
          <circle cx="16" cy="8.5" r="2.3" />
          <path d="M3 19c.9-3 3-4.6 5.5-4.6S13.6 16 14.5 19" />
          <path d="M14.8 14.8c2 .3 3.4 1.6 4.2 4.2" />
        </svg>
      ) : (
        label
      )}
    </span>
  );
}

function WeekRow({
  label,
  initials,
  tint,
  icon,
  eventsInRow,
  weekStart,
  weekEndExclusive,
  days,
  todayColIndex,
  onSelectEvent,
  onSelectSlot,
  onCommitDateChange,
}: {
  label: string;
  initials: string;
  tint: UserTint;
  icon?: "unassigned" | "common";
  eventsInRow: CalendarTaskEvent[];
  weekStart: Date;
  weekEndExclusive: Date;
  days: Date[];
  todayColIndex: number;
  onSelectEvent: (event: CalendarTaskEvent) => void;
  onSelectSlot: (slot: { start: Date; end: Date }) => void;
  onCommitDateChange: (event: CalendarTaskEvent, newStart: Date, newEnd: Date) => void;
}) {
  const { placed, laneCount } = packLanes(eventsInRow, weekStart, weekEndExclusive);
  // Step(담당자/업무 Row 높이 확대, 요청사항 1) — 업무 수(laneCount)에 맞춰
  // 자연스럽게 늘어나는 구조는 그대로 두고, 위아래 여백만 8→12로 넓힌다
  // ("각 업무 행의 상하 padding 확대", 요청사항 4).
  const rowHeight = laneCount * ROW_HEIGHT + 12;
  const gridRef = useRef<HTMLDivElement>(null);

  return (
    // Step(주간 간트 담당자 영역 가시성 개선) — Row 전체 배경색(연보라/연초록
    // 등)이 일정 Bar 색상과 겹쳐 보인다는 요청사항으로 흰색 기반으로
    // 단순화했다. 담당자 구분은 이름 칸의 얇은 left accent border + Avatar
    // 색만으로 표현하고, hover 시에만 아주 옅은 회색을 준다(Bar 색이 가장
    // 먼저 보이도록).
    <div className="flex border-b border-navy-100 bg-white last:border-b-0 hover:bg-navy-950/[0.015]">
      <div
        className="flex shrink-0 items-center gap-2 border-r border-navy-100 px-3"
        style={{ width: NAME_COL_WIDTH, height: rowHeight, boxShadow: `inset 3px 0 0 0 ${tint.accent}` }}
      >
        <Avatar label={initials} tint={tint} icon={icon} />
        <span className="truncate text-sm font-medium text-navy-950/70" title={label}>
          {label}
        </span>
      </div>
      <div ref={gridRef} className="relative grid flex-1 grid-cols-5" style={{ height: rowHeight }}>
        {days.map((d, i) => {
          // Step(한국 공휴일 표시, 요청사항 6) — "Task/Gantt bar보다 시각적으로
          // 강하지 않게" + "해당 column background는 매우 약한 holiday tint
          // 가능" — 오늘과 겹치면(드물지만) 오늘 강조를 우선한다.
          const isToday = i === todayColIndex;
          const isHoliday = !isToday && getHolidayName(d) !== null;
          return (
            <div
              key={d.toISOString()}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSlot({ start: d, end: addDays(d, 1) })}
              className="cursor-pointer border-l border-navy-100 first:border-l-0 hover:brightness-[0.97]"
              style={{
                gridColumn: i + 1,
                gridRow: `1 / span ${laneCount}`,
                // Step(Month/Week 오늘 배경 제거) — 오늘 Column을 채우던 옅은
                // 파란 오버레이를 제거했다(흰색으로 통일). 공휴일 tint는
                // 기존 로직 그대로 유지한다 — isHoliday 자체가 이미
                // "오늘이 아닐 때만"이라는 기존 우선순위 규칙을 그대로
                // 담고 있어(위 isHoliday 계산) 여기서 따로 손대지 않는다.
                boxShadow: isHoliday ? "inset 0 0 0 999px rgba(239,68,68,0.035)" : undefined,
              }}
            />
          );
        })}
        {placed.map(({ event, startCol, endCol, lane }) => (
          <EventBar
            key={event.id}
            event={event}
            startCol={startCol}
            endCol={endCol}
            lane={lane}
            rowRef={gridRef}
            onSelectEvent={onSelectEvent}
            onCommitDateChange={onCommitDateChange}
          />
        ))}
      </div>
    </div>
  );
}

export function CustomWeekView({ date, events, onSelectEvent, onSelectSlot }: CustomWeekViewProps) {
  const { users, onEventDateChange } = useContext(WeekViewUsersContext);
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  // 이 View 안에서는 "주"가 곧 "표시하는 5일"이다 — packLanes의 clip 경계
  // (weekEndExclusive)와 겹침 필터가 이 값을 그대로 쓰므로, 토/일에 걸친
  // 업무는 금요일 컬럼 경계에서 시각적으로 잘리고 토/일에만 있는 업무는
  // (표시할 컬럼이 없어) 이 주간 간트에서만 보이지 않는다 — Task 데이터/
  // 다른 화면에는 영향 없다(요청사항).
  const weekEndExclusive = addDays(weekStart, VISIBLE_WEEKDAYS);
  const days = Array.from({ length: VISIBLE_WEEKDAYS }, (_, i) => addDays(weekStart, i));
  const todayColIndex = days.findIndex((d) => isSameDay(d, new Date()));

  const overlapping = events.filter((e) => e.start < weekEndExclusive && e.end > weekStart);
  // Step(담당자 UX 개선) — "공통"(의도적으로 특정 개인 담당자 없음)과
  // "미배정"(이 필드 도입 이전 레거시 Row 등, 의미 없는 예외 상태)을
  // isCommonAssignee로 구분한다. 둘 다 assigneeIds는 비어 있다.
  const common = overlapping.filter((e) => e.task.assigneeIds.length === 0 && e.task.isCommonAssignee);
  const unassigned = overlapping.filter((e) => e.task.assigneeIds.length === 0 && !e.task.isCommonAssignee);

  return (
    <div className="flex flex-col overflow-x-auto">
      <div className="flex border-b border-navy-100">
        <div className="shrink-0 border-r border-navy-100" style={{ width: NAME_COL_WIDTH }} />
        <div className="grid flex-1 grid-cols-5">
          {days.map((d, i) => {
            const isToday = i === todayColIndex;
            const holidayName = getHolidayName(d);
            // Step(월 경계 표현 개선, 요청사항 5) — Week 간트는 원래 월 표시가
            // 전혀 없어(예: "31"만 보이면 8월인지 9월인지 알 수 없다) 그
            // 자체가 혼동의 원인이었다. Cell을 gray-out하는 대신, 주 안에서
            // 월이 바뀌는 첫 날에만 "M월" 접두어를 붙인다(다른 날짜는 그대로
            // 숫자만 — 불필요한 반복 표시를 피한다).
            const showMonth = i === 0 || d.getMonth() !== days[i - 1].getMonth();
            return (
              <div
                key={d.toISOString()}
                className={`flex flex-col items-center gap-1 border-l border-navy-100 px-2 py-3 text-center first:border-l-0 ${
                  isToday ? "" : "text-navy-950/70"
                }`}
              >
                {/* Step(Header/Cell spacing 확대, 요청사항 3·4) — 요일 header
                    12px→14px(text-sm), 상하 padding py-2→py-3로 header 자체
                    높이도 함께 키운다. */}
                <span className={`text-sm ${isToday ? "font-bold text-blue-600" : "font-semibold"}`}>
                  {showMonth && `${format(d, "M")}월 `}
                  {format(d, "d")}({WEEKDAY_LABELS[i]})
                </span>
                {isToday && (
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">오늘</span>
                )}
                {/* Step(한국 공휴일 표시, 요청사항 6) — Task Bar보다 약하게,
                    날짜 헤더 아래 작은 글씨로만. 요일 header(14px)보다 한 단계
                    작게 유지한다(요청사항: "보조정보는 주정보보다 한 단계 작게"). */}
                {holidayName && <span className="max-w-full truncate text-[10px] font-medium text-red-500/80">{holidayName}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step(담당자 UX 개선) — 최종 Row 순서: 1. 공통 2. 각 담당자(기존
          정렬 기준인 users 배열 순서 그대로 재사용, 하드코딩 순서 없음)
          3. 미배정(레거시 예외, 있을 때만). */}
      {common.length > 0 && (
        <WeekRow
          label={COMMON_ROW_LABEL}
          initials=""
          tint={COMMON_ASSIGNEE_TINT}
          icon="common"
          eventsInRow={common}
          weekStart={weekStart}
          weekEndExclusive={weekEndExclusive}
          days={days}
          todayColIndex={todayColIndex}
          onSelectEvent={onSelectEvent}
          onSelectSlot={onSelectSlot}
          onCommitDateChange={onEventDateChange}
        />
      )}

      {users.map((user, i) => (
        <WeekRow
          key={user.id}
          label={user.name ?? user.email}
          initials={getUserInitials(user.name, user.email)}
          tint={getUserTint(i)}
          eventsInRow={overlapping.filter((e) => e.task.assigneeIds.includes(user.id))}
          weekStart={weekStart}
          weekEndExclusive={weekEndExclusive}
          days={days}
          todayColIndex={todayColIndex}
          onSelectEvent={onSelectEvent}
          onSelectSlot={onSelectSlot}
          onCommitDateChange={onEventDateChange}
        />
      ))}

      {unassigned.length > 0 && (
        <WeekRow
          label={UNASSIGNED_ROW_LABEL}
          initials=""
          tint={UNASSIGNED_USER_TINT}
          icon="unassigned"
          eventsInRow={unassigned}
          weekStart={weekStart}
          weekEndExclusive={weekEndExclusive}
          days={days}
          todayColIndex={todayColIndex}
          onSelectEvent={onSelectEvent}
          onSelectSlot={onSelectSlot}
          onCommitDateChange={onEventDateChange}
        />
      )}
    </div>
  );
}

CustomWeekView.navigate = (date: Date, action: NavigateAction): Date => {
  if (action === Navigate.PREVIOUS) return addDays(date, -7);
  if (action === Navigate.NEXT) return addDays(date, 7);
  return date;
};

CustomWeekView.title = (date: Date): string => {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  // 표시 Grid가 월~금 5일이므로 제목도 그 범위(금요일까지)로 맞춘다 —
  // navigate는 여전히 달력 주 단위(±7일)로 움직인다(요청사항: 주간 계산
  // 자체는 그대로, 표시만 바뀐다).
  const end = addDays(start, VISIBLE_WEEKDAYS - 1);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${format(start, "M월 d일")} – ${format(end, "d일")}`
    : `${format(start, "M월 d일")} – ${format(end, "M월 d일")}`;
};
