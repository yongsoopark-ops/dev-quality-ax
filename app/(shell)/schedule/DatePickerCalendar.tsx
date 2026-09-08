"use client";

import { useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { ko } from "date-fns/locale";
import { getHolidayName } from "@/lib/schedule/holidays";

/**
 * Step(Month View/프로젝트명 일괄 변경/Date Picker 가시성 개선) — native
 * `<input type="date">`는 브라우저/OS가 팝업을 통째로 그려서 날짜별 색을
 * 커스터마이징할 방법이 없다(토/일/공휴일 빨간색 표시 요청사항을 만족할
 * 수 없음). 프로젝트에 이미 있는 것 확인 결과 별도 Date Picker
 * 라이브러리·Popover 컴포넌트는 없었지만, 공휴일 판정은 이미
 * lib/schedule/holidays.ts(date-holidays 기반, Month View가 쓰는 것과
 * 완전히 같은 함수)가 있어 그대로 재사용한다 — 하드코딩된 날짜 없음.
 * Calendar 그리드 계산은 이미 프로젝트 의존성인 date-fns만 쓴다(새
 * 라이브러리 추가 없음).
 *
 * ScheduleFilterBar.tsx의 FilterTrigger/OverflowMenu(MeetingMinutesPreviewClient.tsx)
 * 와 같은 "click-outside-to-close" Popover 패턴은 이 컴포넌트를 감싸는
 * DateTextInput.tsx 쪽에서 처리한다 — 여기서는 그리드 렌더링과 날짜 선택만
 * 담당한다.
 */
export function DatePickerCalendar({
  value,
  onSelect,
}: {
  /** "YYYY-MM-DD" 또는 빈 문자열(아직 선택 안 됨). */
  value: string;
  onSelect: (dateStr: string) => void;
}) {
  const parsedValue = value ? new Date(`${value}T00:00:00`) : null;
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parsedValue ?? new Date()));

  // Step(Final UI Fix — Date Picker 일요일 시작) — 한 차례 Month View(월요일
  // 시작)와 통일했었으나, 사용자 요청으로 다시 일요일 시작(date-fns 기본값,
  // weekStartsOn: 0)으로 되돌린다.
  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();

  function pad(n: number): string {
    return String(n).padStart(2, "0");
  }
  function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** !inMonth(다른 달 overflow 칸)는 "흐림" 여부일 뿐 색 자체와는 별개
   * 조건이다 — Month View(MonthDateHeader)가 이미 쓰는 방식과 같다:
   * off-range는 opacity만 낮추고 토/일/공휴일 빨간색은 그대로 유지한다.
   * 처음엔 우선순위 분기(!inMonth를 red보다 먼저 확인)로 짰다가, 다른
   * 달로 넘어간 공휴일(예: 다음 달 1일 개천절)이 흐리기만 하고 빨간색이
   * 빠지는 걸 실측으로 발견해 "흐림"과 "색"을 독립된 축으로 분리했다. */
  function dayButtonClassName(inMonth: boolean, isRedDay: boolean, isSelected: boolean, isToday: boolean): string {
    const base = "rounded py-1 text-xs transition-colors";
    if (isSelected) return `${base} bg-navy-900 font-semibold text-white`;
    if (isToday) return `${base} border border-blue-500 font-semibold text-blue-600 hover:bg-blue-50`;
    const colorClass = isRedDay ? "text-red-500" : "text-navy-950/80";
    const opacityClass = inMonth ? "" : "opacity-40";
    return `${base} ${colorClass} ${opacityClass} hover:bg-navy-50`;
  }

  return (
    <div
      // 캘린더 아이콘 바로 아래(부모 span이 relative)에 뜨는 Popover.
      // z-30 — MeetingMinutesPreviewClient.tsx OverflowMenu/LinkPopup과
      // 같은 값(이 프로젝트에서 "Toolbar류보다 위에 떠야 하는 Popover"에
      // 이미 쓰는 관례를 그대로 따름).
      className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-navy-100 bg-white p-2.5 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth((m) => subMonths(m, 1))} className="rounded px-2 py-0.5 text-xs text-navy-950/60 hover:bg-navy-50" aria-label="이전 달">
          ‹
        </button>
        <span className="text-xs font-semibold text-navy-950">{format(viewMonth, "yyyy년 M월", { locale: ko })}</span>
        <button type="button" onClick={() => setViewMonth((m) => addMonths(m, 1))} className="rounded px-2 py-0.5 text-xs text-navy-950/60 hover:bg-navy-50" aria-label="다음 달">
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 pb-1 text-center text-[10px] font-medium text-navy-950/40">
        {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
          <div key={w} className={i === 0 || i === 6 ? "text-red-500" : undefined}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const dateStr = toDateStr(d);
          const inMonth = isSameMonth(d, viewMonth);
          const holidayName = getHolidayName(d);
          const weekday = d.getDay();
          // 표시 정책: 토요일/일요일/공휴일 전부 빨간색(요청사항) — Month
          // View의 기존 헤더 배색(토=파랑)과는 별개로, 이 Date Picker는
          // 이번 요청사항이 명시한 대로 주말 둘 다 빨간색으로 통일한다.
          const isRedDay = weekday === 0 || weekday === 6 || !!holidayName;
          const isSelected = !!parsedValue && isSameDay(d, parsedValue);
          const isToday = isSameDay(d, today);

          return (
            <button
              key={dateStr}
              type="button"
              title={holidayName ?? undefined}
              onClick={() => onSelect(dateStr)}
              className={dayButtonClassName(inMonth, isRedDay, isSelected, isToday)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
