"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/cache/memoCache";
import { validateSidebarLayoutData } from "@/lib/sidebar/validateSidebarLayout";
import { SIDEBAR_LAYOUT_KEY } from "@/lib/sidebar/types";
import { SIDEBAR_LAYOUT_CACHE_KEY } from "@/lib/sidebar/getRenderableSidebar";
import type { SidebarLayoutData } from "@/lib/sidebar/types";

/**
 * ADMIN이 편집한 공통 Sidebar Layout을 저장한다. Dashboard Layout 저장과 완전히
 * 독립된 별도 Action/Model이므로, 이 저장이 실패해도 Dashboard Layout에는 영향이 없다.
 * updatedBy는 Client가 보낸 값을 쓰지 않고 항상 Server Session에서 결정한다.
 */
export async function saveSidebarLayout(
  data: SidebarLayoutData,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return { error: "권한이 없습니다." };
  }

  const validated = validateSidebarLayoutData(data);
  if (!validated) {
    return { error: "Sidebar 레이아웃 데이터가 올바르지 않습니다." };
  }

  try {
    await prisma.sidebarLayout.upsert({
      where: { key: SIDEBAR_LAYOUT_KEY },
      create: {
        key: SIDEBAR_LAYOUT_KEY,
        layoutData: JSON.stringify(validated),
        updatedBy: session.user.id,
      },
      update: {
        layoutData: JSON.stringify(validated),
        updatedBy: session.user.id,
      },
    });
  } catch {
    return { error: "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  invalidateCache(SIDEBAR_LAYOUT_CACHE_KEY);
  revalidatePath("/", "layout");
  return { ok: true };
}
