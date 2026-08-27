"use client";

import { KpiResultView } from "@/components/kpi/KpiResultView";
import { useContainerSize } from "@/hooks/useContainerSize";
import { getResponsiveChartMetrics } from "@/lib/chart/widgetScale";
import type { ChartType, MetricType } from "@/lib/kpiCalculator";
import type { KpiComparison } from "@/lib/kpiComparison";

interface ResultDatum {
  label: string;
  value: number;
}

export function KpiCard({
  name,
  metricType,
  chartType,
  value,
  resultData,
  footerText,
  comparison,
  editMode = false,
  onOpenDrilldown,
}: {
  name: string;
  metricType: MetricType;
  chartType: ChartType;
  value: number | null;
  resultData: ResultDatum[] | null;
  /** Home 상단에 이미 기간 Selector가 있으므로, 값이 있을 때만(예: 마지막 계산 시각) 표시한다. */
  footerText?: string;
  /** dateHeader가 있고 Group By가 없는 숫자 KPI에서만 전달된다. 그 외에는 null. */
  comparison?: KpiComparison | null;
  /** Dashboard 편집 모드일 때는 Drag와의 클릭 충돌을 막기 위해 Drill-down을 비활성화한다. */
  editMode?: boolean;
  /**
   * Drill-down 열기 요청. 실제 fetch/Modal 상태/렌더링은 이 Card가 아니라
   * Dashboard 전체에서 단 하나만 존재하는 상위 컴포넌트가 담당한다
   * (Grid Item마다 Modal을 중복 생성하면 react-grid-layout의 transform으로 인해
   * position:fixed Overlay가 Card 크기에 갇히는 문제가 생긴다).
   */
  onOpenDrilldown?: (groupValue?: string) => void;
}) {
  const isGrouped =
    chartType !== "NUMBER_CARD" &&
    chartType !== "PROGRESS" &&
    Boolean(resultData) &&
    (resultData?.length ?? 0) > 0;
  const clickable = !isGrouped && !editMode;

  // Card 본문(제목/여백을 뺀 실제 시각화 영역)의 실측 크기로 숫자/그래프 크기를 계산한다.
  // Resize Handle을 드래그하는 동안에도 ResizeObserver가 실시간으로 갱신한다.
  const [bodyRef, size] = useContainerSize<HTMLDivElement>();
  const metrics = getResponsiveChartMetrics(size.width, size.height);

  return (
    <div
      onClick={clickable ? () => onOpenDrilldown?.() : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={{ padding: metrics.cardPadding }}
      className={`flex h-full flex-col overflow-hidden rounded-xl border ${
        editMode
          ? "cursor-move border-dashed border-navy-700/40 bg-navy-100/10"
          : "border-navy-100"
      } ${clickable ? "cursor-pointer transition-colors hover:bg-navy-100/20" : ""}`}
    >
      <p
        className="shrink-0 font-medium text-navy-950/70"
        style={{ fontSize: metrics.titleFontSize }}
      >
        {name}
      </p>
      <div ref={bodyRef} className="mt-3 min-h-0 flex-1">
        <KpiResultView
          chartType={chartType}
          metricType={metricType}
          value={value}
          resultData={resultData}
          comparison={!isGrouped ? comparison : null}
          metrics={metrics}
          onSegmentClick={isGrouped && !editMode ? (label) => onOpenDrilldown?.(label) : undefined}
        />
      </div>
      {footerText && <p className="mt-3 shrink-0 text-[11px] text-navy-950/40">{footerText}</p>}
    </div>
  );
}
