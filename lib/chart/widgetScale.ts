/**
 * KPI Widget Container 크기(px)로부터 내부 시각화(숫자/그래프/라벨) 크기를 계산하는
 * 단일 창구. Chart Component마다 서로 다른 임의 계산식을 쓰지 않도록 이 함수 하나로
 * 모든 Responsive 수치를 만든다.
 *
 * 기준: 현재 Default Widget 크기를 scale=1.0으로 두고, Widget 면적이 아니라
 * "면적의 제곱근"(가로/세로 평균 배율에 가깝다)으로 scale을 구한다 — 면적이 4배가
 * 됐다고 글자도 4배가 되는 것을 막기 위함이다(요청사항 R14).
 *
 * 우선순위(R12): Main KPI Value > Chart Data Value > Category/Axis > Auxiliary Text
 * 순으로, 값이 클수록 Scale에 더 민감하게 반응하고, 덜 중요한 텍스트일수록
 * 변동 폭을 좁게 가져간다(Title은 R5에 따라 거의 고정).
 */

export interface ResponsiveChartMetrics {
  /** 0.75 ~ 1.6 사이로 clamp된 배율. 1.0 = 현재 Default Widget 크기 기준. */
  scale: number;
  /** NUMBER_CARD/RATIO 등 숫자형 KPI의 Main Value 글자 크기(px). */
  mainFontSize: number;
  /** 비교 Indicator(▲/▼ ...) 글자 크기(px). Main Value에 비례하되 항상 그보다 작다. */
  comparisonFontSize: number;
  /** KPI 제목 글자 크기(px). Dashboard 전체 일관성을 위해 변동 폭을 아주 좁게 둔다. */
  titleFontSize: number;
  /** Bar/Line 등 Chart 위에 찍히는 값 Label 글자 크기(px). */
  dataLabelFontSize: number;
  /** Category/Axis Label 글자 크기(px). */
  categoryFontSize: number;
  /** Donut/Pie Legend 글자 크기(px). */
  legendFontSize: number;
  /** Donut/Pie Legend 항목 사이 세로 간격(px). */
  legendGap: number;
  /** Donut/Pie 지름(px). 짧은 축(min(width,height)) 기준으로 계산된다. */
  donutDiameter: number;
  /** Bar 그래프의 막대(또는 Horizontal Bar의 행) 사이 간격(px). */
  barGap: number;
  /** Horizontal Bar의 막대(행) 두께(px). */
  barThickness: number;
  /** Card 자체의 안쪽 여백(px). */
  cardPadding: number;
}

/** Container 크기를 아직 측정하지 못했을 때(KPI Builder 미리보기 등) 쓰는 기존 기본값. */
const DEFAULT_METRICS: ResponsiveChartMetrics = {
  scale: 1,
  mainFontSize: 30,
  comparisonFontSize: 12,
  titleFontSize: 13,
  dataLabelFontSize: 11,
  categoryFontSize: 10,
  legendFontSize: 11,
  legendGap: 4,
  donutDiameter: 120,
  barGap: 8,
  barThickness: 12,
  cardPadding: 16,
};

// scale=1.0의 기준이 되는 Default Widget 크기(대략 NUMBER_CARD 3x2 Grid의 실제 본문 영역 px).
const BASE_WIDTH = 260;
const BASE_HEIGHT = 110;

const SCALE_MIN = 0.75;
const SCALE_MAX = 1.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Widget 면적의 제곱근 기반 배율. 면적 4배 → Scale 2배가 아니라 Scale 2배 지점을 훨씬 이전에 clamp한다. */
export function getWidgetScale(width: number, height: number): number {
  if (!width || !height) return 1;
  const areaRatio = (width * height) / (BASE_WIDTH * BASE_HEIGHT);
  return clamp(Math.sqrt(areaRatio), SCALE_MIN, SCALE_MAX);
}

/**
 * Container의 실제 width/height(px)로부터 모든 Responsive 수치를 계산한다.
 * width/height가 0이면(아직 측정 전이거나, Dashboard Grid 밖이라 애초에 측정하지
 * 않는 경우) 기존 화면과 동일한 DEFAULT_METRICS로 안전하게 fallback한다.
 */
export function getResponsiveChartMetrics(width: number, height: number): ResponsiveChartMetrics {
  if (!width || !height) return DEFAULT_METRICS;

  const scale = getWidgetScale(width, height);
  const mainFontSize = clamp(36 * scale, 24, 64);

  return {
    scale,
    mainFontSize,
    // Main Value보다 항상 작게: 비율(0.35)을 고정해 시각적 우선순위가 역전되지 않게 한다.
    comparisonFontSize: clamp(mainFontSize * 0.35, 10, 20),
    // Title은 Dashboard 전체 일관성이 중요하므로 변동 폭을 아주 좁게 둔다.
    titleFontSize: clamp(12 + (scale - 1) * 5, 12, 16),
    dataLabelFontSize: clamp(11 * scale, 9, 13),
    categoryFontSize: clamp(10 * scale, 8, 11),
    legendFontSize: clamp(11 * scale, 10, 13),
    legendGap: clamp(4 * scale, 3, 8),
    // Donut/Pie는 Scale이 아니라 실제 짧은 축 길이를 기준으로 지름을 정한다(요청사항 R6).
    donutDiameter: clamp(Math.min(width, height) * 0.8, 64, 280),
    barGap: clamp(8 * scale, 4, 16),
    barThickness: clamp(12 * scale, 8, 20),
    cardPadding: clamp(16 * scale, 10, 20),
  };
}
