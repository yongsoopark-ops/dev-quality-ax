"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getAvailableChartTypes,
  supportsGrouping,
  type ChartType,
  type FilterCondition,
  type FilterOperator,
  type KpiCalcResult,
  type MetricType,
} from "@/lib/kpiCalculator";
import { KpiResultView } from "@/components/kpi/KpiResultView";
import {
  createKpiAction,
  deleteKpiAction,
  previewKpiAction,
  toggleKpiEnabledAction,
  updateKpiAction,
  type KpiDraftConfig,
} from "./actions";

export interface SourceOption {
  id: string;
  name: string;
  headers: string[];
  periodHeaders: string[];
}

export interface KpiListItem {
  id: string;
  name: string;
  sourceId: string;
  sourceName: string;
  metricType: MetricType;
  chartType: ChartType;
  groupByHeader: string | null;
  sumHeader: string | null;
  dateHeader: string | null;
  conditions: FilterCondition[];
  denominatorConditions: FilterCondition[];
  enabled: boolean;
  resultValue: number | null;
  resultData: { label: string; value: number }[] | null;
  resultCalculatedAt: string | null;
}

// UI에 노출되는 이름일 뿐, DB에는 항상 기존 enum 값(COUNT_ALL/COUNT/RATIO/SUM 등)이 저장된다.
const METRIC_LABEL: Record<MetricType, string> = {
  COUNT_ALL: "전체 건수",
  COUNT: "조건 건수",
  RATIO: "비율",
  SUM: "합계",
};

const METRIC_OPTIONS: { value: MetricType; helper: string }[] = [
  { value: "COUNT_ALL", helper: "선택한 데이터의 모든 행을 셉니다." },
  { value: "COUNT", helper: "조건에 맞는 행만 셉니다." },
  { value: "RATIO", helper: "조건 건수 ÷ 기준 건수" },
  { value: "SUM", helper: "선택한 숫자 Header 값을 더합니다." },
];

const CHART_LABEL: Record<ChartType, string> = {
  NUMBER_CARD: "숫자 카드",
  DONUT: "도넛",
  PIE: "파이",
  BAR: "막대",
  HORIZONTAL_BAR: "가로 막대",
  LINE: "꺾은선",
  AREA: "영역",
  PROGRESS: "진행률",
};

const OPERATOR_LABEL: Record<FilterOperator, string> = {
  equals: "같음",
  not_equals: "같지 않음",
  contains: "포함",
  is_empty: "비어 있음",
  is_not_empty: "값 있음",
};

const OPERATORS: FilterOperator[] = ["equals", "not_equals", "contains", "is_empty", "is_not_empty"];

// 신규 KPI의 합리적인 기본값 — 불필요한 입력을 최소화한다.
function emptyDraft(sourceId: string): KpiDraftConfig {
  return {
    name: "",
    sourceId,
    metricType: "COUNT_ALL",
    conditions: [],
    denominatorConditions: [],
    groupByHeader: "",
    sumHeader: "",
    dateHeader: "",
    chartType: "NUMBER_CARD",
    enabled: true,
  };
}

function validateDraft(draft: KpiDraftConfig): string | null {
  if (!draft.name.trim()) return "KPI 이름을 입력해주세요.";
  if (draft.metricType === "COUNT" && draft.conditions.length === 0) {
    return "조건을 최소 1개 이상 추가해주세요.";
  }
  if (draft.metricType === "RATIO" && draft.conditions.length === 0) {
    return "분자 조건을 최소 1개 이상 추가해주세요.";
  }
  if (draft.metricType === "SUM" && !draft.sumHeader) {
    return "합산 대상 Header를 선택해주세요.";
  }
  return null;
}

function SectionHeader({ step, title, subtitle }: { step: number; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
        {step}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-navy-950">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-navy-950/50">{subtitle}</p>}
      </div>
    </div>
  );
}

function FilterRows({
  headers,
  conditions,
  onChange,
}: {
  headers: string[];
  conditions: FilterCondition[];
  onChange: (next: FilterCondition[]) => void;
}) {
  const update = (index: number, patch: Partial<FilterCondition>) => {
    const next = conditions.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const remove = (index: number) => onChange(conditions.filter((_, i) => i !== index));
  const add = () => onChange([...conditions, { header: headers[0] ?? "", operator: "equals", value: "" }]);

  return (
    <div className="space-y-1.5">
      {conditions.map((condition, index) => (
        <div key={index} className="flex flex-wrap items-center gap-1.5">
          {index > 0 && <span className="text-[11px] font-medium text-navy-950/40">AND</span>}
          <select
            value={condition.header}
            onChange={(e) => update(index, { header: e.target.value })}
            className="rounded-md border border-navy-100 px-2 py-1 text-xs"
          >
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <select
            value={condition.operator}
            onChange={(e) => update(index, { operator: e.target.value as FilterOperator })}
            className="rounded-md border border-navy-100 px-2 py-1 text-xs"
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABEL[op]}
              </option>
            ))}
          </select>
          {condition.operator !== "is_empty" && condition.operator !== "is_not_empty" && (
            <input
              type="text"
              value={condition.value ?? ""}
              onChange={(e) => update(index, { value: e.target.value })}
              placeholder="값 입력"
              className="w-32 rounded-md border border-navy-100 px-2 py-1 text-xs"
            />
          )}
          <button type="button" onClick={() => remove(index)} className="text-xs text-red-600">
            삭제
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={headers.length === 0}
        className="rounded-md border border-dashed border-navy-100 px-2 py-1 text-xs text-navy-950/60 transition-colors hover:bg-navy-100/40 disabled:opacity-40"
      >
        + 조건 추가
      </button>
    </div>
  );
}

function MetricTypeSelector({
  value,
  onChange,
}: {
  value: MetricType;
  onChange: (next: MetricType) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METRIC_OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={
                active
                  ? "rounded-lg border border-navy-900 bg-navy-900 px-3 py-2 text-sm font-medium text-white"
                  : "rounded-lg border border-navy-100 px-3 py-2 text-sm font-medium text-navy-950/70 transition-colors hover:bg-navy-100/40"
              }
            >
              {METRIC_LABEL[opt.value]}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-navy-950/50">
        {METRIC_OPTIONS.find((o) => o.value === value)?.helper}
      </p>
    </div>
  );
}

function ChartTypeSelector({
  value,
  options,
  onChange,
}: {
  value: ChartType;
  options: ChartType[];
  onChange: (next: ChartType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((c) => {
        const active = c === value;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={
              active
                ? "rounded-lg border border-navy-900 bg-navy-900 px-3 py-2 text-xs font-medium text-white"
                : "rounded-lg border border-navy-100 px-3 py-2 text-xs font-medium text-navy-950/70 transition-colors hover:bg-navy-100/40"
            }
          >
            {CHART_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

export default function KpiManager({
  sources,
  kpis,
}: {
  sources: SourceOption[];
  kpis: KpiListItem[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLDivElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<KpiDraftConfig>(emptyDraft(sources[0]?.id ?? ""));
  const [preview, setPreview] = useState<KpiCalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSource = sources.find((s) => s.id === draft.sourceId) ?? null;
  const headers = selectedSource?.headers ?? [];
  const isPeriodHeader = draft.groupByHeader
    ? (selectedSource?.periodHeaders ?? []).includes(draft.groupByHeader)
    : false;
  const availableCharts = getAvailableChartTypes(
    draft.metricType,
    Boolean(draft.groupByHeader),
    isPeriodHeader,
  );
  // RATIO는 Group By 자체를 지원하지 않는다(getAvailableChartTypes 기준 동일 정책).
  const showGroupBy = supportsGrouping(draft.metricType);
  // "조건 설정"을 선택했는지는 별도 상태 없이 실제 저장될 값(denominatorConditions)에서
  // 그대로 파생시킨다 — 화면에 보이는 라디오 상태와 실제 저장값이 어긋날 수 없다.
  const denominatorMode: "all" | "custom" = draft.denominatorConditions.length > 0 ? "custom" : "all";

  function recomputeChartType(next: KpiDraftConfig): ChartType {
    const nextAvailable = getAvailableChartTypes(
      next.metricType,
      Boolean(next.groupByHeader),
      next.groupByHeader
        ? (sources.find((s) => s.id === next.sourceId)?.periodHeaders ?? []).includes(next.groupByHeader)
        : false,
    );
    return nextAvailable.includes(next.chartType) ? next.chartType : "NUMBER_CARD";
  }

  function patchDraft(patch: Partial<KpiDraftConfig>) {
    const next = { ...draft, ...patch };
    next.chartType = recomputeChartType(next);
    setDraft(next);
    setPreview(null);
    setError(null);
  }

  function handleMetricTypeChange(metricType: MetricType) {
    // 이전 Metric Type에서만 의미 있던 값은 화면에서도 바로 정리한다(저장 시에는
    // 기존 create/updateKpiAction이 어차피 metricType에 안 맞으면 null로 저장하지만,
    // 화면에 숨겨진 값이 남아 있으면 다시 전환했을 때 혼란스럽다).
    const patch: Partial<KpiDraftConfig> = { metricType };
    if (metricType !== "RATIO") patch.denominatorConditions = [];
    if (metricType !== "SUM") patch.sumHeader = "";
    if (!supportsGrouping(metricType)) patch.groupByHeader = "";
    patchDraft(patch);
  }

  function handleSourceChange(sourceId: string) {
    // 새 Source에는 기존 Header가 존재하지 않을 수 있으므로, Header를 참조하는
    // 값은 모두 초기화한다 — 잘못된 Header를 그대로 저장하지 않기 위함이다.
    patchDraft({
      sourceId,
      groupByHeader: "",
      sumHeader: "",
      dateHeader: "",
      conditions: [],
      denominatorConditions: [],
    });
  }

  function setDenominatorMode(mode: "all" | "custom") {
    if (mode === "all") {
      patchDraft({ denominatorConditions: [] });
    } else if (draft.denominatorConditions.length === 0) {
      patchDraft({ denominatorConditions: [{ header: headers[0] ?? "", operator: "equals", value: "" }] });
    }
  }

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft(sources[0]?.id ?? ""));
    setPreview(null);
    setError(null);
  }

  function startEdit(kpi: KpiListItem) {
    setEditingId(kpi.id);
    setDraft({
      name: kpi.name,
      sourceId: kpi.sourceId,
      metricType: kpi.metricType,
      conditions: kpi.conditions,
      denominatorConditions: kpi.denominatorConditions,
      groupByHeader: kpi.groupByHeader ?? "",
      sumHeader: kpi.sumHeader ?? "",
      dateHeader: kpi.dateHeader ?? "",
      chartType: kpi.chartType,
      enabled: kpi.enabled,
    });
    setPreview(null);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handlePreview() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      setPreview(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await previewKpiAction(draft);
      if (res.error) {
        setError(res.error);
        setPreview(null);
      } else {
        setPreview(res.result ?? null);
      }
    });
  }

  function handleSave() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = editingId
        ? await updateKpiAction(editingId, draft)
        : await createKpiAction(draft);
      if (res.error) {
        setError(res.error);
        return;
      }
      startCreate();
      router.refresh();
    });
  }

  return (
    <div className="mt-6 space-y-10">
      <div
        ref={formRef}
        className="mx-auto max-w-[1000px] rounded-xl border border-navy-100 p-6 scroll-mt-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy-950">
            {editingId ? `KPI 수정 — ${draft.name || "이름 없음"}` : "KPI 추가"}
          </h2>
          {editingId && (
            <button type="button" onClick={startCreate} className="text-xs text-navy-950/50 underline">
              취소하고 새로 추가
            </button>
          )}
        </div>

        {sources.length === 0 ? (
          <p className="mt-3 text-sm text-navy-950/50">
            CONNECTED 상태의 데이터 소스가 없습니다. 먼저 데이터 소스를 등록하고 동기화해 주세요.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {/* STEP 1 — 기본 정보 */}
            <section className="space-y-3">
              <SectionHeader step={1} title="기본 정보" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-navy-950/60">KPI 이름</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => patchDraft({ name: e.target.value })}
                    placeholder="예: Critical 이슈 검출 건수"
                    className="rounded-md border border-navy-100 px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-navy-950/60">데이터 소스</label>
                  <select
                    value={draft.sourceId}
                    onChange={(e) => handleSourceChange(e.target.value)}
                    className="rounded-md border border-navy-100 px-3 py-1.5 text-sm"
                  >
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <hr className="border-navy-100" />

            {/* STEP 2 — 계산 방식 */}
            <section className="space-y-3">
              <SectionHeader step={2} title="계산 방식" subtitle="무엇을 계산할까요?" />

              <MetricTypeSelector value={draft.metricType} onChange={handleMetricTypeChange} />

              {draft.metricType === "SUM" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-navy-950/60">합산 대상 Header (숫자형)</label>
                  <select
                    value={draft.sumHeader}
                    onChange={(e) => patchDraft({ sumHeader: e.target.value })}
                    className="w-56 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
                  >
                    <option value="">선택</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(draft.metricType === "COUNT" || draft.metricType === "SUM") && (
                <div>
                  <p className="text-xs text-navy-950/60">조건</p>
                  <div className="mt-1.5">
                    <FilterRows
                      headers={headers}
                      conditions={draft.conditions}
                      onChange={(conditions) => patchDraft({ conditions })}
                    />
                  </div>
                </div>
              )}

              {draft.metricType === "RATIO" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-navy-950/60">분자 조건</p>
                    <div className="mt-1.5">
                      <FilterRows
                        headers={headers}
                        conditions={draft.conditions}
                        onChange={(conditions) => patchDraft({ conditions })}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-navy-950/60">분모 기준</p>
                    <div className="mt-1.5 space-y-2">
                      <div className="flex flex-col gap-1.5 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={denominatorMode === "all"}
                            onChange={() => setDenominatorMode("all")}
                            className="h-3.5 w-3.5"
                          />
                          전체 데이터
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={denominatorMode === "custom"}
                            onChange={() => setDenominatorMode("custom")}
                            className="h-3.5 w-3.5"
                          />
                          조건 설정
                        </label>
                      </div>
                      {denominatorMode === "custom" && (
                        <FilterRows
                          headers={headers}
                          conditions={draft.denominatorConditions}
                          onChange={(denominatorConditions) => patchDraft({ denominatorConditions })}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <hr className="border-navy-100" />

            {/* STEP 3 — 기간 / 분류 */}
            <section className="space-y-4">
              <SectionHeader step={3} title="기간 / 분류" />

              <div className="flex flex-col gap-1">
                <label className="text-xs text-navy-950/60">기간별 조회 기준</label>
                <select
                  value={draft.dateHeader}
                  onChange={(e) => patchDraft({ dateHeader: e.target.value })}
                  className="w-56 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
                >
                  <option value="">전체 누적 (기간 선택 안 함)</option>
                  {(selectedSource?.periodHeaders ?? []).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-navy-950/40">
                  선택하면 Home에서 월/기간을 바꿀 때 이 날짜 Header를 기준으로 KPI가 다시
                  계산됩니다. 선택하지 않으면 항상 전체 누적 KPI로 표시됩니다.
                </p>
              </div>

              {showGroupBy && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-navy-950/60">분류해서 보기</label>
                  <select
                    value={draft.groupByHeader}
                    onChange={(e) => patchDraft({ groupByHeader: e.target.value })}
                    className="w-56 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
                  >
                    <option value="">없음</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                        {(selectedSource?.periodHeaders ?? []).includes(h) ? " (기간)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-navy-950/40">
                    선택하면 Header 값별로 나눠 그래프로 표시할 수 있습니다.
                  </p>
                </div>
              )}
            </section>

            <hr className="border-navy-100" />

            {/* STEP 4 — 표시 방식 */}
            <section className="space-y-3">
              <SectionHeader step={4} title="표시 방식" />

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-navy-950/60">그래프 형태</label>
                <ChartTypeSelector
                  value={draft.chartType}
                  options={availableCharts}
                  onChange={(chartType) => patchDraft({ chartType })}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-navy-950">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => patchDraft({ enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-navy-100"
                />
                Home에 표시
              </label>
            </section>

            <hr className="border-navy-100" />

            {/* STEP 5 — 미리보기 / 저장 */}
            <section className="space-y-3">
              <SectionHeader step={5} title="결과 확인" />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={isPending}
                  className="rounded-md border border-navy-100 px-4 py-1.5 text-sm font-medium transition-colors hover:bg-navy-100/40 disabled:opacity-50"
                >
                  미리보기
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {editingId ? "KPI 수정 저장" : "KPI 저장"}
                </button>
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}

              {preview && (
                <div className="rounded-lg border border-navy-100 bg-navy-100/20 p-4">
                  <p className="mb-2 text-xs text-navy-950/50">KPI 미리보기</p>
                  <KpiResultView
                    chartType={draft.chartType}
                    metricType={draft.metricType}
                    value={preview.value}
                    resultData={preview.resultData}
                  />
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-navy-950">등록된 KPI</h2>
        {kpis.length === 0 && <p className="text-sm text-navy-950/50">등록된 KPI가 없습니다.</p>}
        {kpis.map((kpi) => (
          <div key={kpi.id} className="rounded-xl border border-navy-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-navy-950">{kpi.name}</h3>
                  <span className="rounded-full bg-navy-100/60 px-2 py-0.5 text-[11px] text-navy-950/60">
                    {METRIC_LABEL[kpi.metricType]}
                  </span>
                  <span className="rounded-full bg-navy-100/60 px-2 py-0.5 text-[11px] text-navy-950/60">
                    {CHART_LABEL[kpi.chartType]}
                  </span>
                  {kpi.dateHeader && (
                    <span className="rounded-full bg-navy-100/60 px-2 py-0.5 text-[11px] text-navy-950/60">
                      기간: {kpi.dateHeader}
                    </span>
                  )}
                  {kpi.groupByHeader && (
                    <span className="rounded-full bg-navy-100/60 px-2 py-0.5 text-[11px] text-navy-950/60">
                      Group By: {kpi.groupByHeader}
                    </span>
                  )}
                  {!kpi.enabled && (
                    <span className="rounded-full bg-navy-950/10 px-2 py-0.5 text-[11px] text-navy-950/50">
                      비활성
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-navy-950/50">
                  소스: {kpi.sourceName}
                  {kpi.resultCalculatedAt
                    ? ` · 마지막 계산: ${kpi.resultCalculatedAt}`
                    : " · 아직 계산되지 않음"}
                </p>
                <div className="mt-2">
                  <KpiResultView
                    chartType={kpi.chartType}
                    metricType={kpi.metricType}
                    value={kpi.resultValue}
                    resultData={kpi.resultData}
                  />
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(kpi)}
                  className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-navy-100/40"
                >
                  수정
                </button>
                <form action={toggleKpiEnabledAction}>
                  <input type="hidden" name="id" value={kpi.id} />
                  <input type="hidden" name="enabled" value={(!kpi.enabled).toString()} />
                  <button
                    type="submit"
                    className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-navy-100/40"
                  >
                    {kpi.enabled ? "비활성화" : "활성화"}
                  </button>
                </form>
                <form action={deleteKpiAction}>
                  <input type="hidden" name="id" value={kpi.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                  >
                    삭제
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
