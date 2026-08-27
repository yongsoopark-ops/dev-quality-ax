"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTeamPresenceSummary, type TeamPresenceEntry } from "@/lib/presence/presenceSummary";

const HEARTBEAT_DEDUPE_MS = 30_000;
const ACTIVITY_DEDUPE_MS = 60_000;

/**
 * 로그인된 웹사이트가 열려 있다는 생존 신호만 기록한다. lastActiveAt은 건드리지 않는다.
 * userId는 Client가 아니라 서버 세션에서만 결정한다.
 */
export async function updateHeartbeat() {
  const session = await auth();
  if (!session?.user) return;

  const now = new Date();
  const skipIfNewerThan = new Date(now.getTime() - HEARTBEAT_DEDUPE_MS);

  // 최근 30초 이내에 이미 기록되어 있으면 UPDATE 자체를 생략한다 (조건부 UPDATE, 별도 조회 없음).
  await prisma.user.updateMany({
    where: {
      id: session.user.id,
      OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: skipIfNewerThan } }],
    },
    data: { lastHeartbeatAt: now },
  });
}

/** 실제 사용자 Interaction이 있을 때만 호출된다 (Client에서 이미 1분 단위로 throttle됨). */
export async function recordActivity() {
  const session = await auth();
  if (!session?.user) return;

  const now = new Date();
  const skipIfNewerThan = new Date(now.getTime() - ACTIVITY_DEDUPE_MS);

  await prisma.user.updateMany({
    where: {
      id: session.user.id,
      OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: skipIfNewerThan } }],
    },
    data: { lastActiveAt: now },
  });
}

/** TeamPresenceCard 전용 경량 조회. KPI/Sheet 캐시는 건드리지 않는다. */
export async function fetchTeamPresence(): Promise<TeamPresenceEntry[]> {
  const session = await auth();
  if (!session?.user) return [];

  return getTeamPresenceSummary();
}
