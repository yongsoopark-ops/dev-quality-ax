"use client";

import { formatKrw } from "@/lib/ai/currency";

interface UserUsageRow {
  userId: string;
  displayName: string;
  costKrw: number;
  unpricedCount: number;
}

export function MonthlyApiUsageModal({
  open,
  onClose,
  monthLabel,
  byUser,
  totalCostKrw,
}: {
  open: boolean;
  onClose: () => void;
  monthLabel: string;
  byUser: UserUsageRow[];
  totalCostKrw: number;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-navy-100 p-4">
          <h2 className="text-sm font-semibold text-navy-950">이번 달 API 사용 현황</h2>
          <p className="mt-1 text-xs text-navy-950/50">{monthLabel}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {byUser.length === 0 ? (
            <p className="text-sm text-navy-950/40">활성 사용자가 없습니다.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-navy-950/50">
                <tr>
                  <th className="border-b border-navy-100 py-2 font-medium">담당자</th>
                  <th className="border-b border-navy-100 py-2 text-right font-medium">
                    사용 비용
                  </th>
                </tr>
              </thead>
              <tbody>
                {byUser.map((row) => (
                  <tr key={row.userId} className="border-b border-navy-100/60">
                    <td className="py-2 text-navy-950/80">{row.displayName}</td>
                    <td className="py-2 text-right text-navy-950/80">
                      {formatKrw(row.costKrw)}
                      {row.unpricedCount > 0 && (
                        <span className="ml-1.5 text-[11px] text-navy-950/40">
                          가격 미확정 {row.unpricedCount}건
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="shrink-0 border-t border-navy-100 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-navy-950/60">합계</span>
            <span className="font-semibold text-navy-950">{formatKrw(totalCostKrw)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-md border border-navy-100 px-4 py-1.5 text-sm font-medium transition-colors hover:bg-navy-100/40"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
