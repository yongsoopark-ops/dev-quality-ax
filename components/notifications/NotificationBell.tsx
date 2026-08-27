"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getUnreadNotificationCountAction,
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import type { NotificationInfo } from "@/lib/notifications/types";

/** "방금" / "10:42" / "2026.08.27 12:07" — Schedule Comment 시각 표기와 동일한 규칙. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (now.getTime() - d.getTime() < 60_000 && now.getTime() >= d.getTime()) return "방금";
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 상단 Bell = Notification Inbox(요청사항 7~9). 실시간 Push 없이(요청사항 12:
 * WebSocket/SSE 금지) 최초 Mount 시 unread count 1회, Dropdown을 열 때만 목록을
 * 다시 조회하는 최소 방식으로 구현한다 — 페이지마다 과도한 polling을 만들지 않는다.
 *
 * 항목 클릭 시 "/schedule?task=<taskId>&comment=<commentId>"로 이동해(요청사항 9)
 * 해당 Task Modal/Update Modal이 자동으로 열리고 Comment가 스크롤+하이라이트된다
 * (ScheduleClient/TaskDetailPanel/UpdateModal 참고). 존재하지 않는 Task/Comment는
 * 그 쪽에서 안전하게 무시한다.
 */
export function NotificationBell() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const count = await getUnreadNotificationCountAction();
        if (!cancelled) setUnreadCount(count);
      } catch {
        // Shell 최초 로드 시 조용히 실패해도 Bell 자체는 정상 동작해야 하므로
        // 뱃지만 0으로 남기고(기본값) 별도 오류 UI는 띄우지 않는다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setLoading(true);
    setError(null);
    try {
      const list = await listNotificationsAction();
      setItems(list);
    } catch {
      setError("알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleItemClick(item: NotificationInfo) {
    if (!item.isRead) {
      // 실패해도 이동 자체는 막지 않는다 — 다음에 Bell을 열면 다시 시도할 수 있다.
      try {
        const res = await markNotificationReadAction(item.id);
        if (!res.error) {
          setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, isRead: true } : p)));
          setUnreadCount((c) => Math.max(0, c - 1));
        }
      } catch {
        // 읽음 처리 실패는 조용히 무시하고 이동은 계속 진행한다.
      }
    }
    setOpen(false);
    if (item.taskId) {
      const query = item.commentId ? `task=${item.taskId}&comment=${item.commentId}` : `task=${item.taskId}`;
      router.push(`/schedule?${query}`);
    }
  }

  async function handleMarkAll() {
    setMarkingAll(true);
    setError(null);
    try {
      const res = await markAllNotificationsReadAction();
      if (res.error) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.map((p) => ({ ...p, isRead: true })));
      setUnreadCount(0);
    } catch {
      setError("모두 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div ref={containerRef} className="fixed right-4 top-4 z-30">
      <button
        type="button"
        onClick={handleToggle}
        aria-label="알림"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-navy-100 bg-white text-navy-950 shadow-sm hover:bg-navy-50"
      >
        <span aria-hidden className="text-lg">
          🔔
        </span>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-navy-100 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-navy-950">알림</p>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={markingAll || unreadCount === 0}
              className="text-xs text-navy-950/50 hover:text-navy-950 disabled:opacity-40"
            >
              {markingAll ? "처리 중..." : "모두 읽음"}
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-xs text-navy-950/40">불러오는 중...</p>
            ) : error ? (
              <p className="px-4 py-6 text-center text-xs text-red-600">{error}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-navy-950/40">알림이 없습니다.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className={`block w-full border-b border-navy-50 px-4 py-2.5 text-left last:border-b-0 hover:bg-navy-50 ${
                    item.isRead ? "" : "bg-blue-50/50"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {!item.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />}
                    <p className="truncate text-xs font-medium text-navy-950">{item.title}</p>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-navy-950/60">{item.message}</p>
                  <p className="mt-1 text-[11px] text-navy-950/40">{formatTime(item.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
