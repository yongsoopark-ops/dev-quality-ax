"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { usePrefetchOnIntent } from "@/hooks/usePrefetchOnIntent";
import { getRoutePriority, type RoutePriority } from "@/lib/perf/routePriority";

/**
 * 공통 성능 아키텍처 — Navigation Architecture(2번)의 기본 Link. 일반
 * `<Link>`를 그대로 대체할 수 있다(같은 props, 같은 렌더링 결과).
 *
 * - HIGH/NORMAL 우선순위 Route는 그냥 `<Link>`에 맡긴다 — Next가 이미
 *   뷰포트 진입 시 자동으로 prefetch한다(추가 로직 불필요, 중복 prefetch
 *   방지 원칙).
 * - LOW 우선순위 Route(현재 기준 /admin/*)만 `prefetch={false}`로 자동
 *   prefetch를 끄고, 대신 hover/focus/touchstart 의도가 보일 때만
 *   `router.prefetch()`한다 — 모든 사용자에게 저빈도 admin 번들을 미리
 *   내려주지 않으면서도, 실제 클릭 직전에는 빠르게 열리게 한다.
 *
 * 우선순위는 `priority` prop으로 강제 지정할 수도 있다(lib/perf/routePriority.ts
 * 기본 규칙과 다르게 쓰고 싶을 때만).
 */
export function SmartLink({
  href,
  priority,
  ...rest
}: ComponentProps<typeof Link> & { priority?: RoutePriority }) {
  const router = useRouter();
  const hrefStr = typeof href === "string" ? href : (href.pathname ?? "");
  const resolved = priority ?? getRoutePriority(hrefStr);

  const intent = usePrefetchOnIntent(() => router.prefetch(hrefStr), resolved === "low");

  if (resolved !== "low") {
    return <Link href={href} {...rest} />;
  }

  return <Link href={href} prefetch={false} onMouseEnter={intent.onMouseEnter} onFocus={intent.onFocus} onTouchStart={intent.onTouchStart} {...rest} />;
}
