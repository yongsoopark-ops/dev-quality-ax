/**
 * 성능 개선(진단 Step 근거) — /home/loading.tsx와 같은 목적/같은 톤의 최소
 * Skeleton. /schedule Server Component의 DB 조회가 끝날 때까지 자동으로 뜬다.
 */
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

export default function ScheduleLoading() {
  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden p-8">
      <div className="shrink-0">
        <SkeletonBlock className="h-6 w-28" />
        <SkeletonBlock className="mt-2 h-4 w-72" />
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col rounded-xl border border-navy-100 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SkeletonBlock className="h-7 w-20" />
          <SkeletonBlock className="h-7 w-24" />
          <SkeletonBlock className="h-7 w-16" />
        </div>
        <SkeletonBlock className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
