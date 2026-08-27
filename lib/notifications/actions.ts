"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { NotificationInfo } from "./types";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("FORBIDDEN");
  return session;
}

function toInfo(n: {
  id: string;
  type: string;
  taskId: string | null;
  commentId: string | null;
  actorId: string | null;
  actor: { name: string | null } | null;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}): NotificationInfo {
  return {
    id: n.id,
    type: n.type as NotificationInfo["type"],
    taskId: n.taskId,
    commentId: n.commentId,
    actorId: n.actorId,
    actorName: n.actor?.name ?? null,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
  };
}

/** Bell 뱃지용 — Shell 로드/마운트 시 1회만 부른다(요청사항 12: 별도 polling 없음). */
export async function getUnreadNotificationCountAction(): Promise<number> {
  const session = await requireUser();
  return prisma.notification.count({ where: { userId: session.user.id, isRead: false } });
}

/** Bell 클릭(Dropdown 오픈) 시에만 부른다 — 최신순, 최대 30건. */
export async function listNotificationsAction(): Promise<NotificationInfo[]> {
  const session = await requireUser();
  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { actor: { select: { name: true } } },
  });
  return notifications.map(toInfo);
}

/**
 * 개별 읽음 처리(Notification 클릭 시). 본인 소유 Notification인지 서버에서
 * 반드시 다시 확인한다(요청사항 8, 11) — Client가 다른 사용자의 id를 보내도
 * 여기서 막힌다.
 */
export async function markNotificationReadAction(id: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();

  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return { error: "알림을 찾을 수 없습니다." };
  if (existing.userId !== session.user.id) return { error: "본인의 알림만 읽음 처리할 수 있습니다." };

  if (!existing.isRead) {
    await prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
  }
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: session.user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { ok: true };
}
