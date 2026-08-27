"use client";

import { useEffect, useRef, useState } from "react";

export interface ContainerSize {
  width: number;
  height: number;
}

const ZERO_SIZE: ContainerSize = { width: 0, height: 0 };

/**
 * DOM 요소에 붙인 Ref의 실제 렌더링 크기를 ResizeObserver로 측정하는 공통 Hook.
 * Chart Component마다 개별적으로 ResizeObserver를 구현하지 않도록, 크기가 필요한
 * 곳(KpiCard 등)에서 이 Hook 하나만 쓰면 된다.
 *
 * Ref를 아무 요소에도 연결하지 않으면(예: Dashboard Grid 밖의 KPI Builder 미리보기처럼
 * Container 크기를 잴 필요가 없는 곳) width/height가 계속 0으로 유지되어, 호출부가
 * "측정 안 됨 → 기존 Default 크기로 fallback" 처리를 하기 쉽다.
 *
 * Resize 중 매 Frame 과도한 React State 갱신을 막기 위해 requestAnimationFrame으로
 * 한 Frame당 최대 1회만 반영한다.
 */
export function useContainerSize<T extends HTMLElement>(): [React.RefObject<T | null>, ContainerSize] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ContainerSize>(ZERO_SIZE);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;

      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      });
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return [ref, size];
}
