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
 *
 * Step(시작/마감일 Date Picker 범위 선택 UX 추가) — `range` prop을 넘긴
 * 인스턴스는(TaskDetailPanel.tsx의 시작일/마감일 두 입력) 자기 캘린더를
 * DatePickerCalendar의 range 모드로 연다 — 시작/마감 어느 쪽 아이콘을
 * 눌러도 "같은" Range Picker가 열리고 둘 다 갱신된다(요청사항 7). range를
 * 안 넘기는 기존 호출부(회의일, 일정 변경 시작/마감일)는 이전과 완전히
 * 동일한 단일 날짜 Picker로 동작한다 — 이 컴포넌트 자체의 시각/레이아웃도
 * 전혀 바뀌지 않는다.
 */
export function DateTextInput({
  value,
  onChange,
  required,
  disabled,
  className,
  range,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** 이 입력을 "시작일/마감일 쌍" 중 하나로 취급해 Range Picker를 연다. */
  range?: {
    /** 이 입력이 시작일인지 마감일인지 — 반대쪽 값과 합쳐 range를 구성한다. */
    role: "start" | "end";
    /** 짝이 되는 반대쪽 날짜의 현재 값("YYYY-MM-DD" 또는 빈 문자열). */
    companionValue: string;
    /** 범위가 확정되면(2번째 클릭) (시작일, 마감일) 둘 다로 한 번 호출된다
     * — 부모가 두 state를 함께 갱신한다. */
    onRangeChange: (startDate: string, endDate: string) => void;
  };
}) {
  const [digits, setDigits] = useState(() => value.replace(/\D/g, "").slice(0, 8));
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // Step(시작/마감일 Date Picker 범위 선택 UX 추가) — range 모드에서는 이
  // 입력의 value가 "반대쪽" DateTextInput의 Range Picker 선택으로(이
  // 컴포넌트 자신의 onChange를 거치지 않고) 외부에서 바뀔 수 있다. 기존
  // 코드는 digits를 마운트 시 한 번만 value로 초기화했기 때문에 그런
  // 외부 갱신을 놓쳤다 — 그래서 value가 실제로 바뀌면 digits를 다시
  // 맞춘다. React 공식 권장대로 "prop이 바뀌면 파생 state를 조정"하는
  // 작업은 useEffect가 아니라 렌더 중 비교로 처리한다(react-hooks/
  // set-state-in-effect 룰 — effect 안에서 무조건 setState를 부르면
  // 불필요한 추가 렌더가 생긴다). 단, 사용자가 이 입력에 8자리 미만을
  // 타이핑 중일 때는 이 컴포넌트 자신의 handleChange가 부모에
  // onChange("")를 올려 value가 일시적으로 ""가 되므로, 그 순간(value가
  // 빈 값)에는 절대 손대지 않는다 — 그렇지 않으면 입력 중이던 숫자가
  // 지워지는 회귀가 생긴다.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value) {
      const incoming = value.replace(/\D/g, "").slice(0, 8);
      if (incoming !== digits) setDigits(incoming);
    }
  }

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

  /** Range Picker에서 범위가 확정되면(시작/마감 둘 다) 호출된다. 이 입력
   * 자신이 담당하는 쪽(role) 값만 자기 digits에 반영한다 — 반대쪽
   * DateTextInput 인스턴스는 자기 자신의 value prop 변화를 위 렌더 중
   * 비교 로직이 감지해 알아서 맞춘다. */
  function handleRangeSelect(startDate: string, endDate: string, r: NonNullable<typeof range>) {
    const mine = r.role === "start" ? startDate : endDate;
    setDigits(mine.replace(/-/g, ""));
    r.onRangeChange(startDate, endDate);
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
      {pickerOpen &&
        (range ? (
          <DatePickerCalendar
            range={{
              startDate: range.role === "start" ? isoValue : range.companionValue,
              endDate: range.role === "end" ? isoValue : range.companionValue,
              onRangeSelect: (s, e) => handleRangeSelect(s, e, range),
            }}
          />
        ) : (
          <DatePickerCalendar value={isoValue} onSelect={handlePickerSelect} />
        ))}
    </span>
  );
}
