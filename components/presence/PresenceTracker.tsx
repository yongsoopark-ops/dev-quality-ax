"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordActivity, updateHeartbeat } from "@/lib/presence/actions";

const HEARTBEAT_INTERVAL_MS = 60_000;
const ACTIVITY_THROTTLE_MS = 60_000;

/**
 * 로그인된 Shell 전체에 1회만 Mount한다 (AppShell). 페이지마다 따로 두지 않는다.
 * WebSocket/Redis 등 별도 Realtime 인프라 없이, 주기적 Server Action 호출만으로
 * "현재 사이트가 열려 있는지"(Heartbeat)와 "실제 활동이 있었는지"(Activity)를 구분해 기록한다.
 */
export function PresenceTracker() {
  const pathname = usePathname();
  const lastActivityCallRef = useRef(0);

  const triggerActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityCallRef.current < ACTIVITY_THROTTLE_MS) return;
    lastActivityCallRef.current = now;
    void recordActivity();
  }, []);

  // Mount 즉시 Heartbeat + Activity 1회, 이후 60초 간격 Heartbeat.
  // Heartbeat 자체는 lastActiveAt을 갱신하지 않는다 (recordActivity와 완전히 분리).
  useEffect(() => {
    void updateHeartbeat();
    triggerActivity();

    const interval = setInterval(() => {
      void updateHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [triggerActivity]);

  // 실제 Interaction만 감지한다 — mousemove/scroll 같은 고빈도 이벤트는 쓰지 않는다.
  useEffect(() => {
    function handleActivity() {
      triggerActivity();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        triggerActivity();
      }
    }

    window.addEventListener("pointerdown", handleActivity);
    window.addEventListener("keydown", handleActivity);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pointerdown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [triggerActivity]);

  // Route 이동도 Activity로 취급한다.
  useEffect(() => {
    triggerActivity();
  }, [pathname, triggerActivity]);

  return null;
}
