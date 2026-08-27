"use client";

import { useState, useTransition } from "react";
import { buildW2ToW3WritePlanAction, executeW2ToW3WriteAction } from "@/lib/sheetAutomation/write/actions";
import type { DetailBlockItem, WriteExecutionResult, WritePlan } from "@/lib/sheetAutomation/write/types";

const ITEM_STATUS_LABEL: Record<DetailBlockItem["status"], string> = {
  MATCHED_NO_CHANGE: "기존 값과 동일 (보호됨)",
  MATCHED_UPDATE: "기존 Block 값 갱신",
  FILL_BLANK_SLOT: "빈 슬롯에 입력",
  NEW_BLOCK: "신규 Block 생성 후 입력",
  NEEDS_REVIEW: "확인 필요 (구조 변경 의심)",
  UNROUTABLE: "Section 매칭 실패",
};

function itemStatusClass(status: DetailBlockItem["status"]): string {
  if (status === "NEW_BLOCK") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "FILL_BLANK_SLOT" || status === "MATCHED_UPDATE") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "MATCHED_NO_CHANGE") return "bg-navy-50 text-navy-950/60 border-navy-100";
  return "bg-red-50 text-red-700 border-red-200";
}

function PlanSummaryBar({ plan }: { plan: WritePlan }) {
  const { summary } = plan;
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <span className="text-navy-950/70">
        W2 검사 항목 <b className="text-navy-950">{summary.totalW2Items}</b>
      </span>
      <span className="text-navy-950/70">
        상단 기본정보 <b className="text-navy-950">{summary.basicInfoFieldCount}</b>개 필드
      </span>
      <span className="text-navy-950/70">
        품질 승인 현황 <b className="text-navy-950">{summary.approvalRowsPlanned}</b>건(추가 <b>{summary.approvalRowsToInsert}</b>)
      </span>
      <span className="text-blue-700">
        상세 Block 추가 <b>{summary.detailBlocksToInsert}</b>
      </span>
      <span className="text-emerald-700">
        상세 Cell 입력 예정 <b>{summary.detailCellsToWrite}</b>
      </span>
      <span className="text-navy-950/50">
        기존 값 보호 <b>{summary.detailValuesProtected}</b>
      </span>
      {summary.warnings > 0 && (
        <span className="text-amber-700">
          경고 <b>{summary.warnings}</b>
        </span>
      )}
    </div>
  );
}

function PlanItemsTable({ items }: { items: DetailBlockItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="text-xs text-navy-950/50">
          <tr>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">검사 순서</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">검사 항목</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">검사 중요도</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">판정 기준</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">Target Section</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.w2RowIndex} className="border-b border-navy-100/60 align-top">
              <td className="px-2 py-2 text-navy-950/80">{item.inspectionOrder}</td>
              <td className="px-2 py-2 text-navy-950/80">{item.inspectionItem}</td>
              <td className="px-2 py-2 text-navy-950/70">{item.importance}</td>
              <td className="max-w-[260px] px-2 py-2 text-navy-950/70">
                <span className="line-clamp-2">{item.criteria || "-"}</span>
              </td>
              <td className="px-2 py-2 text-navy-950/70">{item.targetSection ?? "-"}</td>
              <td className="px-2 py-2">
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${itemStatusClass(item.status)}`}
                >
                  {ITEM_STATUS_LABEL[item.status]}
                </span>
                {item.note && <p className="mt-1 text-[11px] text-red-600">{item.note}</p>}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-4 text-center text-navy-950/40">
                W2에 등록된 검사 항목이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ExecutionResultView({
  result,
  validation,
}: {
  result: WriteExecutionResult;
  validation?: { ok: boolean; issues: string[] };
}) {
  if (result.error) {
    return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{result.error}</p>;
  }
  return (
    <div className="space-y-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
      <p>
        품질 승인 현황 {result.approvalRowsInserted}행 추가, 상세 Block {result.detailBlocksInserted}개 생성, Cell{" "}
        {result.cellsWritten}개 입력을 완료했습니다(보호 {result.valuesProtected}건).
      </p>
      {validation && !validation.ok && (
        <div className="rounded-md bg-amber-50 p-2 text-amber-800">
          <p className="font-medium">실행 후 검증에서 확인이 필요한 항목이 있습니다:</p>
          <ul className="mt-1 list-disc pl-4">
            {validation.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {validation?.ok && <p className="text-emerald-700">실행 후 검증 완료 — 계획한 내용을 W3에서 다시 확인했습니다.</p>}
    </div>
  );
}

export function WritePlanClient() {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [plan, setPlan] = useState<WritePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [confirming, setConfirming] = useState(false);
  const [isExecuting, startExecuting] = useTransition();
  const [execResult, setExecResult] = useState<WriteExecutionResult | null>(null);
  const [execValidation, setExecValidation] = useState<{ ok: boolean; issues: string[] } | null>(null);

  function handleBuildPlan() {
    setError(null);
    setExecResult(null);
    setExecValidation(null);
    setConfirming(false);
    if (!spreadsheetUrl.trim()) {
      setError("Google Spreadsheet URL을 입력해 주세요.");
      return;
    }
    startTransition(async () => {
      const res = await buildW2ToW3WritePlanAction(spreadsheetUrl);
      if (res.error) {
        setError(res.error);
        setPlan(null);
      } else {
        setPlan(res.plan ?? null);
      }
    });
  }

  function handleExecute() {
    setConfirming(false);
    startExecuting(async () => {
      const res = await executeW2ToW3WriteAction(spreadsheetUrl);
      if (res.error && !res.result) {
        setError(res.error);
        return;
      }
      setExecResult(res.result ?? null);
      setExecValidation(res.validation ?? null);
      // 실행 후에는 화면에 남아 있는 Plan이 더 이상 실제 W3 상태와 일치하지 않으므로
      // 다시 "계획 확인"을 눌러야 최신 상태를 볼 수 있다 — 자동으로 재조회하지 않는다.
      setPlan(null);
    });
  }

  return (
    <div className="mt-6 max-w-[1000px] space-y-6">
      <div className="rounded-xl border border-navy-100 p-4">
        <h3 className="text-sm font-semibold text-navy-950">W2/W3 Spreadsheet (PW2/PW3 Tab 자동 인식)</h3>
        <div className="mt-3 flex flex-col gap-1">
          <label className="text-xs text-navy-950/60">Google Sheet URL</label>
          <input
            type="url"
            value={spreadsheetUrl}
            onChange={(e) => setSpreadsheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-96 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleBuildPlan}
          disabled={isPending}
          className="rounded-md border border-navy-900 px-4 py-1.5 text-sm font-medium text-navy-900 disabled:opacity-50"
        >
          {isPending ? "계획 계산 중..." : "Write 계획 확인"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {plan && (
        <div className="space-y-4 rounded-xl border border-navy-100 p-4">
          <h3 className="text-sm font-semibold text-navy-950">Write Plan</h3>
          <PlanSummaryBar plan={plan} />

          {plan.warnings.length > 0 && (
            <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              <ul className="list-disc pl-4">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <PlanItemsTable items={plan.detailItems} />

          <div className="flex items-center gap-2 border-t border-navy-100 pt-4">
            {plan.alreadyUpToDate ? (
              <p className="text-sm text-navy-950/50">이미 최신 상태입니다 — 추가로 실행할 작업이 없습니다.</p>
            ) : plan.status === "NEEDS_REVIEW" ? (
              <p className="text-sm text-amber-700">확인이 필요한 항목이 있어 실행할 수 없습니다. 위 경고를 확인해 주세요.</p>
            ) : confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-navy-950/80">
                  품질 승인 현황 {plan.summary.approvalRowsToInsert}행, 상세 Block {plan.summary.detailBlocksToInsert}개를
                  추가하고 값을 입력합니다. 되돌리기 어려운 작업입니다. 진행할까요?
                </span>
                <button
                  type="button"
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isExecuting ? "실행 중..." : "예, 실행합니다"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white"
              >
                실행
              </button>
            )}
          </div>
        </div>
      )}

      {execResult && <ExecutionResultView result={execResult} validation={execValidation ?? undefined} />}
    </div>
  );
}
