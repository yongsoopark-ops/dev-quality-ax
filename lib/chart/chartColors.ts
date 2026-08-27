/**
 * KPI 그래프(Donut/Pie/Bar/Horizontal Bar) 전용 공통 색상 체계.
 * Component에 색상 값을 직접 하드코딩하지 않고 이 파일에서만 관리한다.
 */

/**
 * 브랜드 Navy를 기준으로, SaaS UI 톤에 맞게 정제한 순차 Accent Palette.
 * 강한 원색 대신 살짝 톤을 낮춘 색을 사용한다.
 */
export const CHART_PALETTE = [
  "#2c4a85", // Navy Blue (브랜드)
  "#0d9488", // Teal
  "#059669", // Emerald
  "#d97706", // Amber
  "#ea580c", // Orange
  "#e11d48", // Rose
  "#7c3aed", // Violet
  "#475569", // Slate
] as const;

/** kpiCalculator.ts의 groupCount/groupSum이 빈 값에 붙이는 라벨과 동일한 문자열의 색상. */
export const EMPTY_VALUE_COLOR = "#9ca3af"; // Gray

/**
 * 의미가 명확한 값은 고정 색상을 쓴다 (Severity 등). 그 외 일반 Category는
 * getChartColorMap()이 라벨 해시 + 충돌 회피로 Palette를 배정한다.
 */
const SEMANTIC_COLORS: Record<string, string> = {
  Critical: "#e11d48", // Red/Rose
  Major: "#ea580c", // Orange
  Minor: "#2c4a85", // Blue/Navy
  "(빈 값)": EMPTY_VALUE_COLOR,
};

/** 간단한 문자열 해시(djb2 계열). 0 이상 정수를 반환한다. */
function hashLabel(label: string): number {
  let hash = 5381;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 33 + label.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * 한 그래프에 함께 표시되는 라벨 목록을 받아 라벨→색상 Map을 만든다.
 *
 * - Critical/Major/Minor/(빈 값) 등은 고정 Semantic Color를 그대로 쓴다.
 * - 나머지는 라벨 문자열 해시를 시작 위치로 삼되, 같은 그래프 안에서 이미 쓰인 색과
 *   충돌하면 Palette를 순서대로 다음 칸까지 탐색해 배정한다(Linear Probing) —
 *   Segment 개수가 Palette 크기(8) 이하이면 그래프 내에서 색이 겹치지 않는다.
 * - 배정은 원본 배열 순서가 아니라 정렬된 라벨 기준으로 처리하므로, 같은 라벨 집합이면
 *   데이터가 재정렬되어도 항상 같은 결과가 나온다(렌더링 순서에 의존하지 않음).
 */
export function getChartColorMap(labels: string[]): Map<string, string> {
  const uniqueLabels = [...new Set(labels)];
  const colorMap = new Map<string, string>();
  const usedColors = new Set<string>();
  const remaining: string[] = [];

  for (const label of uniqueLabels) {
    const semantic = SEMANTIC_COLORS[label];
    if (semantic) {
      colorMap.set(label, semantic);
      usedColors.add(semantic);
    } else {
      remaining.push(label);
    }
  }

  for (const label of [...remaining].sort()) {
    const start = hashLabel(label) % CHART_PALETTE.length;
    let color = CHART_PALETTE[start];
    for (let offset = 1; usedColors.has(color) && offset < CHART_PALETTE.length; offset++) {
      color = CHART_PALETTE[(start + offset) % CHART_PALETTE.length];
    }
    colorMap.set(label, color);
    usedColors.add(color);
  }

  return colorMap;
}

/**
 * 단일 라벨만 알고 있을 때 쓰는 간이 버전 (그래프 전체 라벨 목록 없이 색만 필요한 경우).
 * 같은 그래프 안의 여러 라벨을 함께 그릴 때는 충돌 회피를 위해 getChartColorMap()을 쓴다.
 */
export function getChartColor(label: string): string {
  const semantic = SEMANTIC_COLORS[label];
  if (semantic) return semantic;
  return CHART_PALETTE[hashLabel(label) % CHART_PALETTE.length];
}
