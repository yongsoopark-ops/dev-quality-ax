/**
 * 공통 성능 규칙(전역 구조 점검 Step) — loading.tsx/Suspense fallback에서
 * 반복되던 SkeletonBlock을 한 곳으로 모았다. 기존 home/schedule의 스타일
 * (옅은 펄스, 과도한 애니메이션 없음)을 그대로 유지한다.
 *
 * 새 Route에 loading.tsx를 추가할 때는 이 컴포넌트를 재사용해 형태만
 * className으로 맞추면 된다 — 자세한 사용 패턴은 docs/performance-guide.md 참고.
 */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-navy-100/60 ${className}`} />;
}
