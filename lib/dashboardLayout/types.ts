/** Home KPI Dashboard 공통 Layout의 단일 Grid Item. KPIDefinition.id를 기준으로 연결한다. */
export interface DashboardLayoutItem {
  kpiId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 공통 Layout Key. 사용자별 개인 Layout은 이번 Step에서 지원하지 않는다. */
export const HOME_LAYOUT_KEY = "HOME_KPI";

/** Grid는 12 Column을 기준으로 한다. */
export const GRID_COLS = 12;
