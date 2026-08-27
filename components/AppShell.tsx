import type { Session } from "next-auth";
import Sidebar from "@/components/Sidebar";
import { PresenceTracker } from "@/components/presence/PresenceTracker";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { RenderableSidebarGroup } from "@/lib/sidebar/types";

export default function AppShell({
  children,
  session,
  sidebar,
}: {
  children: React.ReactNode;
  session: Session | null;
  sidebar: {
    fixedMenus: { id: string; label: string; href: string }[];
    groups: RenderableSidebarGroup[];
  };
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      {session?.user && <PresenceTracker />}
      {session?.user && <NotificationBell />}
      <Sidebar session={session} fixedMenus={sidebar.fixedMenus} initialGroups={sidebar.groups} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
