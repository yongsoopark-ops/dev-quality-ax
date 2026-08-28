import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { auth } from "@/auth";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.status === "DISABLED") {
    redirect("/access-denied");
  }

  // 전역 구조 점검 Step: SidebarLayout 조회(getRenderableSidebar)는 더 이상
  // 여기서 await하지 않는다 — AppShell 안의 <Suspense>가 Sidebar 전용으로
  // 분리해서 조회하므로, children(실제 페이지)이 Sidebar를 기다리지 않고
  // 곧바로 자기 자신의 렌더링/데이터 조회를 시작할 수 있다. "누가 볼 수
  // 있는지"(Role 필터링)는 여전히 getRenderableSidebar 내부에서 매번 새로
  // 계산되며 이 변경으로 전혀 달라지지 않는다.
  return <AppShell session={session}>{children}</AppShell>;
}
