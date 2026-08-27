"use client";

import { Navigate, type ToolbarProps } from "react-big-calendar";
import type { CalendarTaskEvent } from "@/lib/schedule/calendarMapper";

function toMonthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * "오늘/이전/다음" 텍스트 버튼을 없애고 중앙 "‹ 8월 2026 ›" 형태 + 좌측 연도/월
 * Month Picker로 바꾼 Toolbar. Calendar 자체의 controlled view/date 구조는
 * 그대로 두고, 이 Toolbar는 react-big-calendar가 표준으로 내려주는
 * onNavigate/onView만 호출한다 — 별도 상태를 갖지 않는다.
 */
export function CalendarToolbar({ date, label, view, onNavigate, onView }: ToolbarProps<CalendarTaskEvent>) {
  function handleMonthPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.value) return;
    const [year, month] = e.target.value.split("-").map(Number);
    onNavigate(Navigate.DATE, new Date(year, month - 1, 1));
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onNavigate(Navigate.PREVIOUS)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-navy-950/60 hover:bg-navy-50"
          aria-label="이전"
        >
          ‹
        </button>
        <span className="min-w-[110px] text-center text-sm font-semibold text-navy-950">{label}</span>
        <button
          type="button"
          onClick={() => onNavigate(Navigate.NEXT)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-navy-950/60 hover:bg-navy-50"
          aria-label="다음"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => onNavigate(Navigate.TODAY)}
          className="ml-1 rounded-md border border-navy-100 px-2.5 py-1 text-xs font-medium text-navy-950/70 hover:bg-navy-50"
        >
          오늘
        </button>
        <input
          type="month"
          value={toMonthInputValue(date)}
          onChange={handleMonthPick}
          className="ml-1 rounded-md border border-navy-100 px-2 py-1 text-xs text-navy-950/70"
          aria-label="연도/월 선택"
        />
      </div>

      <div className="flex gap-1 rounded-md border border-navy-100 p-0.5">
        {(["month", "week"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              view === v ? "bg-navy-900 text-white" : "text-navy-950/60 hover:bg-navy-50"
            }`}
          >
            {v === "month" ? "월" : "주"}
          </button>
        ))}
      </div>
    </div>
  );
}
