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

  // Step(일정 관리 + 회의록 UI Polish) — 컨트롤 높이/글자 크기 확대(요청사항
  // 2: "최소 36~40px 수준"). 버튼 h-7(28px)→h-9(36px), 글자 xs(12px)→sm
  // (14px)로 키웠다 — 동작(onNavigate/onView 호출)은 그대로다.
  //
  // Step(캘린더 UI/UX 개선, 요청 4) — 이전엔 이동(‹ 라벨 ›) 그룹이 좌측 끝,
  // 월/주 전환 버튼이 우측 끝에 있어 둘을 오갈 때 마우스 이동 거리가 컸다.
  // 3열 grid(좌측 spacer / 중앙 이동 그룹 / 우측 전환 버튼)로 바꿔 이동
  // 그룹을 중앙으로 옮긴다 — 전환 버튼은 기존과 같은 우측 자리를 유지해
  // 서로 가까워진다. 좌측 칸은 균형을 맞추는 빈 공간일 뿐 별도 내용은
  // 없다.
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div aria-hidden />

      <div className="flex items-center justify-self-center gap-1">
        <button
          type="button"
          onClick={() => onNavigate(Navigate.PREVIOUS)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-lg text-navy-950/60 hover:bg-navy-50"
          aria-label="이전"
        >
          ‹
        </button>
        <span className="min-w-[120px] text-center text-base font-semibold text-navy-950">{label}</span>
        <button
          type="button"
          onClick={() => onNavigate(Navigate.NEXT)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-lg text-navy-950/60 hover:bg-navy-50"
          aria-label="다음"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => onNavigate(Navigate.TODAY)}
          className="ml-1 flex h-9 items-center rounded-md border border-navy-100 px-3 text-sm font-medium text-navy-950/70 hover:bg-navy-50"
        >
          오늘
        </button>
        <input
          type="month"
          value={toMonthInputValue(date)}
          onChange={handleMonthPick}
          className="ml-1 h-9 rounded-md border border-navy-100 px-2 text-sm text-navy-950/70"
          aria-label="연도/월 선택"
        />
      </div>

      <div className="flex h-9 justify-self-end gap-1 rounded-md border border-navy-100 p-0.5">
        {(["week", "month"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            className={`rounded px-3.5 text-sm font-medium transition-colors ${
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
