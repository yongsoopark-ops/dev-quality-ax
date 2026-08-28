/**
 * 성능 개선(진단 Step 근거) — 실제 지연 자체를 없애지는 못해도, 클릭 즉시 뭔가
 * 반응한다는 느낌을 주기 위한 최소 Skeleton이다. Next.js App Router가 이 파일을
 * /home Server Component 렌더(및 그 안의 DB 조회)가 끝날 때까지 자동으로 보여준다.
 * 과도한 애니메이션 없이 옅은 펄스만 준다 — 기존 AX Navy 톤 그대로.
 */
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

export default function HomeLoading() {
  return (
    <div className="p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SkeletonBlock className="h-8 w-40" />
        <div className="flex flex-wrap gap-4">
          <SkeletonBlock className="h-16 w-48" />
          <SkeletonBlock className="h-16 w-48" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
