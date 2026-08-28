/**
 * 공통 캐시 헬퍼 — 전역 성능 구조 점검 Step에서 도입.
 *
 * 대상: 변경 빈도가 아주 낮고, 바뀌는 시점이 항상 특정 Server Action을 거치는
 * 데이터만 캐시한다(Sidebar/Dashboard Layout, KPI 정의+결과, Project Category 등).
 * 그 Action들이 저장 직후 invalidateCache로 즉시 무효화하므로, 정상 사용
 * 흐름에서는 캐시가 "낡은 값"을 보여주는 경우가 사실상 없다. TTL은 어디까지나
 * (DB를 직접 수정하는 등) 앱을 거치지 않은 변경에 대비한 안전망이다.
 *
 * 절대 캐시하지 않는 것: User의 Role/Status(권한 판단), Presence(lastActiveAt 등
 * 실시간성 데이터), Comment/Reply/Revision/Notification처럼 계속 바뀌는 데이터.
 * Auth 판단은 이 헬퍼와 무관하게 항상 DB에서 즉시 읽는다(변경 없음).
 *
 * 구현: lib/prisma.ts의 pg.Pool 재사용과 같은 성격의, Netlify Functions
 * "따뜻한" 컨테이너 프로세스 메모리에만 존재하는 Map이다. 콜드스타트나 다른
 * 동시 실행 인스턴스와는 공유되지 않는다 — 그래서 최악의 경우도 "캐시 미스로
 * DB를 한 번 더 읽는 것"일 뿐, 절대 목표를 벗어난 값을 반환하지 않는다.
 */

type Entry<T> = { value: T; expiresAt: number };

const globalForCache = globalThis as unknown as { __axMemoCache?: Map<string, Entry<unknown>> };
const store = globalForCache.__axMemoCache ?? new Map<string, Entry<unknown>>();
if (process.env.NODE_ENV !== "production") {
  globalForCache.__axMemoCache = store;
}

/** 캐시에 값이 있고 만료되지 않았으면 그대로 반환하고, 아니면 fetcher를 호출해 채운다. */
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** 저장 계열 Server Action에서, 값이 바뀐 직후 호출해 다음 조회부터 최신값이 나오게 한다. */
export function invalidateCache(key: string): void {
  store.delete(key);
}
