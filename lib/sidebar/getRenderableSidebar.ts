import { prisma } from "@/lib/prisma";
import { mergeSidebarLayout } from "@/lib/sidebar/mergeSidebarLayout";
import { getGroupById, getMenuById, SIDEBAR_MENUS } from "@/lib/sidebar/sidebarConfig";
import { SIDEBAR_LAYOUT_KEY, type RenderableSidebarGroup, type SidebarLayoutData } from "@/lib/sidebar/types";
import type { Role } from "@/app/generated/prisma/enums";

function isVisible(requiredRole: Role | null, role: Role): boolean {
  return requiredRole === null || requiredRole === role;
}

/**
 * Sidebar 렌더링에 필요한 모든 것을 한 번에 계산한다. Prisma는 이 함수 안에서
 * 딱 1번만 조회한다(SidebarLayout 1 Row).
 *
 * 순서(요청사항 8, 절대 바뀌면 안 됨):
 * 1. 중앙 Config(SIDEBAR_MENUS/GROUPS) 로드
 * 2. 저장된 Sidebar Layout 조회 + 병합(위치만, 권한 무관)
 * 3. 현재 사용자 Role로 최종 필터링 — "누가 볼 수 있는지"는 항상 여기서만 결정한다
 */
export async function getRenderableSidebar(role: Role): Promise<{
  fixedMenus: { id: string; label: string; href: string }[];
  groups: RenderableSidebarGroup[];
}> {
  const fixedMenus = SIDEBAR_MENUS.filter((m) => m.fixed && isVisible(m.requiredRole, role))
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((m) => ({ id: m.id, label: m.label, href: m.href }));

  const savedRow = await prisma.sidebarLayout.findUnique({ where: { key: SIDEBAR_LAYOUT_KEY } });
  const savedData: SidebarLayoutData | null = savedRow ? JSON.parse(savedRow.layoutData) : null;
  const merged = mergeSidebarLayout(savedData);

  const groups: RenderableSidebarGroup[] = merged.map((g) => {
    const groupDef = getGroupById(g.groupId);
    return {
      groupId: g.groupId,
      label: groupDef?.label ?? g.groupId,
      order: g.order,
      items: g.items
        .map((id) => getMenuById(id))
        .filter((menu): menu is NonNullable<typeof menu> => menu !== undefined && isVisible(menu.requiredRole, role))
        .map((menu) => ({ id: menu.id, label: menu.label, href: menu.href })),
    };
  });

  return { fixedMenus, groups };
}
