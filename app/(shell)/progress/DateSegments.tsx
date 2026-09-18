"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 진행 현황 — 연·월(·일) 분리 입력 컴포넌트. Claude 디자인 핸드오프
 * (`클로드 디자인_HANDOFF.md` §7.4) 스펙 그대로:
 *  - 숫자만 허용, 자릿수를 채우면 다음 칸으로 자동 포커스 이동
 *  - 자릿수를 넘겨 입력하면 최근 입력한 숫자가 남는다(슬라이딩 윈도우)
 *  - 포커스 시 전체 선택(이미 값이 있어도 바로 재입력 가능)
 *  - autocomplete 비활성화
 *  - 모든 칸이 채워졌을 때만 값이 확정되어 부모에 전달된다(그 전엔 "").
 * 날짜(YYYY-MM-DD)용 SegmentedDateInput과 월(YYYY-MM)용
 * SegmentedMonthInput 둘 다 이 파일에 둔다 — 둘 다 같은 세그먼트 입력
 * 규칙을 쓰지만 자릿수/구성이 달라 하나로 억지로 합치지 않는다.
 */

const segmentClass = "w-[44px] rounded border border-navy-100 px-1 py-1 text-center text-[13px] tabular-nums";
const yearSegmentClass = "w-[56px] rounded border border-navy-100 px-1 py-1 text-center text-[13px] tabular-nums";

function clampDigits(raw: string, maxLen: number): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > maxLen ? digits.slice(-maxLen) : digits;
}

function useAutoFocusSegment(nextRef: React.RefObject<HTMLInputElement | null> | null, maxLen: number) {
  return (value: string) => {
    if (value.length === maxLen) nextRef?.current?.focus();
  };
}

function backspaceToPrev(prevRef: React.RefObject<HTMLInputElement | null> | null) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && (e.target as HTMLInputElement).value === "") {
      prevRef?.current?.focus();
    }
  };
}

export function SegmentedDateInput({
  value,
  onChange,
  onEnter,
  autoFocus,
  className,
}: {
  /** "YYYY-MM-DD" 또는 "" */
  value: string;
  /** 세 칸이 모두 채워졌을 때 "YYYY-MM-DD", 아니면 "" */
  onChange: (value: string) => void;
  onEnter?: () => void;
  /** 마운트 시 첫 칸(연도)에 포커스 — PW 팝업처럼 버튼 클릭으로 막 펼쳐진
   * 입력창에 쓴다. */
  autoFocus?: boolean;
  className?: string;
}) {
  const [y, setY] = useState("");
  const [m, setM] = useState("");
  const [d, setD] = useState("");
  const yRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const dRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    setY(match ? match[1] : "");
    setM(match ? match[2] : "");
    setD(match ? match[3] : "");
  }, [value]);

  useEffect(() => {
    if (autoFocus) yRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusAfterYear = useAutoFocusSegment(mRef, 4);
  const focusAfterMonth = useAutoFocusSegment(dRef, 2);

  function commit(ny: string, nm: string, nd: string) {
    onChange(ny.length === 4 && nm.length === 2 && nd.length === 2 ? `${ny}-${nm}-${nd}` : "");
  }

  function handleEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter?.();
    }
  }

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <input
        ref={yRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY"
        value={y}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const next = clampDigits(e.target.value, 4);
          setY(next);
          commit(next, m, d);
          focusAfterYear(next);
        }}
        onKeyDown={handleEnter}
        className={yearSegmentClass}
      />
      <span className="text-neutral-300">.</span>
      <input
        ref={mRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM"
        value={m}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const next = clampDigits(e.target.value, 2);
          setM(next);
          commit(y, next, d);
          focusAfterMonth(next);
        }}
        onKeyDown={(e) => { backspaceToPrev(yRef)(e); handleEnter(e); }}
        className={segmentClass}
      />
      <span className="text-neutral-300">.</span>
      <input
        ref={dRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD"
        value={d}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const next = clampDigits(e.target.value, 2);
          setD(next);
          commit(y, m, next);
        }}
        onKeyDown={(e) => { backspaceToPrev(mRef)(e); handleEnter(e); }}
        className={segmentClass}
      />
    </div>
  );
}

export function SegmentedMonthInput({
  value,
  onChange,
  className,
}: {
  /** "YYYY-MM" 또는 "" */
  value: string;
  /** 두 칸이 모두 채워졌을 때 "YYYY-MM", 아니면 "" */
  onChange: (value: string) => void;
  className?: string;
}) {
  const [y, setY] = useState("");
  const [m, setM] = useState("");
  const yRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    setY(match ? match[1] : "");
    setM(match ? match[2] : "");
  }, [value]);

  const focusAfterYear = useAutoFocusSegment(mRef, 4);

  function commit(ny: string, nm: string) {
    onChange(ny.length === 4 && nm.length === 2 ? `${ny}-${nm}` : "");
  }

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <input
        ref={yRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY"
        value={y}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const next = clampDigits(e.target.value, 4);
          setY(next);
          commit(next, m);
          focusAfterYear(next);
        }}
        className={yearSegmentClass}
      />
      <span className="text-neutral-300">.</span>
      <input
        ref={mRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM"
        value={m}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const next = clampDigits(e.target.value, 2);
          setM(next);
          commit(y, next);
        }}
        onKeyDown={backspaceToPrev(yRef)}
        className={segmentClass}
      />
    </div>
  );
}
