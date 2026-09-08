"use client";

import { useEffect, useRef, useState } from "react";
import { DatePickerCalendar } from "./DatePickerCalendar";

/**
 * `<input type="date">` 대신 쓰는 순수 텍스트 입력 — 숫자 8자리("20260910")를
 * 구분자 없이 연속으로 입력할 수 있고, 입력이 끝나면(8자리가 채워지면) 그때만
 * 부모에게 "YYYY-MM-DD" 형태로 값을 올린다. Calendar/DB에 실제 저장되는 날짜
 * 형식(YYYY-MM-DD 문자열 → new Date()) 자체는 전혀 바꾸지 않는다 — 입력 UX만
 * 바꾼다. 8자리 미만(입력 중/지우는 중)에는 부모 값을 ""로 되돌려 미완성 날짜가
 * 그대로 저장되는 것을 막는다.
 *
 * Step(Month View/프로젝트명 일괄 변경/Date Picker 가시성 개선) — native
 * `<input type="date">`는 브라우저/OS가 팝업을 통째로 그려서 날짜별 색을
 * 커스터마이징할 방법이 없었다(토/일/공휴일 빨간색 표시 요청사항을 만족할
 * 수 없음) — 그래서 커스텀 Calendar Popover(DatePickerCalendar.tsx, 기존
 * date-fns/holidays.ts 재사용, 새 라이브러리 없음)로 바꾼다. 숫자 직접입력
 * UX·onChange 계약은 이전 Step 그대로 유지 — 캘린더 아이콘을 누르면
 * Popover가 뜨고, 거기서 고른 날짜가 같은 onChange로 그대로 올라간다.
 * ScheduleFilterBar.tsx의 FilterTrigger와 같은 click-outside-to-close
 * 패턴을 그대로 재사용한다.
 */
export function DateTextInput({
  value,
  onChange,
  required,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [digits, setDigits] = useState(() => value.replace(/\D/g, "").slice(0, 8));
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value.replace(/\D/g, "").slice(0, 8);
    setDigits(next);
    if (next.length === 8) {
      onChange(`${next.slice(0, 4)}-${next.slice(4, 6)}-${next.slice(6, 8)}`);
    } else {
      onChange("");
    }
  }

  /** Calendar Popover에서 날짜를 고르면 "YYYY-MM-DD"가 그대로 온다 — 8자리
   * 숫자 직접입력과 똑같은 최종 형태라 부모에게 그대로 올리고, 내부 표시용
   * digits도 맞춰 둔다(직접입력↔Picker 양방향 동기화). */
  function handlePickerSelect(dateStr: string) {
    setDigits(dateStr.replace(/-/g, ""));
    onChange(dateStr);
    setPickerOpen(false);
  }

  const display =
    digits.length <= 4
      ? digits
      : digits.length <= 6
        ? `${digits.slice(0, 4)}-${digits.slice(4)}`
        : `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;

  const isoValue = digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";

  return (
    <span ref={wrapperRef} className={`relative inline-flex items-center gap-1 ${disabled ? "opacity-60" : ""} ${className ?? ""}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="YYYYMMDD"
        value={display}
        onChange={handleChange}
        required={required}
        disabled={disabled}
        className="w-full min-w-0 border-0 bg-transparent p-0 text-inherit outline-none"
      />
      <button
        type="button"
        aria-label="달력에서 날짜 선택"
        disabled={disabled}
        onClick={() => setPickerOpen((v) => !v)}
        className="shrink-0 text-[13px] leading-none text-navy-950/40 hover:text-navy-950/70 disabled:cursor-not-allowed disabled:hover:text-navy-950/40"
      >
        📅
      </button>
      {pickerOpen && <DatePickerCalendar value={isoValue} onSelect={handlePickerSelect} />}
    </span>
  );
}
