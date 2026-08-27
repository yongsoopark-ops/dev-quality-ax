"use client";

import { useState } from "react";

/**
 * `<input type="date">` 대신 쓰는 순수 텍스트 입력 — 숫자 8자리("20260910")를
 * 구분자 없이 연속으로 입력할 수 있고, 입력이 끝나면(8자리가 채워지면) 그때만
 * 부모에게 "YYYY-MM-DD" 형태로 값을 올린다. Calendar/DB에 실제 저장되는 날짜
 * 형식(YYYY-MM-DD 문자열 → new Date()) 자체는 전혀 바꾸지 않는다 — 입력 UX만
 * 바꾼다. 8자리 미만(입력 중/지우는 중)에는 부모 값을 ""로 되돌려 미완성 날짜가
 * 그대로 저장되는 것을 막는다.
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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value.replace(/\D/g, "").slice(0, 8);
    setDigits(next);
    if (next.length === 8) {
      onChange(`${next.slice(0, 4)}-${next.slice(4, 6)}-${next.slice(6, 8)}`);
    } else {
      onChange("");
    }
  }

  const display =
    digits.length <= 4
      ? digits
      : digits.length <= 6
        ? `${digits.slice(0, 4)}-${digits.slice(4)}`
        : `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="YYYYMMDD"
      value={display}
      onChange={handleChange}
      required={required}
      disabled={disabled}
      className={className}
    />
  );
}
