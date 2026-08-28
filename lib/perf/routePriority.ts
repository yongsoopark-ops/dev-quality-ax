/**
 * 공통 성능 아키텍처 — Route Priority 체계(3번). 모든 Route를 무조건
 * prefetch하지 않기 위한 최소 분류다. 새 Route를 추가할 때 이 표에 한 줄만
 * 추가하면 SmartLink/IdlePrefetchBoot가 자동으로 그 우선순위를 따른다.
 *
 * HIGH: idle 시 미리 준비할 만큼 자주 쓰는 업무 Route.
 * NORMAL: 기본값 — Next의 기본 Link prefetch(뷰포트 진입 시 자동)에 맡긴다.
 * LOW: 저빈도(admin 등) — 뷰포트 자동 prefetch를 끄고, 실제 hover/focus
 *      의도가 보일 때만 prefetch한다(불필요한 admin 번들 선로딩 방지).
 */
export type RoutePriority = "high" | "normal" | "low";

const HIGH_PRIORITY_ROUTES = ["/home", "/schedule"];
const LOW_PRIORITY_PREFIXES = ["/admin"];

export function getRoutePriority(href: string): RoutePriority {
  if (HIGH_PRIORITY_ROUTES.includes(href)) return "high";
  if (LOW_PRIORITY_PREFIXES.some((prefix) => href.startsWith(prefix))) return "low";
  return "normal";
}

/** IdlePrefetchBoot가 idle 시 미리 준비할 대상. */
export function getIdlePrefetchRoutes(): string[] {
  return HIGH_PRIORITY_ROUTES;
}
