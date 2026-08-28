"use client";

import { useRef } from "react";
import { isSlowNetwork } from "@/lib/perf/network";

/**
 * 공통 성능 아키텍처 — Intent-based Prefetch(8번)의 단일 진입점. Route
 * 이동(SmartLink)뿐 아니라 Modal/Editor 같은 무거운 Client 컴포넌트의 JS
 * chunk 선로딩(15번, 예: `() => import("./UpdateModal")`)에도 그대로
 * 재사용한다 — 두 경우 모두 "사용자가 클릭하기 직전 의도를 보였을 때 한 번만
 * 미리 준비한다"는 동일한 패턴이기 때문이다.
 *
 * - mouseenter/focus/touchstart 중 가장 먼저 오는 신호에 한 번만 실행한다
 *   (같은 세션 안에서 중복 호출 없음).
 * - saveData/2G 같은 느린 네트워크에서는 실행하지 않는다(10번, progressive
 *   enhancement — 지원 안 되는 브라우저에서는 항상 정상 동작).
 * - loader 자체의 성공/실패를 신경 쓰지 않는다 — 어차피 "미리 준비"일 뿐,
 *   진짜 필요한 시점(클릭)에 다시 정상 경로로 로드/조회된다.
 */
export function usePrefetchOnIntent(loader: () => void, enabled = true) {
  const firedRef = useRef(false);

  function trigger() {
    if (!enabled || firedRef.current) return;
    if (isSlowNetwork()) return;
    firedRef.current = true;
    try {
      loader();
    } catch {
      // 선로딩 실패는 조용히 무시한다 — 실제 클릭 시 정상 경로로 다시 시도된다.
      firedRef.current = false;
    }
  }

  return {
    onMouseEnter: trigger,
    onFocus: trigger,
    onTouchStart: trigger,
  };
}
