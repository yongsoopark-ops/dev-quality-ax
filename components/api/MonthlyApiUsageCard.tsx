"use client";

import { useState } from "react";
import { MonthlyApiUsageModal } from "@/components/api/MonthlyApiUsageModal";
import { formatKrw } from "@/lib/ai/currency";
import type { MonthlyApiUsageSummary } from "@/lib/ai/usageSummary";

export function MonthlyApiUsageCard({ summary }: { summary: MonthlyApiUsageSummary }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen(true);
        }}
        className="w-full shrink-0 cursor-pointer rounded-xl border border-navy-100 p-4 transition-colors hover:bg-navy-100/20 sm:w-64"
      >
        <p className="text-xs font-medium text-navy-950/60">이번 달 API</p>

        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-xl font-semibold text-navy-950">
            {formatKrw(summary.totalCostKrw)}
          </span>
          {summary.usagePercent !== null ? (
            <span className="shrink-0 text-xs font-medium text-navy-950/50">
              예산 {summary.usagePercent}%
            </span>
          ) : (
            <span className="shrink-0 text-xs text-navy-950/40">예산 미설정</span>
          )}
        </div>

        {summary.usagePercent !== null && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-navy-100/50">
            <div
              className="h-1.5 rounded-full bg-navy-800"
              style={{ width: `${Math.min(100, Math.max(0, summary.usagePercent))}%` }}
            />
          </div>
        )}

        {summary.unpricedCount > 0 && (
          <p className="mt-1.5 text-[11px] text-navy-950/40">
            가격 미확정 {summary.unpricedCount}건
          </p>
        )}
      </div>

      <MonthlyApiUsageModal
        open={open}
        onClose={() => setOpen(false)}
        monthLabel={summary.monthLabel}
        byUser={summary.byUser}
        totalCostKrw={summary.totalCostKrw}
      />
    </>
  );
}
