import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Step(V1 코드 건강도 / 안정화 점검) — 이 프로젝트는 UI E2E나 dev 서버 기동
 * 없이 순수 로직만 빠르게 검증하는 회귀 테스트가 없었다. tsconfig.json의
 * "@/*" alias를 그대로 인식하도록 최소 설정만 추가한다 — Next.js
 * 설정(next.config.mjs)이나 실행 스크립트는 전혀 건드리지 않는다.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
});
