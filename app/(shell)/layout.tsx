import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { auth } from "@/auth";
import { getRenderableSidebar } from "@/lib/sidebar/getRenderableSidebar";

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

  // Sidebar Layout은 "어디에 보일지"만 병합하고, "누가 볼 수 있는지"는 여기서
  // Role로 다시 필터링한 결과만 Client(Sidebar)로 내려보낸다.
  const sidebar = await getRenderableSidebar(session.user.role);

  return (
    <AppShell session={session} sidebar={sidebar}>
      {children}
    </AppShell>
  );
}
