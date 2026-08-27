"use client";

import { createPortal } from "react-dom";

interface DrilldownRow {
  [column: string]: string;
}

/** 권장 비율: 발생일 11% / 제품명 18% / 시험 항목 12% / 최종 판정 10% / 판정 사유 나머지(약 49%). */
const COLUMN_WIDTHS: Record<string, string> = {
  발생일: "11%",
  제품명: "18%",
  "시험 항목": "12%",
  "최종 판정": "10%",
  "판정 사유": "49%",
};

export function KpiDrilldownModal({
  open,
  onClose,
  title,
  periodLabel,
  loading,
  error,
  rows,
  columns,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  periodLabel: string;
  loading: boolean;
  error: string | null;
  rows: DrilldownRow[] | null;
  columns: readonly string[];
}) {
  if (!open) return null;

  // Dashboard Grid Item(react-grid-layout이 transform으로 위치를 잡는 DOM)의 자손으로
  // 렌더링되면 position:fixed의 containing block이 viewport가 아니라 그 Item이 되어
  // Overlay가 Card 크기에 갇힌다. document.body에 직접 Portal로 그려 완전히 독립시킨다.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-navy-100 p-4">
          <h2 className="text-sm font-semibold text-navy-950">{title}</h2>
          <p className="mt-1 text-xs text-navy-950/50">
            {periodLabel} · {loading ? "조회 중..." : `${rows?.length ?? 0}건`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-navy-950/40">불러오는 중...</p>}
          {!loading && error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && rows && rows.length === 0 && (
            <p className="text-sm text-navy-950/40">해당 기간에 조회할 이력이 없습니다.</p>
          )}
          {!loading && !error && rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] table-fixed text-left text-sm">
                <colgroup>
                  {columns.map((column) => (
                    <col key={column} style={{ width: COLUMN_WIDTHS[column] }} />
                  ))}
                </colgroup>
                <thead className="text-xs text-navy-950/50">
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column}
                        className="border-b border-navy-100 px-3 py-2 font-medium"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-b border-navy-100/60">
                      {columns.map((column) => (
                        <td
                          key={column}
                          className={
                            column === "판정 사유"
                              ? "whitespace-pre-line break-words px-3 py-2 align-top text-navy-950/80"
                              : column === "발생일"
                                ? "whitespace-nowrap px-3 py-2 align-top text-navy-950/80"
                                : "px-3 py-2 text-navy-950/80"
                          }
                        >
                          {row[column]?.trim() ? row[column] : "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-navy-100 p-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-navy-100 px-4 py-1.5 text-sm font-medium transition-colors hover:bg-navy-100/40"
          >
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
