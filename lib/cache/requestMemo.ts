import { cache } from "react";

/**
 * 공통 성능 아키텍처 — Request-level Deduplication(17번).
 *
 * `lib/cache/memoCache.ts`(cached/invalidateCache)와 역할이 다르다:
 * - memoCache = "여러 Request에 걸쳐" 재사용(TTL, 서버 프로세스 메모리).
 * - requestMemo(이 파일) = "지금 이 한 번의 Server Render/Request 안에서만"
 *   재사용(React가 Request 끝나면 자동으로 버림). 같은 함수를 여러 Server
 *   Component/Action이 같은 인자로 부르면 실제 DB 조회는 1번만 나간다.
 *
 * 둘을 같은 곳에 겹쳐 써도 안전하다 — requestMemo는 그 요청 안의 중복만
 * 없애고, memoCache는 그다음 요청부터의 중복을 없앤다.
 *
 * 사용 예:
 *   export const getCurrentUserRow = requestMemo((id: string) =>
 *     prisma.user.findUnique({ where: { id } }),
 *   );
 */
export function requestMemo<Args extends unknown[], T>(fn: (...args: Args) => Promise<T>) {
  return cache(fn);
}
