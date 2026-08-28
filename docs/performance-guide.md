# 개발품질 AX — Performance Architecture

특정 화면(Home/Schedule) 전용 기록이 아니라, **앞으로 추가되는 모든
Route/Tab/기능**이 별도 튜닝 없이 따라야 할 공통 성능 원칙과 그 실제
구현 위치를 정리한 문서다. 새 기능을 만들 때는 이 문서의 체크리스트(15번)
부터 확인한다.

## 1. Query 패턴 — 병렬화 + 목록은 얕게, 상세는 클릭 시에만

- 서로 의존하지 않는 조회는 항상 `Promise.all`로 묶는다. 예: [`app/(shell)/home/page.tsx`](../app/(shell)/home/page.tsx)의
  `[kpis, savedLayoutRow]`, [`app/(shell)/schedule/page.tsx`](../app/(shell)/schedule/page.tsx)의
  `[tasks, users, projectCategories]`.
- 목록/캘린더처럼 "한 화면에 여러 건"을 보여주는 초기 조회는 `select`로
  화면에 실제로 필요한 필드만 가져온다. 상세 화면에만 필요한 연관 데이터
  (전체 이력, Rich Text 본문 등)는 목록 조회에 절대 `include`하지 않는다.
- 상세/작성 이력처럼 "그 항목을 열었을 때만" 필요한 무거운 데이터는 Server
  Action으로 분리해 클릭 시점에만 불러온다. 이미 있는 예시:
  [`getTaskDetailAction`](../app/(shell)/schedule/actions.ts), [`getTaskCommentsAction`](../app/(shell)/schedule/actions.ts).
  새 상세 화면을 만들 때도 "목록 select" + "상세 전용 action" 두 개로
  나누는 걸 기본으로 삼는다.

## 2. 두 종류의 서버 캐시 — 혼동하지 말 것

**(a) 여러 Request에 걸친 TTL 캐시** — [`lib/cache/memoCache.ts`](../lib/cache/memoCache.ts)의
`cached(key, ttlMs, fetcher)` / `invalidateCache(key)`.

```ts
const rows = await cached("my-low-churn-key", 60_000, () =>
  prisma.someRarelyChangingTable.findMany(),
);
```

그 데이터를 저장/수정하는 Server Action 안에서 저장 직후 반드시
`invalidateCache("my-low-churn-key")`를 호출한다(자세한 규칙은 10번).

**(b) 한 Request 안에서만 유효한 중복 제거** — [`lib/cache/requestMemo.ts`](../lib/cache/requestMemo.ts)의
`requestMemo(fn)`(React `cache()` 얇은 wrapper). 같은 Request 안에서 여러
Server Component/Action이 같은 인자로 같은 함수를 불러도 실제 조회는 1번만
나간다. 예: [`getRenderableSidebar`](../lib/sidebar/getRenderableSidebar.ts).
Request가 끝나면 자동으로 사라진다 — TTL/무효화를 신경 쓸 필요가 없다.

**캐시해도 되는 것((a)/(b) 공통)**: 관리자만 가끔 바꾸는 설정성 데이터
(Sidebar/Dashboard Layout, KPI 정의+결과, Project Category 등). 지금 (a)로
캐시된 4가지: `sidebar-layout-row`, `dashboard-layout-row:HOME_KPI`,
`kpi-definitions-with-results`, `project-categories`(전부 10번 표에 무효화
위치까지 정리).

**절대 캐시하면 안 되는 것**: User의 Role/Status(권한 판단), Presence
(lastActiveAt 등 실시간성 데이터), Comment/Reply/Revision/Notification/Task처럼
계속 바뀌는 실데이터, Auth 판단(`auth()` 자체는 손대지 않는다 — 3번).

## 3. Auth — 중복 조회 확인, 정책은 무변경

NextAuth v5의 `auth()`는 React `cache()`로 이미 request-memoized되어
있다(같은 Request 안에서 여러 번 불러도 내부적으로 한 번만 계산). 이번
전역 점검에서 `(shell)/layout.tsx`, `admin/layout.tsx`, 각 page.tsx가
각자 `auth()`를 부르는 곳을 확인했지만 실제 중복 DB 조회는 없었다 — 그래서
Auth 관련 코드는 손대지 않았다(권한 판단 로직은 항상 즉시 조회, 캐시 금지
원칙 그대로).

## 4. loading.tsx / Skeleton — 새 Route에는 항상 추가

DB 조회가 있는 Route는 반드시 같은 폴더에 `loading.tsx`를 둔다. 공용
컴포넌트를 그대로 재사용한다:

- [`components/ui/SkeletonBlock.tsx`](../components/ui/SkeletonBlock.tsx) — 옅은 펄스 블록 하나. `className`으로 크기만 맞추면 된다.
- [`components/ui/AdminPageSkeleton.tsx`](../components/ui/AdminPageSkeleton.tsx) — "제목 + 설명 + 목록" 구조인 admin류 Route에 그대로 재사용(현재 admin/kpi·sources·users·api-usage 4곳이 씀).
- [`components/SidebarSkeleton.tsx`](../components/SidebarSkeleton.tsx) — Sidebar 전용(5번 Suspense 경계의 fallback).
- `/home`, `/schedule`처럼 레이아웃이 특이한 Route는 그 Route 전용
  `loading.tsx`를 새로 만들되, 내부 블록은 SkeletonBlock을 조합해서 쓴다.

과도한 애니메이션(스피너, 강한 트랜지션)은 쓰지 않는다 — 옅은 `animate-pulse`만.
3개 Skeleton은 전부 SkeletonBlock을 조합해 만든 것이라 서로 중복되지 않는다.

## 5. Shell 레벨 구조 — 참고만, 대부분 새 Route에서는 신경 쓸 필요 없음

모든 Route가 공유하는 [`app/(shell)/layout.tsx`](../app/(shell)/layout.tsx)는 `auth()`만 하고
바로 [`AppShell`](../components/AppShell.tsx)을 렌더링한다. Sidebar 데이터 조회
([`components/SidebarData.tsx`](../components/SidebarData.tsx))는 `<Suspense>`로 따로
분리되어 있어, 새 페이지의 `loading.tsx`가 Sidebar를 기다리지 않고 독립적으로
동작한다. `AppShell`은 App Router의 Layout Persistence 덕분에 Route 이동 간
remount되지 않는다 — Sidebar/PresenceTracker/NotificationBell/IdlePrefetchBoot는
세션당(정확히는 Shell을 벗어나지 않는 한) 한 번만 mount된다. 새 Route를
추가할 때 이 구조 자체를 건드릴 일은 없다.

## 6. Section별 Suspense — 서로 독립적인 영역은 각자 스트리밍

한 페이지 안에 서로 의존하지 않는 여러 영역(KPI/Presence/API 사용료처럼)이
있으면, 하나의 async 함수가 전부 기다렸다가 한 번에 반환하지 않는다. 대신
영역별로 작은 async Server Component를 만들고 각자 `<Suspense>`로 감싼다.
실제 예시: [`app/(shell)/home/page.tsx`](../app/(shell)/home/page.tsx)의
`HomePresenceSection`/`HomeApiUsageSection` — 둘 다 필요로 하는 `activeUsers`는
Promise를 딱 한 번만 만들어 두 Section에 그대로 넘긴다(각자 `await`해도
실제 조회는 1번만 나간다, 중복 쿼리 아님).

```tsx
async function SomeSection({ data }: { data: Promise<X[]> }) {
  const rows = await data;
  return <View rows={rows} />;
}
// page.tsx: const dataPromise = prisma.x.findMany(...); // await하지 않고 그대로 전달
<Suspense fallback={<SkeletonBlock .../>}><SomeSection data={dataPromise} /></Suspense>
```

**Route Shell 구조 권장 형태** — 새 Route를 만들 때 이 모양을 기본으로 삼는다:

```
Route Shell (즉시 렌더되는 부분: 제목/Toolbar/Filter 등)
 ├─ Suspense: 영역 A (독립 데이터)
 ├─ Suspense: 영역 B (독립 데이터)
 └─ Suspense: 영역 C (독립 데이터)
```
"페이지 전체를 감싸는 loading.tsx 하나"만으로 끝내지 말고, 영역이 여러 개면
쪼갤 수 있는지 먼저 검토한다(단 하나뿐이면 그냥 loading.tsx로 충분 —
불필요한 Suspense 중첩은 만들지 않는다, 15번 "과도한 최적화 금지").

## 7. 부분 갱신(partial refresh) — 탭/필터/기간 전환에 router.push를 쓰지 않는다

버튼/탭/기간 전환처럼 "화면 shell은 그대로 두고 일부 데이터만 바뀌면 되는"
상호작용에는 `router.push`/`router.replace`를 쓰지 않는다 — App Router에서는
둘 다 항상 서버에 현재 Route 전체를 다시 요청한다(Pages Router 시절의 Shallow
Routing이 없다). 대신:

1. 그 데이터를 채우는 Server Component 로직을 별도 함수로 뽑는다
   (예: [`lib/home/computeKpiCards.ts`](../lib/home/computeKpiCards.ts) — 초기 렌더와
   재조회 Action이 이 함수 하나를 공유해 절대 로직이 갈라지지 않는다).
2. 그 함수를 감싼 Server Action을 만든다
   (예: [`getHomeKpiCardsAction`](../app/(shell)/home/actions.ts)).
3. 상호작용을 소유하는 Client Component가 상태(예: `period`)와 결과
   (예: `cards`)를 직접 들고, 전환 시 Server Action만 호출해 그 상태만
   바꾼다 — 무관한 영역(Sidebar/Layout/User 등)은 전혀 다시 조회되지 않는다.
   실제 예시: [`HomeDashboard.tsx`](../components/dashboard/HomeDashboard.tsx)의 `handlePeriodChange`.
4. URL에 그 상태를 반영해야 하면 `window.history.replaceState`로 주소창만
   맞춘다(서버 왕복 없음). `pushState`가 아니므로 전환마다 브라우저 히스토리
   항목이 쌓이지 않는다 — 뒤로가기로 이전 상태(예: 이전 달)로는 돌아가지
   않는다는 뜻이다(트레이드오프, 13번 참고). 새로고침/북마크/공유 URL은
   계속 정상 동작한다. 참고: [`PeriodSelector.tsx`](../components/period/PeriodSelector.tsx)의 `syncUrl`.
5. **Previous/Next 선조회(있으면 더 좋음)**: 기간/페이지/탭 기반 화면이라면
   현재 값의 인접 값(N-1/N+1)을 idle 시 미리 불러와 Client 쪽 Map에 담아둔다.
   실제 예시: [`HomeDashboard.tsx`](../components/dashboard/HomeDashboard.tsx)의
   `kpiCacheRef` + 인접 월 prefetch effect, [`lib/period.ts`](../lib/period.ts)의
   `getAdjacentMonthPeriod`/`periodKey`. 캐시에는 반드시 만료 시간을 둔다
   (여기서는 5분 — `ADJACENT_CACHE_TTL_MS`) — 관리자가 그사이 데이터를 바꿔도
   무한정 낡은 값을 보여주지 않기 위한 안전망이다.

## 8. Navigation / Prefetch Architecture

**기본 원칙**: 내부 이동은 절대 `window.location`/hard reload를 쓰지 않는다
(전체 검색 결과 현재 위반 사례 없음). `<Link>`(또는 아래 `SmartLink`)를
쓰고, `router.push`는 실제로 "다른 화면으로 이동"할 때만 쓴다(같은 화면 안
데이터 갱신에는 7번 부분 갱신 패턴을 쓴다).

**Route Priority** — [`lib/perf/routePriority.ts`](../lib/perf/routePriority.ts)에
Route별 우선순위를 정의한다. 새 Route를 추가하면 이 파일에 한 줄만
추가하면 된다.

| 등급 | 대상(현재) | 동작 |
|---|---|---|
| HIGH | `/home`, `/schedule` | 뷰포트 자동 prefetch(Next 기본) + Shell 최초 mount 시 idle prefetch(9번) |
| NORMAL(기본값) | 그 외 전부(`/chat` 등) | Next 기본 Link prefetch(뷰포트 진입 시 자동)에 맡김 |
| LOW | `/admin/*` | 자동 prefetch를 끄고, hover/focus/touchstart 의도가 보일 때만 prefetch(불필요한 admin 번들 선로딩 방지) |

**SmartLink** — [`components/nav/SmartLink.tsx`](../components/nav/SmartLink.tsx). 일반
`<Link>`를 대체할 수 있는 공통 Link다. HIGH/NORMAL은 그냥 `<Link>`와
동일하게 동작하고(불필요한 추가 로직 없음), LOW만 `prefetch={false}` +
의도 기반 prefetch로 바꾼다. 적용 예: [`components/Sidebar.tsx`](../components/Sidebar.tsx)의
모든 메뉴 Link. 새 Sidebar 메뉴/Nav Link는 `<Link>` 대신 이걸 쓴다.

**Intent-based Prefetch(hover/focus/touchstart)** — [`hooks/usePrefetchOnIntent.ts`](../hooks/usePrefetchOnIntent.ts).
Route 이동뿐 아니라 "Link가 아닌" 상호작용(Modal 열기 버튼 등)에도 쓸 수
있는 범용 Hook이다. 한 번만 실행되고(중복 방지), 느린 네트워크에서는
아무것도 하지 않는다(10번). 적용 예:
- SmartLink 내부(LOW 우선순위 Route의 `router.prefetch`).
- [`TaskDetailPanel.tsx`](../app/(shell)/schedule/TaskDetailPanel.tsx)의 "업데이트" 버튼 — hover/focus 시
  `UpdateModal`(Tiptap) chunk를 미리 받아둔다(14번과 연결).

**Idle Prefetch** — [`components/nav/IdlePrefetchBoot.tsx`](../components/nav/IdlePrefetchBoot.tsx).
`AppShell`에 한 번만 mount되어(5번 Layout Persistence), 첫 렌더가 끝난 뒤
`requestIdleCallback`(폴백: `setTimeout`)으로 HIGH 우선순위 Route만
`router.prefetch()`한다. 느린 네트워크에서는 아무것도 하지 않는다.

**Network-aware** — [`lib/perf/network.ts`](../lib/perf/network.ts)의 `isSlowNetwork()`.
`navigator.connection.saveData`/`effectiveType`(2G류)일 때 `true`. Network
Information API는 브라우저 지원이 불완전해 항상 progressive enhancement로
쓴다(지원 안 하면 그냥 "느리지 않다"로 보고 기존처럼 동작 — 안전한 기본값).

## 9. Heavy Component Lazy Loading / Preload

**Lazy Loading** — 모달/에디터처럼 "열어야만 쓰는" 무거운 Client
컴포넌트(Tiptap 같은 Rich Text 에디터, 대형 차트/Calendar 라이브러리 등)는
상위 파일에서 정적으로 `import`하지 않는다 — 조건부 렌더링(`{open && <Modal/>}`)만으로는
번들이 분리되지 않는다. `next/dynamic(() => import("./Modal"), { ssr: false })`로
감싸야 그 코드가 별도 chunk로 빠져 실제로 필요할 때만 다운로드된다. 실제
예시: [`TaskDetailPanel.tsx`](../app/(shell)/schedule/TaskDetailPanel.tsx)의 `UpdateModal`
(Tiptap 포함 약 435KB가 `/schedule` 최초 로드에서 분리됨). `react-big-calendar`
(Calendar/DnD)는 이미 `/schedule` 폴더 안에서만 import되어 다른 Route
번들에 섞이지 않음을 확인했다(추가 조치 불필요).

**Preload(첫 클릭이 느려지지 않게)** — Lazy Loading만 하면 첫 클릭이 chunk
다운로드를 기다려야 해서 느려질 수 있다. 8번의 `usePrefetchOnIntent`로
hover/focus 시점에 미리 `import()`해 둔다:

```tsx
const preload = usePrefetchOnIntent(() => { import("./HeavyModal"); });
<button onClick={openModal} onMouseEnter={preload.onMouseEnter} onFocus={preload.onFocus} onTouchStart={preload.onTouchStart}>
```

같은 패턴을 다른 Modal/Editor에도 그대로 재사용한다(예시: UpdateModal 버튼).

## 10. Cache Invalidation 규칙 (mutation → invalidate 대응표)

새 캐시를 만들 때 이 표에 한 줄을 추가하고, 그 mutation Server Action
안에서 실제로 `invalidateCache(...)`를 호출했는지 반드시 확인한다 —
캐시만 만들고 무효화를 빼먹는 것을 막기 위한 체크리스트다.

| 캐시 키 | 무효화 위치 |
|---|---|
| `sidebar-layout-row` | [`saveSidebarLayout`](../lib/sidebar/actions.ts) |
| `dashboard-layout-row:HOME_KPI` | [`saveDashboardLayout`](../lib/dashboardLayout/actions.ts) |
| `kpi-definitions-with-results` | [`recalculateKpi`](../lib/kpiEngine.ts)(생성/수정/동기화 재계산 전부 여기로 모임), [`toggleKpiEnabledAction`](../app/(shell)/admin/kpi/actions.ts), [`deleteKpiAction`](../app/(shell)/admin/kpi/actions.ts) |
| `project-categories` | [`createProjectCategoryAction`/`removeProjectCategoryAction`/`toggleProjectCategoryActiveAction`](../app/(shell)/schedule/actions.ts) |

**Cache Key Naming** — 지금까지의 키는 `scope-with-dashes` 형태다(이미
동작 중이라 굳이 바꾸지 않는다 — 불필요한 churn 방지). **앞으로 새로
추가하는 캐시 키는** `domain:scope[:id]` 형태를 쓴다(예: `kpi:definitions`,
`schedule:categories`). **사용자별로 다른 값을 캐시해야 한다면 반드시
`userId`(또는 role/권한 scope)를 키에 포함한다** — 예: `home:layout:${userId}`.
Cross-user 데이터가 같은 키로 섞이면 안 된다(현재 4개 캐시는 전부 사용자
공통 설정 데이터라 userId가 필요 없다).

## 11. Client-side 캐시/재조회에 대한 판단 (SWR/TanStack 도입하지 않음)

검토 결과 **도입하지 않는다.** 이유:
- Task 상세/댓글은 이미 "목록 select + 상세 Action + 3단계 Lazy-detail
  상태"(13번)로 구조가 단순하게 해결되어 있다.
- Home 월 KPI는 7번의 부분 갱신 + 인접 선조회로, 새 라이브러리 없이
  "재방문 시 즉시 표시"를 이미 달성한다.
- 특정 화면 하나를 위해 전체 앱에 새 dependency를 추가하지 않는다(과도한
  최적화 금지 원칙, 15번).

**stale-while-revalidate(서버 쪽)**: Netlify 서버리스는 응답을 보낸 뒤의
백그라운드 작업 실행을 보장하지 않아, 안전하게 구현하려면 오히려 더
복잡해진다. 지금의 "60초 TTL + 저장 즉시 무효화"(2번) 조합이 사실상 같은
효과(대부분의 요청이 캐시 Hit)를 안전하게 낸다고 보고 구현하지 않았다.

**Next Router Cache 튜닝(`experimental.staleTimes`)**: 뒤로가기/반복
네비게이션을 더 빠르게 만들 수 있는 설정이 Next에 있지만, 이 값을 올리면
다른 사용자의 동시 변경(Task 수정 등)이 그 시간만큼 늦게 보일 수 있다 —
이 앱은 아직 사용자가 적어 위험이 낮지만, "성능을 이유로 기능 의미를
바꾸지 않는다"는 원칙에 따라 이번 Step에서는 적용하지 않고 후보로만
남긴다.

## 12. Lazy-detail 패턴 — 상세를 열 때만 불러오고, 실패 시 저장을 막는다

목록에는 없는 "가벼운 값"으로 상세 폼을 먼저 채워두고, 상세를 여는 순간
무거운 진짜 값을 따로 불러와 덮어쓰는 화면(Task 상세, Update Modal 댓글
등)을 새로 만들 때는 **boolean `loading` 플래그를 쓰지 않는다.** 목록의
가벼운 값 중 일부가 폼에서 그대로 저장 가능한 필드와 겹치면, "불러오기
실패 후에도 loading=false가 되어 저장 가능 상태로 보이는" 사고가 날 수
있다(가벼운 자리값으로 실데이터를 덮어쓰게 됨).

대신 3단계 상태를 쓴다 — 지금 실제로 쓰는 패턴:
[`TaskDetailPanel.tsx`](../app/(shell)/schedule/TaskDetailPanel.tsx)의 `detailStatus`.

```ts
type DetailStatus = "loading" | "ready" | "error";
// 저장 버튼: disabled={saving || detailStatus !== "ready"}
// "ready"는 fetch가 실제로 성공했을 때만, "error"는 실패 시 별도로 설정 —
// 절대 finally에서 무조건 "ready"/loading=false로 되돌리지 않는다.
```

댓글/리스트처럼 "모달을 열 때만" 불러오는 데이터는 `loaded` 플래그 +
`loading`/`error` 조합으로 충분하다(저장 가능 여부와 무관한 경우).
Update Modal의 [`UpdateModal.tsx`](../app/(shell)/schedule/UpdateModal.tsx) 참고.

## 13. Optimistic UI / Back-Forward — 새로 만들지 않고 기존 조합에 맡긴다

**Optimistic Navigation**: 별도 메커니즘을 새로 만들지 않았다 — 8번(prefetch)
+ 4번(loading.tsx/Suspense) 조합만으로 "클릭 즉시 반응"이 이미 충분히
달성된다고 판단했다(안전한 값을 미리 두고 실패 시 롤백하는 진짜 Optimistic
Mutation은 위험도가 있어 Task 삭제/Revision 같은 민감한 mutation에는 여전히
적용하지 않는다 — 원문 절대 금지 항목).

**Back/Forward**: 브라우저 자체 caching(bfcache 등)과 Next 기본 동작에
맡긴다. 7번에서 언급했듯 `history.replaceState`를 쓰는 부분 갱신은 뒤로가기
히스토리에 단계별로 남지 않는다는 트레이드오프가 있고, 이는 의도된
선택이다(11번에서 다룬 Router Cache 튜닝 후보와 함께 향후 재검토 가능).

## 14. Server/Client Bundle Isolation

도메인별 무거운 dependency(Google Sheets API, Tiptap, react-big-calendar
등)가 다른 Route의 번들에 섞이지 않게 하는 원칙:
- Google Sheets/W2·W3·W4 관련 코드(`lib/googleSheets.ts`, `lib/googleSheetSync.ts`,
  `lib/sheetAutomation/**`)는 `admin/sources`, `sheets` Route의 Server
  Action에서만 import한다 — 확인 결과 Home/Schedule 어디서도 import하지
  않는다.
- Tiptap은 9번처럼 `next/dynamic`으로 분리한다.
- `react-big-calendar`/DnD addon은 `/schedule` 폴더 밖에서 import하지 않는다.
- 새 도메인(예: 향후 리포트/차트 기능)을 추가할 때도 이 원칙을 그대로
  적용한다 — "이 기능에서만 쓰는 무거운 라이브러리는 이 기능의 파일에서만
  import한다."

## 15. 새 Route/기능 체크리스트

새 탭/기능을 만들 때 최소한 아래를 확인한다:

- [ ] `<Link>`(또는 [`SmartLink`](../components/nav/SmartLink.tsx))로 이동하는가? (`router.push`/hard reload 아님)
- [ ] Route 우선순위가 필요하면 [`routePriority.ts`](../lib/perf/routePriority.ts)에 추가했는가?
- [ ] `loading.tsx` 또는 Suspense 경계가 있는가?
- [ ] 목록 조회가 `select`로 얕은가? (필요 없는 관계 `include` 없음)
- [ ] 상세는 클릭 시에만 불러오는가?(Lazy-detail, 12번)
- [ ] 무거운 Client 컴포넌트는 `next/dynamic`인가?(9번)
- [ ] 그 무거운 컴포넌트를 열기 전 hover/focus preload가 필요한가?
- [ ] 캐시 가능한 저빈도 데이터인가? 캐시했다면 mutation에서 invalidate했는가?(10번)
- [ ] 탭/필터/기간 전환이 전체 Route를 다시 요청하지 않는가?(부분 갱신, 7번)
- [ ] 인접 값(이전/다음) 선조회가 가치 있는가?(7번 5항)
- [ ] `auth()`/User 조회를 같은 요청 안에서 중복 호출하지 않는가?(3번)

## 16. 성능 예산 (참고용 가이드, 절대 기준 아님)

새 기능을 만들 때 아래를 대략의 목표로 삼는다. 못 미친다고 무조건 다시
만들어야 하는 건 아니고, "이 정도면 이상하다"를 느끼기 위한 기준이다.

| 항목 | 목표 |
|---|---|
| 클릭 즉시 반응(버튼 disabled/skeleton 등) | 항상 즉시 |
| 캐시/prefetch된 재방문 | 체감 즉시 |
| Warm 상태 단순 DB 조회 1건 | 200ms 미만 |
| 주요 Route의 Warm TTFB | 가능하면 500ms 미만 |
| 상세 Modal 오픈(Lazy Load/prefetch 포함) | 캐시/prefetch됐다면 즉시, 아니면 300ms 안팎 |
| 반복 방문/전환 | 가능한 한 cache(2번)/prefetch(8번)로 왕복 자체를 없앰 |

빌드를 막는 절대 threshold는 아직 없다 — 개발 가이드로만 쓴다.

## 17. Performance Observability(개발 전용)

[`lib/perf/timing.ts`](../lib/perf/timing.ts)의 `withTiming(label, fn)` —
개발 환경에서만 소요 시간을 `console.debug`로 남기고, Production에서는
아무 것도 하지 않는다(로그 완전히 없음). label 외의 값(DB URL/Secret/개인
데이터)은 절대 로그하지 않는다. 사용 예: [`home/page.tsx`](../app/(shell)/home/page.tsx)의
`withTiming("home:computeKpiCards", ...)`. 새로 느려진 곳을 의심할 때
이 패턴으로 감싸 확인하고, 확인이 끝나면 유지해도 되고 지워도 된다(Production
영향이 없으므로 필수는 아니다).

## 18. 검토했지만 적용하지 않은 것 (이유 포함)

- **admin/kpi의 `getPeriodHeaders` N회 호출(Source별)**: admin 전용 저빈도
  화면이라 손대지 않았다.
- **/schedule shell-first(Calendar를 데이터 없이 먼저 그리기)**: Calendar
  자체가 Task 데이터 없이는 의미 있게 그릴 게 없고(빈 격자만), Drag/Resize·
  Revision 등 절대 변경 금지 로직과 강하게 얽혀 있어 복잡도 대비 효과가
  낮다고 판단해 보류했다. 대신 `/schedule`는 이미 Route 단위 `loading.tsx`로
  클릭 즉시 반응은 확보되어 있다.
- **SWR/TanStack Query 도입**: 11번 참고 — 새 dependency 없이 이미 목표를
  달성한다고 판단.
- **서버 stale-while-revalidate**: 11번 참고 — Netlify 서버리스 제약.
- **Next `staleTimes`(Router Cache) 튜닝**: 11번 참고 — 다중 사용자 데이터
  신선도 트레이드오프를 이번 Step에서는 감수하지 않기로 함(후보로 남김).
- **모든 Sidebar Link에 강제 hover-prefetch**: HIGH/NORMAL Route는 Next
  기본 뷰포트 prefetch로 이미 충분(Sidebar는 항상 화면에 보여 사실상 즉시
  자동 prefetch된다) — 여기에 추가 로직을 얹는 건 중복이라 하지 않았다.
  LOW(admin)만 SmartLink로 의도 기반 prefetch를 켰다.
