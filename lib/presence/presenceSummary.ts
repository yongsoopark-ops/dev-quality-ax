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

/** getTeamPresenceSummary가 필요로 하는 최소 User 모양(Presence 계산용 두 시각 포함). */
export interface ActiveUserWithPresence {
  id: string;
  name: string | null;
  email: string;
  lastActiveAt: Date | null;
  lastHeartbeatAt: Date | null;
}

/**
 * ACTIVE 사용자만 대상으로 Presence 상태를 계산한다. INVITED/DISABLED는 표시하지 않는다.
 * Google Sheet 캐시나 KPI를 건드리지 않고 User 테이블만 조회한다.
 *
 * activeUsers를 넘기면 그 목록을 그대로 쓴다 — /home처럼 같은 요청 안에서 이미
 * (이 함수가 필요로 하는 필드를 포함해) ACTIVE User를 조회한 호출부가 중복
 * 조회를 피하기 위해 쓴다(성능 개선). 넘기지 않으면 기존과 동일하게 직접 조회한다.
 */
export async function getTeamPresenceSummary(activeUsers?: ActiveUserWithPresence[]): Promise<TeamPresenceEntry[]> {
  const users =
    activeUsers ??
    (await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, email: true, lastActiveAt: true, lastHeartbeatAt: true },
    }));

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
