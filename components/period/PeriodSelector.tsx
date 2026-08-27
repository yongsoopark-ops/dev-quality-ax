"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { DashboardPeriod } from "@/lib/period";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

interface RangeDraft {
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
}

function monthParam(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function toDraft(period: DashboardPeriod): RangeDraft {
  if (period.mode === "range") {
    return {
      fromYear: period.fromYear,
      fromMonth: period.fromMonth,
      toYear: period.toYear,
      toMonth: period.toMonth,
    };
  }
  return {
    fromYear: period.year,
    fromMonth: period.month,
    toYear: period.year,
    toMonth: period.month,
  };
}

export default function PeriodSelector({
  period,
  years,
}: {
  period: DashboardPeriod;
  years: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [rangeDraft, setRangeDraft] = useState<RangeDraft>(() => toDraft(period));
  const [prevPeriod, setPrevPeriod] = useState(period);

  // 뒤로가기/새로고침 등 외부에서 URL(=period prop)이 바뀌면 로컬 초안도 다시 맞춘다.
  // (렌더 중 조정 — React가 권장하는 "prop 변경 시 state 조정" 패턴, effect를 쓰지 않는다)
  if (period !== prevPeriod) {
    setPrevPeriod(period);
    if (period.mode === "range") {
      setRangeDraft(toDraft(period));
    }
  }

  function goMonth(year: number, month: number) {
    router.push(`${pathname}?date=${monthParam(year, month)}`);
  }

  function goRange(draft: RangeDraft) {
    router.push(
      `${pathname}?from=${monthParam(draft.fromYear, draft.fromMonth)}&to=${monthParam(draft.toYear, draft.toMonth)}`,
    );
  }

  function shiftMonth(delta: number) {
    if (period.mode !== "month") return;
    let y = period.year;
    let m = period.month + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    goMonth(y, m);
  }

  function goToday() {
    const now = new Date();
    goMonth(now.getFullYear(), now.getMonth() + 1);
  }

  function switchToRange() {
    const draft = toDraft(period);
    setRangeDraft(draft);
    goRange(draft);
  }

  function switchToMonth() {
    const base = period.mode === "month" ? period : { year: period.toYear, month: period.toMonth };
    goMonth(base.year, base.month);
  }

  function updateRangeDraft(patch: Partial<RangeDraft>) {
    const next = { ...rangeDraft, ...patch };
    setRangeDraft(next);
    const fromKey = next.fromYear * 100 + next.fromMonth;
    const toKey = next.toYear * 100 + next.toMonth;
    if (fromKey <= toKey) {
      goRange(next);
    }
  }

  const rangeInvalid =
    rangeDraft.fromYear * 100 + rangeDraft.fromMonth > rangeDraft.toYear * 100 + rangeDraft.toMonth;

  const yearOptionsFor = (y: number) =>
    years.includes(y) ? years : [...years, y].sort((a, b) => a - b);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-navy-100 p-3">
        <div className="flex overflow-hidden rounded-md border border-navy-100">
          <button
            type="button"
            onClick={switchToMonth}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              period.mode === "month"
                ? "bg-navy-900 text-white"
                : "text-navy-950/60 hover:bg-navy-100/40"
            }`}
          >
            월별
          </button>
          <button
            type="button"
            onClick={switchToRange}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              period.mode === "range"
                ? "bg-navy-900 text-white"
                : "text-navy-950/60 hover:bg-navy-100/40"
            }`}
          >
            기간
          </button>
        </div>

        {period.mode === "month" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="이전 달"
              className="rounded-md border border-navy-100 px-2 py-1 text-xs transition-colors hover:bg-navy-100/40"
            >
              이전
            </button>
            <select
              value={period.year}
              onChange={(e) => goMonth(Number(e.target.value), period.month)}
              className="rounded-md border border-navy-100 px-2 py-1.5 text-sm font-medium text-navy-950"
            >
              {yearOptionsFor(period.year).map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select
              value={period.month}
              onChange={(e) => goMonth(period.year, Number(e.target.value))}
              className="rounded-md border border-navy-100 px-2 py-1.5 text-sm font-medium text-navy-950"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}월
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="다음 달"
              className="rounded-md border border-navy-100 px-2 py-1 text-xs transition-colors hover:bg-navy-100/40"
            >
              다음
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-navy-950/50">시작</span>
            <select
              value={rangeDraft.fromYear}
              onChange={(e) => updateRangeDraft({ fromYear: Number(e.target.value) })}
              className="rounded-md border border-navy-100 px-2 py-1.5 text-sm font-medium text-navy-950"
            >
              {yearOptionsFor(rangeDraft.fromYear).map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select
              value={rangeDraft.fromMonth}
              onChange={(e) => updateRangeDraft({ fromMonth: Number(e.target.value) })}
              className="rounded-md border border-navy-100 px-2 py-1.5 text-sm font-medium text-navy-950"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}월
                </option>
              ))}
            </select>

            <span className="text-xs text-navy-950/40">~</span>

            <span className="text-xs text-navy-950/50">종료</span>
            <select
              value={rangeDraft.toYear}
              onChange={(e) => updateRangeDraft({ toYear: Number(e.target.value) })}
              className="rounded-md border border-navy-100 px-2 py-1.5 text-sm font-medium text-navy-950"
            >
              {yearOptionsFor(rangeDraft.toYear).map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select
              value={rangeDraft.toMonth}
              onChange={(e) => updateRangeDraft({ toMonth: Number(e.target.value) })}
              className="rounded-md border border-navy-100 px-2 py-1.5 text-sm font-medium text-navy-950"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}월
                </option>
              ))}
            </select>
          </div>
        )}

        {period.mode === "month" && (
          <button
            type="button"
            onClick={goToday}
            className="ml-auto text-xs text-navy-950/40 underline"
          >
            이번 달로
          </button>
        )}
      </div>

      {period.mode === "range" && rangeInvalid && (
        <p className="text-xs text-red-600">
          시작 기간은 종료 기간보다 이전이어야 합니다.
        </p>
      )}
    </div>
  );
}
