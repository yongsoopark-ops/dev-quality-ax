import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/cache/memoCache";
import { requestMemo } from "@/lib/cache/requestMemo";
import { mergeSidebarLayout } from "@/lib/sidebar/mergeSidebarLayout";
import { getGroupById, getMenuById, SIDEBAR_MENUS } from "@/lib/sidebar/sidebarConfig";
import { SIDEBAR_LAYOUT_KEY, type RenderableSidebarGroup, type SidebarLayoutData } from "@/lib/sidebar/types";
import type { Role } from "@/app/generated/prisma/enums";

export const SIDEBAR_LAYOUT_CACHE_KEY = "sidebar-layout-row";

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
 *
 * 성능 개선(전역 구조 점검 Step): SidebarLayout Row는 모든 Route가 공통으로
 * 거치는 Shell Layout에서 매번 조회되지만, ADMIN이 "저장"을 눌렀을 때만
 * 바뀐다. 위치 데이터만 60초 캐시하고, Role 필터링(3번)은 캐시와 무관하게
 * 매번 이 함수 호출 시점의 role 인자로 새로 계산한다 — 권한 판단 자체는
 * 캐시되지 않는다.
 *
 * requestMemo로 감싸 request-level(17번)로도 중복을 없앤다 — 지금은
 * SidebarData.tsx 한 곳에서만 부르지만, 앞으로 같은 Request 안에서 다른
 * Server Component가 같은 role로 또 부르더라도 실제 계산은 1번만 일어난다.
 */
async function getRenderableSidebarImpl(role: Role): Promise<{
  fixedMenus: { id: string; label: string; href: string }[];
  groups: RenderableSidebarGroup[];
}> {
  const fixedMenus = SIDEBAR_MENUS.filter((m) => m.fixed && isVisible(m.requiredRole, role))
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((m) => ({ id: m.id, label: m.label, href: m.href }));

  const savedRow = await cached(SIDEBAR_LAYOUT_CACHE_KEY, 60_000, () =>
    prisma.sidebarLayout.findUnique({ where: { key: SIDEBAR_LAYOUT_KEY } }),
  );
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

export const getRenderableSidebar = requestMemo(getRenderableSidebarImpl);
