import type { Role } from "@/app/generated/prisma/enums";

export type SidebarMenuId =
  | "HOME"
  | "CHAT"
  | "SCHEDULE"
  | "USER_MANAGEMENT"
  | "KPI_MANAGEMENT"
  | "DATA_SOURCES"
  | "API_USAGE";

export type SidebarGroupId = "OPERATIONS" | "PROJECT_MANAGEMENT";

export interface SidebarMenuDef {
  id: SidebarMenuId;
  label: string;
  href: string;
  /** null이면 로그인한 모든 Role에게 보인다. */
  requiredRole: Role | null;
  /**
   * fixed는 Group에 속하지 않고 항상 코드에 정의된 고정 위치에 렌더링되며 Drag 대상에서
   * 제외된다. 현재 HOME/CHAT이 fixed이고, defaultOrder 순으로 정렬해 렌더링한다
   * (getRenderableSidebar 참고). fixed Menu는 mergeSidebarLayout/validateSidebarLayoutData
   * 양쪽에서 이미 validMenuIds 계산 시 제외되므로(둘 다 `!m.fixed` 필터 사용) 여기서
   * fixed:true만 지정하면 Drag 대상 제외·Layout 저장 제외가 전부 자동으로 적용된다.
   */
  fixed: boolean;
  /** fixed가 아닌 Menu만 의미가 있다 — 저장된 Layout이 없을 때 배치될 기본 Group. */
  defaultGroupId: SidebarGroupId | null;
  /** 같은 Group(또는 고정 영역) 안에서의 기본 순서. */
  defaultOrder: number;
}

export interface SidebarGroupDef {
  id: SidebarGroupId;
  label: string;
  defaultOrder: number;
}

/**
 * Sidebar Menu 정의의 단일 진입점. Component에 하드코딩하지 않고 이 파일 하나로
 * 관리한다. id는 DB Layout 저장/병합 기준이 되므로 한번 정하면 이름을 바꾸지 않는다
 * (label이 바뀌어도 Layout이 깨지지 않게 하기 위함).
 */
export const SIDEBAR_MENUS: SidebarMenuDef[] = [
  {
    id: "HOME",
    label: "Home",
    href: "/home",
    requiredRole: null,
    fixed: true,
    defaultGroupId: null,
    defaultOrder: 0,
  },
  {
    id: "CHAT",
    label: "Chat",
    href: "/chat",
    requiredRole: null,
    fixed: true,
    defaultGroupId: null,
    defaultOrder: 1,
  },
  {
    id: "SCHEDULE",
    label: "일정 관리",
    href: "/schedule",
    requiredRole: null,
    fixed: false,
    defaultGroupId: "PROJECT_MANAGEMENT",
    defaultOrder: 0,
  },
  {
    id: "USER_MANAGEMENT",
    label: "사용자 관리",
    href: "/admin/users",
    requiredRole: "ADMIN",
    fixed: false,
    defaultGroupId: "OPERATIONS",
    defaultOrder: 0,
  },
  {
    id: "KPI_MANAGEMENT",
    label: "KPI 관리",
    href: "/admin/kpi",
    requiredRole: "ADMIN",
    fixed: false,
    defaultGroupId: "OPERATIONS",
    defaultOrder: 1,
  },
  {
    id: "DATA_SOURCES",
    label: "데이터 소스",
    href: "/admin/sources",
    requiredRole: "ADMIN",
    fixed: false,
    defaultGroupId: "OPERATIONS",
    defaultOrder: 2,
  },
  {
    id: "API_USAGE",
    label: "API 사용량",
    href: "/admin/api-usage",
    requiredRole: "ADMIN",
    fixed: false,
    defaultGroupId: "OPERATIONS",
    defaultOrder: 3,
  },
];

/**
 * 현재 실제로 존재하는 Group. 이번 Step에서는 사용자가 새 Group을 만들거나
 * 이름을 바꾸는 기능을 제공하지 않으므로, 여기 정의된 Group만 이동 대상이 된다.
 * 다만 Merge/Validation/Drag 로직 자체는 Group이 여러 개로 늘어나도 그대로
 * 동작하도록 설계되어 있다(Cross-group 이동 구조는 이미 범용적이다).
 */
export const SIDEBAR_GROUPS: SidebarGroupDef[] = [
  { id: "PROJECT_MANAGEMENT", label: "프로젝트 관리", defaultOrder: 0 },
  { id: "OPERATIONS", label: "운영 관리", defaultOrder: 1 },
];

export function getMenuById(id: string): SidebarMenuDef | undefined {
  return SIDEBAR_MENUS.find((m) => m.id === id);
}

export function getGroupById(id: string): SidebarGroupDef | undefined {
  return SIDEBAR_GROUPS.find((g) => g.id === id);
}
