"use client";

import { useRef, useState } from "react";

/**
 * `<input type="date">` 대신 쓰는 순수 텍스트 입력 — 숫자 8자리("20260910")를
 * 구분자 없이 연속으로 입력할 수 있고, 입력이 끝나면(8자리가 채워지면) 그때만
 * 부모에게 "YYYY-MM-DD" 형태로 값을 올린다. Calendar/DB에 실제 저장되는 날짜
 * 형식(YYYY-MM-DD 문자열 → new Date()) 자체는 전혀 바꾸지 않는다 — 입력 UX만
 * 바꾼다. 8자리 미만(입력 중/지우는 중)에는 부모 값을 ""로 되돌려 미완성 날짜가
 * 그대로 저장되는 것을 막는다.
 *
 * Step(Schedule/Meeting Minutes V1.1 사용성 개선 — Date Picker) — "기존 직접
 * 입력은 유지"(요청사항)하면서 달력 아이콘으로도 같은 값을 선택할 수 있게
 * 한다. 새 Date Picker 라이브러리를 추가하지 않고(의존성 확인 결과 프로젝트에
 * 이미 있는 것도 없음) 네이티브 `<input type="date">` 하나를 아주 작은 달력
 * 아이콘 자리에만 투명하게 겹쳐 둔다 — 그 아이콘 영역을 클릭하면 브라우저
 * 기본 Date Picker가 뜨고, 거기서 고른 값이 같은 onChange로 그대로 올라간다.
 * 아이콘 바깥(텍스트 입력 부분)은 이 겹친 input이 차지하지 않으므로 숫자
 * 직접입력 동작은 전혀 달라지지 않는다.
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
  const pickerRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value.replace(/\D/g, "").slice(0, 8);
    setDigits(next);
    if (next.length === 8) {
      onChange(`${next.slice(0, 4)}-${next.slice(4, 6)}-${next.slice(6, 8)}`);
    } else {
      onChange("");
    }
  }

  /** 네이티브 Date Picker에서 날짜를 고르면 "YYYY-MM-DD"(빈 문자열이면
   * 사용자가 선택을 지운 것)가 그대로 온다 — 8자리 숫자 조합과 똑같은
   * 최종 형태라 부모에게 그대로 올리고, 내부 표시용 digits도 맞춰 둔다. */
  function handlePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const iso = e.target.value;
    if (!iso) return;
    const next = iso.replace(/-/g, "");
    setDigits(next);
    onChange(iso);
  }

  const display =
    digits.length <= 4
      ? digits
      : digits.length <= 6
        ? `${digits.slice(0, 4)}-${digits.slice(4)}`
        : `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;

  const pickerValue = digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";

  return (
    <span className={`inline-flex items-center gap-1 ${disabled ? "opacity-60" : ""} ${className ?? ""}`}>
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
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none text-navy-950/40">
        <span aria-hidden className="pointer-events-none select-none">
          📅
        </span>
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-label="달력에서 날짜 선택"
          value={pickerValue}
          onChange={handlePickerChange}
          disabled={disabled}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </span>
    </span>
  );
}
