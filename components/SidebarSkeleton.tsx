import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

/**
 * 전역 구조 점검 Step — Sidebar 자체가 SidebarLayout을 DB에서 조회해야 하는데,
 * 이 조회가 모든 Route가 공유하는 (shell)/layout.tsx 안에 있어 그동안은
 * Sidebar 조회가 끝나야만 페이지 본문(children)도 함께 그려지기 시작했다.
 * 이제 Sidebar는 별도 Suspense 경계(components/SidebarData.tsx) 안에서
 * 독립적으로 조회되므로, 그 사이 실제 Sidebar와 같은 너비/배경의 Skeleton을
 * 보여준다 — 레이아웃이 튀지 않는다.
 */
export function SidebarSkeleton() {
  return (
    <aside className="flex w-full shrink-0 flex-col bg-navy-900 text-white md:h-screen md:w-64 md:sticky md:top-0">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-700">
          <span className="text-sm font-semibold">AX</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-white">개발품질 AX</span>
          <span className="text-xs text-navy-100/70">Development Quality</span>
        </div>
      </div>
      <nav className="flex-1 space-y-2 px-3 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-8 bg-white/10" />
        ))}
      </nav>
    </aside>
  );
}
