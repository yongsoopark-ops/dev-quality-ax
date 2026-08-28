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

/** /home page.tsx가 이 Layout Row를 캐시할 때 쓰는 키. "use server" 파일은
 * 함수 외의 export를 허용하지 않아 actions.ts가 아닌 여기 둔다. 저장 직후
 * actions.ts의 saveDashboardLayout이 이 키로 바로 무효화한다. */
export const DASHBOARD_LAYOUT_CACHE_KEY = `dashboard-layout-row:${HOME_LAYOUT_KEY}`;

/** Grid는 12 Column을 기준으로 한다. */
export const GRID_COLS = 12;
