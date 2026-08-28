import { Suspense } from "react";
import type { Session } from "next-auth";
import { SidebarData } from "@/components/SidebarData";
import { SidebarSkeleton } from "@/components/SidebarSkeleton";
import { PresenceTracker } from "@/components/presence/PresenceTracker";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { IdlePrefetchBoot } from "@/components/nav/IdlePrefetchBoot";

export default function AppShell({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      {session?.user && <PresenceTracker />}
      {session?.user && <NotificationBell />}
      {/* 공통 성능 아키텍처(Idle Prefetch) — Shell은 Route 이동 간 유지되므로
          여기 한 번만 마운트하면 세션 전체에서 한 번만 실행된다. */}
      {session?.user && <IdlePrefetchBoot />}
      {/* 전역 구조 점검 Step: Sidebar의 SidebarLayout 조회를 Suspense로 감싸
          children과 분리했다 — Sidebar가 늦어도 페이지 본문은 기다리지 않는다. */}
      {session?.user ? (
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarData session={session} />
        </Suspense>
      ) : null}
      <main className="flex-1">{children}</main>
    </div>
  );
}
