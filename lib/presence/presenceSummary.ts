import { prisma } from "@/lib/prisma";
import { getPresenceStatus, type PresenceStatus } from "@/lib/presence/presence";

export interface TeamPresenceEntry {
  userId: string;
  displayName: string;
  status: PresenceStatus;
}

const STATUS_ORDER: Record<PresenceStatus, number> = {
  ACTIVE: 0,
  AWAY: 1,
  OFFLINE: 2,
};

/**
 * ACTIVE 사용자만 대상으로 Presence 상태를 계산한다. INVITED/DISABLED는 표시하지 않는다.
 * Google Sheet 캐시나 KPI를 건드리지 않고 User 테이블만 조회한다.
 */
export async function getTeamPresenceSummary(): Promise<TeamPresenceEntry[]> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, email: true, lastActiveAt: true, lastHeartbeatAt: true },
  });

  const now = new Date();

  return users
    .map((user) => ({
      userId: user.id,
      displayName: user.name ?? user.email.split("@")[0],
      status: getPresenceStatus({
        lastHeartbeatAt: user.lastHeartbeatAt,
        lastActiveAt: user.lastActiveAt,
        now,
      }),
    }))
    .sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      return a.displayName.localeCompare(b.displayName, "ko");
    });
}
