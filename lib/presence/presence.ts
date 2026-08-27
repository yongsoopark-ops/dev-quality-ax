/**
 * 팀원 Presence 상태 판정 로직. UI Component에 하드코딩하지 않고 이 한 곳에서만 관리한다.
 * WebSocket/Redis 등 별도 Realtime 인프라 없이, User.lastHeartbeatAt / lastActiveAt만으로 판단한다.
 */

export const HEARTBEAT_OFFLINE_THRESHOLD_MINUTES = 3;
export const AWAY_THRESHOLD_MINUTES = 30;

export type PresenceStatus = "ACTIVE" | "AWAY" | "OFFLINE";

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  ACTIVE: "사용중",
  AWAY: "부재중",
  OFFLINE: "미접속",
};

/**
 * 판정 순서:
 * 1) Heartbeat가 3분 이내가 아니면(또는 없으면) 무조건 OFFLINE — 활동 시각과 무관.
 * 2) 사이트가 열려 있는 경우에만 Activity를 본다 — 30분 이내면 ACTIVE, 아니면(또는 없으면) AWAY.
 */
export function getPresenceStatus(params: {
  lastHeartbeatAt: Date | null;
  lastActiveAt: Date | null;
  now: Date;
}): PresenceStatus {
  const { lastHeartbeatAt, lastActiveAt, now } = params;

  const heartbeatMinutesAgo = lastHeartbeatAt
    ? (now.getTime() - lastHeartbeatAt.getTime()) / 60_000
    : Infinity;

  if (heartbeatMinutesAgo > HEARTBEAT_OFFLINE_THRESHOLD_MINUTES) {
    return "OFFLINE";
  }

  const activityMinutesAgo = lastActiveAt
    ? (now.getTime() - lastActiveAt.getTime()) / 60_000
    : Infinity;

  if (activityMinutesAgo <= AWAY_THRESHOLD_MINUTES) {
    return "ACTIVE";
  }

  return "AWAY";
}
