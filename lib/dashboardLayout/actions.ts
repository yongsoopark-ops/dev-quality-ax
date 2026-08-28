"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/cache/memoCache";
import { validateLayoutData } from "@/lib/dashboardLayout/validate";
import { DASHBOARD_LAYOUT_CACHE_KEY, HOME_LAYOUT_KEY, type DashboardLayoutItem } from "@/lib/dashboardLayout/types";

/**
 * ADMIN이 편집한 공통 Home Dashboard Layout을 저장한다.
 * userId는 Client가 보낸 값을 쓰지 않고 항상 Server Session에서 결정한다.
 */
export async function saveDashboardLayout(
  items: DashboardLayoutItem[],
): Promise<{ ok: true } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return { error: "권한이 없습니다." };
  }

  const activeKpis = await prisma.kPIDefinition.findMany({
    where: { enabled: true },
    select: { id: true },
  });
  const activeIds = new Set(activeKpis.map((k) => k.id));

  const validated = validateLayoutData(items, activeIds);
  if (!validated) {
    return { error: "레이아웃 데이터가 올바르지 않습니다." };
  }

  try {
    await prisma.dashboardLayout.upsert({
      where: { key: HOME_LAYOUT_KEY },
      create: {
        key: HOME_LAYOUT_KEY,
        layoutData: JSON.stringify(validated),
        updatedBy: session.user.id,
      },
      update: {
        layoutData: JSON.stringify(validated),
        updatedBy: session.user.id,
      },
    });
  } catch {
    return { error: "레이아웃 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  invalidateCache(DASHBOARD_LAYOUT_CACHE_KEY);
  revalidatePath("/home");
  return { ok: true };
}
