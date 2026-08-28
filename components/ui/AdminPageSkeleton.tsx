import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

/**
 * 전역 구조 점검 Step — admin/* 4개 Route(kpi/sources/users/api-usage)에
 * loading.tsx가 없어 DB 조회가 끝날 때까지 빈 화면으로 보였다. 이 4개는
 * 전부 "제목 + 설명 + 목록/카드형 리스트" 구조가 같으므로 하나의 공용
 * Skeleton으로 충분하다 — 새 admin Route를 추가할 때도 그대로 재사용하면 된다.
 */
export function AdminPageSkeleton() {
  return (
    <div className="p-8">
      <SkeletonBlock className="h-6 w-32" />
      <SkeletonBlock className="mt-2 h-4 w-96" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16" />
        ))}
      </div>
    </div>
  );
}
