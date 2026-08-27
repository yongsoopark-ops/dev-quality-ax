/** Sidebar Layout DB Row의 key. 팀 공통 Layout이므로 단일 Row만 존재한다. */
export const SIDEBAR_LAYOUT_KEY = "MAIN_SIDEBAR";

/** 저장된 Sidebar Layout의 한 Group. Menu는 label/href가 아니라 안정적인 id로만 저장한다. */
export interface SidebarLayoutGroup {
  groupId: string;
  order: number;
  items: string[];
}

export type SidebarLayoutData = SidebarLayoutGroup[];

/**
 * 서버에서 "병합 + 현재 사용자 Role로 필터링"까지 마친, 렌더링 직전 상태.
 * Client(Sidebar)는 이 구조를 그대로 그리기만 하면 되고, 권한 판단을 다시 하지 않는다.
 */
export interface RenderableSidebarMenu {
  id: string;
  label: string;
  href: string;
}

export interface RenderableSidebarGroup {
  groupId: string;
  label: string;
  order: number;
  items: RenderableSidebarMenu[];
}
