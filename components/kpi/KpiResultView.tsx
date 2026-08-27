import type { ChartType, MetricType } from "@/lib/kpiCalculator";
import type { ComparisonDirection, KpiComparison } from "@/lib/kpiComparison";
import { getChartColorMap } from "@/lib/chart/chartColors";
import { getResponsiveChartMetrics, type ResponsiveChartMetrics } from "@/lib/chart/widgetScale";

interface ResultDatum {
  label: string;
  value: number;
}

type SegmentClickHandler = (label: string) => void;

/** Container 크기를 측정하지 않는 곳(KPI Builder 미리보기 등)은 이 기본값으로 렌더링된다. */
const FALLBACK_METRICS = getResponsiveChartMetrics(0, 0);

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value);
}

/** RATIO는 항상 소수점 1자리로 고정 표시한다. 계산/저장값은 그대로 두고 표시만 반올림한다. */
function formatRatio(value: number) {
  return value.toFixed(1);
}

function segmentClass(clickable: boolean, base: string) {
  return clickable ? `${base} cursor-pointer` : base;
}

// 증가/감소는 "좋다/나쁘다"를 의미하지 않는 순수 방향 표시다(녹색=좋음/빨강=나쁨 금지).
// 증가: Navy, 감소: Orange(Slate 계열), 동일/신규: Gray.
const COMPARISON_ARROW: Record<ComparisonDirection, string> = {
  UP: "▲",
  DOWN: "▼",
  SAME: "—",
  NEW: "▲",
};

const COMPARISON_COLOR: Record<ComparisonDirection, string> = {
  UP: "text-navy-700",
  DOWN: "text-orange-600",
  SAME: "text-navy-950/40",
  NEW: "text-navy-700",
};

function ComparisonIndicator({
  comparison,
  fontSize,
}: {
  comparison: KpiComparison;
  fontSize: number;
}) {
  return (
    <p className="flex items-center gap-1" style={{ fontSize }}>
      <span className={COMPARISON_COLOR[comparison.direction]}>
        {COMPARISON_ARROW[comparison.direction]} {comparison.displayValue}
      </span>
      <span className="text-navy-950/40">{comparison.comparisonLabel}</span>
    </p>
  );
}

function HorizontalBarChart({
  data,
  metrics,
  onSegmentClick,
}: {
  data: ResultDatum[];
  metrics: ResponsiveChartMetrics;
  onSegmentClick?: SegmentClickHandler;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const colorMap = getChartColorMap(data.map((d) => d.label));
  return (
    <div
      className="flex h-full w-full flex-col justify-center"
      style={{ gap: metrics.barGap, fontSize: metrics.categoryFontSize }}
    >
      {data.map((d) => (
        <div
          key={d.label}
          onClick={onSegmentClick ? () => onSegmentClick(d.label) : undefined}
          className={segmentClass(
            Boolean(onSegmentClick),
            "flex items-center gap-2 rounded transition-colors hover:bg-navy-100/30",
          )}
        >
          <span className="w-20 shrink-0 truncate text-navy-950/60">{d.label}</span>
          <div
            className="flex-1 rounded bg-navy-100/50"
            style={{ height: metrics.barThickness }}
          >
            <div
              className="h-full rounded"
              style={{
                width: `${(d.value / max) * 100}%`,
                background: colorMap.get(d.label),
              }}
            />
          </div>
          <span
            className="w-10 shrink-0 text-right text-navy-950/70"
            style={{ fontSize: metrics.dataLabelFontSize }}
          >
            {formatNumber(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BarChart({
  data,
  metrics,
  onSegmentClick,
}: {
  data: ResultDatum[];
  metrics: ResponsiveChartMetrics;
  onSegmentClick?: SegmentClickHandler;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const colorMap = getChartColorMap(data.map((d) => d.label));
  return (
    <div
      className="flex h-full min-h-32 w-full items-end"
      style={{ gap: metrics.barGap }}
    >
      {data.map((d) => (
        <div
          key={d.label}
          onClick={onSegmentClick ? () => onSegmentClick(d.label) : undefined}
          className={segmentClass(
            Boolean(onSegmentClick),
            "flex h-full flex-1 flex-col items-center justify-end gap-1 rounded hover:bg-navy-100/30",
          )}
        >
          <span className="text-navy-950/70" style={{ fontSize: metrics.dataLabelFontSize }}>
            {formatNumber(d.value)}
          </span>
          <div
            className="w-full rounded-t"
            style={{
              height: `${Math.max((d.value / max) * 100, 2)}%`,
              background: colorMap.get(d.label),
            }}
          />
          <span
            className="w-full truncate text-center text-navy-950/50"
            style={{ fontSize: metrics.categoryFontSize }}
          >
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function RingChart({
  data,
  hollow,
  metrics,
  onSegmentClick,
}: {
  data: ResultDatum[];
  hollow: boolean;
  metrics: ResponsiveChartMetrics;
  onSegmentClick?: SegmentClickHandler;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const radius = 40;
  const strokeWidth = hollow ? 14 : radius;
  const drawRadius = hollow ? radius : radius / 2;
  const circumference = 2 * Math.PI * drawRadius;

  const segments = data.reduce<{ dash: number; offset: number }[]>((acc, d) => {
    const dash = (d.value / total) * circumference;
    const previousEnd = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    acc.push({ dash, offset: previousEnd });
    return acc;
  }, []);
  const colorMap = getChartColorMap(data.map((d) => d.label));

  return (
    <div className="flex h-full w-full flex-wrap items-center justify-center gap-3">
      {/*
        지름은 metrics.donutDiameter(Container의 짧은 축 기준, 요청사항 R6)로 직접
        지정한다. viewBox의 preserveAspectRatio="meet"가 100x100 내용을 그 상자 안에
        항상 온전히(잘리지 않게) 그려주므로, 회전 대신 (항상 정사각형인) viewBox
        좌표계 안의 <g>에서 회전시켜 상자 비율과 무관하게 안전하다.
      */}
      <div
        className="shrink-0"
        style={{ width: metrics.donutDiameter, height: metrics.donutDiameter }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
          <g transform="rotate(-90 50 50)">
            {data.map((d, i) => (
              <circle
                key={d.label}
                cx="50"
                cy="50"
                r={drawRadius}
                fill="none"
                stroke={colorMap.get(d.label)}
                strokeWidth={strokeWidth}
                strokeDasharray={`${segments[i].dash} ${circumference - segments[i].dash}`}
                strokeDashoffset={-segments[i].offset}
                onClick={onSegmentClick ? () => onSegmentClick(d.label) : undefined}
                className={onSegmentClick ? "cursor-pointer" : undefined}
              />
            ))}
          </g>
        </svg>
      </div>
      <div
        className="min-w-16 max-w-full"
        style={{ fontSize: metrics.legendFontSize, display: "flex", flexDirection: "column", gap: metrics.legendGap }}
      >
        {data.map((d) => (
          <div
            key={d.label}
            onClick={onSegmentClick ? () => onSegmentClick(d.label) : undefined}
            className={segmentClass(Boolean(onSegmentClick), "flex items-center gap-1.5 rounded")}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: colorMap.get(d.label) }}
            />
            <span className="truncate text-navy-950/60">{d.label}</span>
            <span className="text-navy-950/80">{formatNumber(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function computeLinePoints(data: ResultDatum[], width: number, height: number) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  return data.map((d, i) => ({
    x: data.length > 1 ? i * stepX : width / 2,
    y: height - (d.value / max) * height,
  }));
}

function LineChart({
  data,
  filled,
  metrics,
  onSegmentClick,
}: {
  data: ResultDatum[];
  filled: boolean;
  metrics: ResponsiveChartMetrics;
  onSegmentClick?: SegmentClickHandler;
}) {
  const width = 240;
  const height = 72;
  const points = computeLinePoints(data, width, height);
  const polygonPoints = [
    { x: points[0]?.x ?? 0, y: height },
    ...points,
    { x: points[points.length - 1]?.x ?? width, y: height },
  ];
  const strokeWidth = 1.5 + metrics.scale;

  return (
    <div className="flex h-full min-h-20 w-full flex-col">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="min-h-0 w-full flex-1"
      >
        {filled && (
          <polygon
            points={polygonPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#1e3a70"
            fillOpacity="0.12"
            stroke="none"
          />
        )}
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="#1e3a70"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle
            key={data[i].label}
            cx={p.x}
            cy={p.y}
            r={onSegmentClick ? 6 : 2.5}
            fill={onSegmentClick ? "transparent" : "#1e3a70"}
            stroke={onSegmentClick ? "#1e3a70" : undefined}
            strokeWidth={onSegmentClick ? 2 : undefined}
            vectorEffect="non-scaling-stroke"
            onClick={onSegmentClick ? () => onSegmentClick(data[i].label) : undefined}
            className={onSegmentClick ? "cursor-pointer" : undefined}
          />
        ))}
      </svg>
      <div
        className="mt-1 flex shrink-0 justify-between gap-1 text-navy-950/40"
        style={{ fontSize: metrics.categoryFontSize }}
      >
        {data.map((d) => (
          <span key={d.label} className="truncate">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProgressBar({ value, fontSize }: { value: number; fontSize: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="w-full">
      <div className="h-4 w-full overflow-hidden rounded-full bg-navy-100/50">
        <div className="h-4 rounded-full bg-navy-800" style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-2 font-semibold text-navy-950" style={{ fontSize }}>
        {formatRatio(value)}%
      </p>
    </div>
  );
}

export function KpiResultView({
  chartType,
  metricType,
  value,
  resultData,
  comparison,
  metrics,
  onSegmentClick,
}: {
  chartType: ChartType;
  metricType?: MetricType;
  value: number | null;
  resultData: ResultDatum[] | null;
  /** 숫자형(NUMBER_CARD/PROGRESS, Group By 없음) KPI에서만 전달된다. 그 외에는 전달하지 않는다. */
  comparison?: KpiComparison | null;
  /**
   * Widget Container 실측 크기로 계산된 Responsive 수치. Dashboard Grid 밖(KPI Builder
   * 미리보기 등)에서 호출할 때는 생략하면 기존과 동일한 기본 크기로 안전하게 렌더링된다.
   */
  metrics?: ResponsiveChartMetrics;
  /** 그룹형 그래프에서 특정 그룹(막대/조각/점)을 클릭했을 때 호출된다. NUMBER_CARD/PROGRESS에는 적용되지 않는다. */
  onSegmentClick?: SegmentClickHandler;
}) {
  const m = metrics ?? FALLBACK_METRICS;
  let content: React.ReactNode;
  // 숫자/원형 시각화는 Card 중앙에, 축을 따라 확장되는 Chart는 왼쪽 기준으로 정렬한다.
  let alignment: "center" | "left" = "center";

  if (chartType === "PROGRESS") {
    content = (
      <div className="flex w-full flex-col items-center gap-1.5">
        <ProgressBar value={value ?? 0} fontSize={m.mainFontSize * 0.7} />
        {comparison && <ComparisonIndicator comparison={comparison} fontSize={m.comparisonFontSize} />}
      </div>
    );
  } else if (chartType === "NUMBER_CARD" || !resultData || resultData.length === 0) {
    content = (
      <div className="flex flex-col items-center gap-1.5">
        <div className="font-semibold text-navy-950" style={{ fontSize: m.mainFontSize }}>
          {value === null ? "-" : metricType === "RATIO" ? formatRatio(value) : formatNumber(value)}
          {metricType === "RATIO" && value !== null ? "%" : ""}
        </div>
        {comparison && <ComparisonIndicator comparison={comparison} fontSize={m.comparisonFontSize} />}
      </div>
    );
  } else if (chartType === "BAR") {
    content = <BarChart data={resultData} metrics={m} onSegmentClick={onSegmentClick} />;
    alignment = "left";
  } else if (chartType === "HORIZONTAL_BAR") {
    content = <HorizontalBarChart data={resultData} metrics={m} onSegmentClick={onSegmentClick} />;
    alignment = "left";
  } else if (chartType === "DONUT") {
    content = <RingChart data={resultData} hollow metrics={m} onSegmentClick={onSegmentClick} />;
  } else if (chartType === "PIE") {
    content = <RingChart data={resultData} hollow={false} metrics={m} onSegmentClick={onSegmentClick} />;
  } else if (chartType === "LINE") {
    content = <LineChart data={resultData} filled={false} metrics={m} onSegmentClick={onSegmentClick} />;
    alignment = "left";
  } else if (chartType === "AREA") {
    content = <LineChart data={resultData} filled metrics={m} onSegmentClick={onSegmentClick} />;
    alignment = "left";
  } else {
    content = null;
  }

  return (
    <div
      className={
        alignment === "center"
          ? "flex h-full w-full flex-col items-center justify-center text-center"
          : "flex h-full w-full flex-col items-stretch justify-start"
      }
    >
      {content}
    </div>
  );
}
