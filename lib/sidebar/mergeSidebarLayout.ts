import { SIDEBAR_GROUPS, SIDEBAR_MENUS } from "@/lib/sidebar/sidebarConfig";
import type { SidebarLayoutData, SidebarLayoutGroup } from "@/lib/sidebar/types";

/** Group별 기본(defaultOrder 순) Menu id 목록. Group에 속한 고정(fixed) 아닌 Menu만 대상. */
function buildDefaultGroupItems(): Map<string, string[]> {
  const byGroup = new Map<string, { id: string; order: number }[]>();
  for (const menu of SIDEBAR_MENUS) {
    if (menu.fixed || !menu.defaultGroupId) continue;
    const list = byGroup.get(menu.defaultGroupId) ?? [];
    list.push({ id: menu.id, order: menu.defaultOrder });
    byGroup.set(menu.defaultGroupId, list);
  }
  const result = new Map<string, string[]>();
  for (const [groupId, items] of byGroup) {
    result.set(
      groupId,
      [...items].sort((a, b) => a.order - b.order).map((i) => i.id),
    );
  }
  return result;
}

/**
 * 저장된 Sidebar Layout과 현재 sidebarConfig를 병합한다.
 * 1. 저장 Layout 중 현재 Config에 실제 존재하는 Group/Menu만 남긴다(삭제된 Menu/Group은
 *    무시, 요청사항 23).
 * 2. 저장 Layout에 없는 신규 Group은 defaultOrder 기준으로 자동 삽입한다(요청사항 24).
 * 3. 어느 Group에도 배치되지 않은(신규) Menu는 자신의 defaultGroupId 끝에 자동
 *    추가한다(요청사항 22). 기존에 사용자가 재배치한 순서는 건드리지 않는다.
 * 4. Group을 order 기준으로 정렬해 반환한다.
 *
 * 이 함수는 권한(requiredRole)을 전혀 고려하지 않는다 — "어디에 보일지"만 계산하고,
 * "누가 볼 수 있는지"는 렌더링 시점에 별도로 필터링한다(요청사항 8).
 */
export function mergeSidebarLayout(saved: SidebarLayoutData | null): SidebarLayoutData {
  const validGroupIds = new Set<string>(SIDEBAR_GROUPS.map((g) => g.id));
  const validMenuIds = new Set<string>(SIDEBAR_MENUS.filter((m) => !m.fixed).map((m) => m.id));

  const kept: SidebarLayoutGroup[] = (saved ?? [])
    .filter((g) => validGroupIds.has(g.groupId))
    .map((g) => ({
      groupId: g.groupId,
      order: g.order,
      items: g.items.filter((id) => validMenuIds.has(id)),
    }));

  const keptGroupIds = new Set(kept.map((g) => g.groupId));
  for (const groupDef of SIDEBAR_GROUPS) {
    if (!keptGroupIds.has(groupDef.id)) {
      kept.push({ groupId: groupDef.id, order: groupDef.defaultOrder, items: [] });
      keptGroupIds.add(groupDef.id);
    }
  }

  const placedMenuIds = new Set(kept.flatMap((g) => g.items));
  const defaultGroupItems = buildDefaultGroupItems();
  for (const menu of SIDEBAR_MENUS) {
    if (menu.fixed || !menu.defaultGroupId || placedMenuIds.has(menu.id)) continue;
    const group = kept.find((g) => g.groupId === menu.defaultGroupId);
    if (!group) continue;
    // 같은 defaultGroupId를 가진 여러 신규 Menu가 한 번에 추가될 때도 defaultOrder
    // 순서를 지키기 위해, 이미 계산해 둔 기본 순서 배열을 그대로 이어붙인다.
    const defaultOrderList = defaultGroupItems.get(menu.defaultGroupId) ?? [];
    for (const id of defaultOrderList) {
      if (!placedMenuIds.has(id) && !group.items.includes(id)) {
        group.items.push(id);
        placedMenuIds.add(id);
      }
    }
  }

  return [...kept].sort((a, b) => a.order - b.order);
}
