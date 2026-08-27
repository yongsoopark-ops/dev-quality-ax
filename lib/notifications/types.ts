import type { NotificationType } from "@/app/generated/prisma/enums";

/** Bell Inbox 목록/뱃지가 그대로 쓰는 직렬화 가능한 모양. title/message는 발생
 * 시점 문구를 그대로 굳혀 저장한 값이라(schema.prisma 주석 참고) 여기서 다시
 * 조합하지 않는다. */
export interface NotificationInfo {
  id: string;
  type: NotificationType;
  taskId: string | null;
  commentId: string | null;
  actorId: string | null;
  actorName: string | null;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}
