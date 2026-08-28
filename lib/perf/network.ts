/**
 * 공통 성능 아키텍처 — Network-aware Prefetch(10번)에서 쓰는 최소 판단 함수.
 * Network Information API는 브라우저 지원이 불완전하므로(Safari 미지원 등)
 * 항상 progressive enhancement로 다룬다 — 지원하지 않으면 "느리지 않다"로
 * 간주해 기존처럼 동작한다(과도한 보수적 차단 금지).
 */
export function isSlowNetwork(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  const conn = nav.connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  if (conn.effectiveType && /2g/.test(conn.effectiveType)) return true;
  return false;
}
