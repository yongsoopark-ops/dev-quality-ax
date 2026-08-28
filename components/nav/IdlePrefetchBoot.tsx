"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSlowNetwork } from "@/lib/perf/network";
import { getIdlePrefetchRoutes } from "@/lib/perf/routePriority";

/**
 * 공통 성능 아키텍처 — Idle Prefetch(9번). 첫 화면 렌더가 끝난 뒤 브라우저가
 * 한가할 때 HIGH 우선순위 Route(lib/perf/routePriority.ts)만 미리
 * prefetch한다. AppShell에 한 번만 마운트한다(레이아웃이 Route 이동 간
 * 유지되므로 매 네비게이션마다 다시 실행되지 않는다 — 20번 Layout
 * Persistence와 같은 이유).
 *
 * - `requestIdleCallback`이 없는 환경(Safari 등)은 `setTimeout`으로
 *   대체한다(progressive enhancement).
 * - saveData/2G 등 느린 네트워크에서는 아무것도 하지 않는다.
 * - 현재 렌더링을 방해하지 않도록 idle 콜백 안에서만 동작한다.
 */
export function IdlePrefetchBoot() {
  const router = useRouter();

  useEffect(() => {
    if (isSlowNetwork()) return;

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const run = () => {
      for (const route of getIdlePrefetchRoutes()) {
        router.prefetch(route);
      }
    };

    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(run);
      return () => win.cancelIdleCallback?.(id);
    }

    const timeoutId = setTimeout(run, 1500);
    return () => clearTimeout(timeoutId);
  }, [router]);

  return null;
}
