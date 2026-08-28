import type { Session } from "next-auth";
import Sidebar from "@/components/Sidebar";
import { getRenderableSidebar } from "@/lib/sidebar/getRenderableSidebar";

/**
 * 전역 구조 점검 Step — SidebarLayout DB 조회를 이 async Server Component
 * 안으로 분리했다. AppShell이 이 컴포넌트를 <Suspense>로 감싸므로, 이 조회가
 * 끝나기 전에도 형제 노드인 페이지 본문({children})은 이미 자기 자신의 렌더링/
 * 데이터 조회를 시작할 수 있다 — 기존에는 (shell)/layout.tsx가 이 조회를
 * 최상위에서 await해서 페이지 전체가 함께 막혀 있었다.
 *
 * Sidebar의 권한 필터링/정렬 로직 자체는 getRenderableSidebar 안에서 기존과
 * 완전히 동일하게 동작한다 — 여기서는 "언제 조회하는지"만 바꿨다.
 */
export async function SidebarData({ session }: { session: Session }) {
  const sidebar = await getRenderableSidebar(session.user.role);
  return <Sidebar session={session} fixedMenus={sidebar.fixedMenus} initialGroups={sidebar.groups} />;
}
