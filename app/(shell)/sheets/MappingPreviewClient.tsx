"use client";

import { useState, useTransition } from "react";
import { previewW2ToW3Mapping, type MappingPreviewResult } from "@/lib/sheetAutomation/actions";
import type { MappingPreviewRow, MappingStatus, MappingSummary, ProjectSheetInput } from "@/lib/sheetAutomation/types";

const STATUS_LABEL: Record<MappingStatus, string> = {
  READY: "입력 가능",
  EMPTY_SOURCE: "W2 값 없음",
  SOURCE_NOT_FOUND: "W2 Header 없음",
  TARGET_NOT_FOUND: "W3 Header 없음",
  NOT_SUPPORTED: "반복 영역 (Preview 미지원)",
};

function statusClass(status: MappingStatus, required: boolean): string {
  if (status === "READY") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (required) return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function emptyInput(): ProjectSheetInput {
  return { url: "", sheetName: "" };
}

function SheetInputFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ProjectSheetInput;
  onChange: (next: ProjectSheetInput) => void;
}) {
  return (
    <div className="rounded-xl border border-navy-100 p-4">
      <h3 className="text-sm font-semibold text-navy-950">{label}</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60">Google Sheet URL</label>
          <input
            type="url"
            value={value.url}
            onChange={(e) => onChange({ ...value, url: e.target.value })}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-80 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60">Tab 이름</label>
          <input
            type="text"
            value={value.sheetName}
            onChange={(e) => onChange({ ...value, sheetName: e.target.value })}
            placeholder="예: PW2"
            className="w-32 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

function SummaryBar({ summary }: { summary: MappingSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <span className="text-navy-950/70">
        총 Mapping <b className="text-navy-950">{summary.total}</b>
      </span>
      <span className="text-emerald-700">
        입력 가능 <b>{summary.ready}</b>
      </span>
      <span className="text-amber-700">
        확인 필요 <b>{summary.needsReview}</b>
      </span>
      <span className="text-red-600">
        오류 <b>{summary.errors}</b>
      </span>
    </div>
  );
}

function PreviewTable({ rows }: { rows: MappingPreviewRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-navy-950/50">
          <tr>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">상태</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">W2 항목</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">W2 값</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium"></th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">W3 항목</th>
            <th className="border-b border-navy-100 px-2 py-2 font-medium">필수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.mappingId} className="border-b border-navy-100/60 align-top">
              <td className="px-2 py-2">
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(row.status, row.required)}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </td>
              <td className="px-2 py-2 text-navy-950/80">{row.sourceHeader}</td>
              <td className="max-w-[220px] px-2 py-2 text-navy-950/70" title={row.sourceValue ?? undefined}>
                <span className="line-clamp-2">{row.sourceValue || "-"}</span>
              </td>
              <td className="px-2 py-2 text-navy-950/30">→</td>
              <td className="px-2 py-2 text-navy-950/80">{row.targetHeader}</td>
              <td className="px-2 py-2 text-navy-950/50">{row.required ? "필수" : "선택"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-4 text-center text-navy-950/40">
                W2/W3에 동일한 이름의 항목이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function MappingPreviewClient() {
  const [source, setSource] = useState<ProjectSheetInput>(emptyInput());
  const [target, setTarget] = useState<ProjectSheetInput>(emptyInput());
  const [result, setResult] = useState<MappingPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCheckMapping() {
    setError(null);
    if (!source.url.trim()) {
      setError("W2 Sheet URL을 입력해 주세요.");
      return;
    }
    if (!target.url.trim()) {
      setError("W3 Sheet URL을 입력해 주세요.");
      return;
    }
    startTransition(async () => {
      const res = await previewW2ToW3Mapping(source, target);
      if (res.error) {
        setError(res.error);
        setResult(null);
      } else {
        setResult(res.result ?? null);
      }
    });
  }

  return (
    <div className="mt-6 max-w-[1000px] space-y-6">
      <div className="grid gap-4 sm:grid-cols-1">
        <SheetInputFields label="1. 원본 W2 선택 (품질검증설계 승인서)" value={source} onChange={setSource} />
        <SheetInputFields label="2. 대상 W3 선택 (품질 적합성 평가 보고서)" value={target} onChange={setTarget} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleCheckMapping}
          disabled={isPending}
          className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? "확인 중..." : "매핑 확인"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {result && (
        <>
          <div className="space-y-3 rounded-xl border border-navy-100 p-4">
            <h3 className="text-sm font-semibold text-navy-950">기본 정보 Mapping</h3>
            <SummaryBar summary={result.singleSummary} />
            <PreviewTable rows={result.single} />
          </div>

          <div className="space-y-3 rounded-xl border border-navy-100 p-4">
            <h3 className="text-sm font-semibold text-navy-950">검사 항목 Mapping (반복 영역)</h3>
            {!result.repeating ? (
              <p className="text-sm text-navy-950/50">
                W2 또는 W3에서 검사 항목 반복 Table을 찾지 못했습니다.
              </p>
            ) : result.repeating.length === 0 ? (
              <p className="text-sm text-navy-950/50">W2에 등록된 검사 항목이 없습니다.</p>
            ) : (
              <>
                {result.repeatingSummary && <SummaryBar summary={result.repeatingSummary} />}
                <div className="space-y-4">
                  {result.repeating.map((group) => (
                    <div key={group.rowKey} className="rounded-lg border border-navy-100/70 p-3">
                      <p className="mb-2 text-xs font-medium text-navy-950/50">검사 순서 {group.rowKey}</p>
                      <PreviewTable rows={group.cells} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
