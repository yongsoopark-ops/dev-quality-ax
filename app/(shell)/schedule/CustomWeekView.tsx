"use client";

import { createContext, useContext, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, isSameDay, startOfWeek } from "date-fns";
import { Navigate, type NavigateAction } from "react-big-calendar";
import {
  TASK_CATEGORY_TINTS,
  UNASSIGNED_USER_TINT,
  getUserInitials,
  getUserTint,
  isTaskOverdue,
  type UserTint,
} from "@/lib/schedule/constants";
import type { CalendarTaskEvent } from "@/lib/schedule/calendarMapper";
import type { ScheduleUser } from "@/lib/schedule/types";
import { TaskCategory, TaskStatus } from "@/app/generated/prisma/enums";

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
  onEventDateChange: (event: CalendarTaskEvent, newStart: Date, newEnd: Date) => void;
}

export const WeekViewUsersContext = createContext<WeekViewContextValue>({
  users: [],
  onEventDateChange: () => {},
});

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

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const ROW_HEIGHT = 26;
const NAME_COL_WIDTH = 110;
const UNASSIGNED_ROW_LABEL = "미배정";
const NON_RESIZABLE_CATEGORIES = new Set<TaskCategory>([TaskCategory.MEETING, TaskCategory.HALF_DAY]);
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
  const dragRef = useRef<{ mode: DragMode; startX: number; colWidth: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  // Step 5B-1(반복 일정) — 계산된 회차(실제 Task Row 없음)는 Drag도 Resize도
  // 모두 막는다. Month View(CalendarView.tsx의 draggableAccessor/
  // resizableAccessor)와 동일한 기준이다.
  const draggable = !event.isRecurringOccurrence;
  const resizable = draggable && !NON_RESIZABLE_CATEGORIES.has(event.task.category);
  const overdue = isTaskOverdue(event.task.dueDate, event.task.status);
  const done = event.task.status === "DONE";
  const onHold = event.task.status === TaskStatus.ON_HOLD;
  const tint = TASK_CATEGORY_TINTS[event.task.category];

  function beginDrag(e: React.PointerEvent, mode: DragMode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rowRect = rowRef.current?.getBoundingClientRect();
    if (!rowRect) return;
    const colWidth = rowRect.width / 7;
    dragRef.current = { mode, startX: e.clientX, colWidth, moved: false };
    setPreview({ mode, dayDelta: 0 });

    function handlePointerMove(ev: PointerEvent) {
      const s = dragRef.current;
      if (!s) return;
      const deltaPx = ev.clientX - s.startX;
      if (Math.abs(deltaPx) > DRAG_THRESHOLD_PX) s.moved = true;
      const dayDelta = Math.round(deltaPx / s.colWidth);
      setPreview({ mode: s.mode, dayDelta });
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      const s = dragRef.current;
      dragRef.current = null;
      setPreview((current) => {
        if (s?.moved && current && current.dayDelta !== 0) {
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          commitDrag(s.mode, current.dayDelta);
        }
        return null;
      });
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
        if (suppressClickRef.current) return;
        onSelectEvent(event);
      }}
      onPointerDown={draggable ? (e) => beginDrag(e, "move") : undefined}
      className="group relative z-10 mx-0.5 my-0.5 overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 text-left text-xs font-medium"
      style={{
        gridColumn: `${displayStartCol + 1} / ${displayEndCol + 1}`,
        gridRow: lane + 1,
        backgroundColor: tint.bg,
        color: tint.text,
        // Task Bar 색은 담당자가 아니라 업무구분 기준이다(요청사항 24) — 왼쪽
        // 얇은 accent 띠로만 표시하고, 담당자 구분은 Row 배경(WeekRow)이 맡는다.
        boxShadow: `inset 3px 0 0 0 ${tint.border}`,
        border: overdue ? "1px solid #dc2626" : "1px solid transparent",
        opacity: done ? 0.55 : onHold ? 0.7 : preview ? 0.85 : 1,
        textDecoration: done ? "line-through" : undefined,
        height: ROW_HEIGHT - 4,
        lineHeight: `${ROW_HEIGHT - 4}px`,
        cursor: !draggable ? "pointer" : preview?.mode === "move" ? "grabbing" : "grab",
      }}
      title={event.title}
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
 * 사람 아이콘(ScheduleFilterBar의 Avatar와 같은 시각 언어를 공유한다). */
function Avatar({ label, tint, isUnassigned }: { label: string; tint: UserTint; isUnassigned?: boolean }) {
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: tint.avatarBg, color: tint.avatarText }}
    >
      {isUnassigned ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 19.5c1.6-3.2 4.4-4.8 7.5-4.8s5.9 1.6 7.5 4.8" />
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
  isUnassigned,
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
  isUnassigned?: boolean;
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
  const rowHeight = laneCount * ROW_HEIGHT + 8;
  const gridRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex border-b border-navy-100 last:border-b-0" style={{ backgroundColor: tint.row }}>
      <div
        className="flex shrink-0 items-center gap-1.5 border-r border-navy-100 px-2"
        style={{ width: NAME_COL_WIDTH, height: rowHeight, backgroundColor: tint.cell }}
      >
        <Avatar label={initials} tint={tint} isUnassigned={isUnassigned} />
        <span className="truncate text-xs font-medium text-navy-950/70" title={label}>
          {label}
        </span>
      </div>
      <div ref={gridRef} className="relative grid flex-1 grid-cols-7" style={{ height: rowHeight }}>
        {days.map((d, i) => (
          <div
            key={d.toISOString()}
            role="button"
            tabIndex={0}
            onClick={() => onSelectSlot({ start: d, end: addDays(d, 1) })}
            className="cursor-pointer border-l border-navy-100 first:border-l-0 hover:brightness-[0.97]"
            style={{
              gridColumn: i + 1,
              gridRow: `1 / span ${laneCount}`,
              // 오늘 Column은 과도하지 않게, 아주 연한 오버레이만 얹는다(요청사항
              // 27) — 굵은 빨간 선 같은 강한 강조는 쓰지 않는다.
              boxShadow: i === todayColIndex ? "inset 0 0 0 999px rgba(21,42,84,0.045)" : undefined,
            }}
          />
        ))}
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
  const weekEndExclusive = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayColIndex = days.findIndex((d) => isSameDay(d, new Date()));

  const overlapping = events.filter((e) => e.start < weekEndExclusive && e.end > weekStart);
  // 담당자 지정이 없는(구 UI로 만들어진) 레거시 Task도 화면에서 사라지지 않도록
  // "미배정" Row로 별도 표시한다.
  const unassigned = overlapping.filter((e) => e.task.assigneeIds.length === 0);

  return (
    <div className="flex flex-col overflow-x-auto">
      <div className="flex border-b border-navy-100">
        <div className="shrink-0 border-r border-navy-100" style={{ width: NAME_COL_WIDTH }} />
        <div className="grid flex-1 grid-cols-7">
          {days.map((d, i) => (
            <div
              key={d.toISOString()}
              className={`border-l border-navy-100 px-2 py-2 text-center text-xs first:border-l-0 ${
                i === todayColIndex ? "font-semibold text-navy-900" : "font-medium text-navy-950/70"
              }`}
            >
              {format(d, "d")}({WEEKDAY_LABELS[i]})
              {i === todayColIndex && <div className="mx-auto mt-1 h-0.5 w-4 rounded-full bg-navy-900" />}
            </div>
          ))}
        </div>
      </div>

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
          isUnassigned
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
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${format(start, "M월 d일")} – ${format(end, "d일")}`
    : `${format(start, "M월 d일")} – ${format(end, "M월 d일")}`;
};
