import { SIDEBAR_GROUPS, SIDEBAR_MENUS } from "@/lib/sidebar/sidebarConfig";
import type { SidebarLayoutData } from "@/lib/sidebar/types";

/**
 * Client가 보낸 Sidebar Layout을 신뢰하지 않고 서버에서 검증한다.
 * - groupId가 실제 존재하는(현재 sidebarConfig의) Group인지
 * - order가 0 이상의 정수인지
 * - items의 각 menuId가 실제 존재하고, fixed가 아닌 Menu인지
 * - groupId/menuId 중복이 없는지
 * 하나라도 위반하면 전체를 거부한다(부분 저장하지 않음). 통과분은 groupId/order/items
 * 3개 필드만 남긴 새 객체로 재구성해 불필요한 필드(권한 정보 포함)를 제거한다.
 * 권한(requiredRole)은 애초에 이 데이터 구조에 필드 자체가 없으므로 저장될 수 없다.
 */
export function validateSidebarLayoutData(raw: unknown): SidebarLayoutData | null {
  if (!Array.isArray(raw)) return null;

  const validGroupIds = new Set<string>(SIDEBAR_GROUPS.map((g) => g.id));
  const validMenuIds = new Set<string>(SIDEBAR_MENUS.filter((m) => !m.fixed).map((m) => m.id));

  const seenGroups = new Set<string>();
  const seenMenus = new Set<string>();
  const result: SidebarLayoutData = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { groupId, order, items } = entry as Record<string, unknown>;

    if (typeof groupId !== "string" || !validGroupIds.has(groupId)) return null;
    if (seenGroups.has(groupId)) return null;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0) return null;
    if (!Array.isArray(items)) return null;

    const cleanItems: string[] = [];
    for (const item of items) {
      if (typeof item !== "string" || !validMenuIds.has(item)) return null;
      if (seenMenus.has(item)) return null;
      seenMenus.add(item);
      cleanItems.push(item);
    }

    seenGroups.add(groupId);
    result.push({ groupId, order, items: cleanItems });
  }

  return result;
}
