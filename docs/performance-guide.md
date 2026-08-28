# 신규 Route/기능 성능 가이드

전역 성능 구조 점검 Step에서 정리한, 앞으로 새 Route/기능을 만들 때 그대로
재사용할 수 있는 4가지 공통 패턴이다. 전부 지금 이미 코드에 있는 실제
구현을 그대로 가리킨다 — 이 문서만 보고도 어디를 베껴 쓰면 되는지 알 수
있게 하는 것이 목적이다.

## 1. Query 패턴 — 병렬화 + 목록은 얕게, 상세는 클릭 시에만

- 서로 의존하지 않는 조회는 항상 `Promise.all`로 묶는다. 예: [`app/(shell)/home/page.tsx`](../app/(shell)/home/page.tsx)의
  `[activeUsers, kpis, savedLayoutRow]`, [`app/(shell)/schedule/page.tsx`](../app/(shell)/schedule/page.tsx)의
  `[tasks, users, projectCategories]`.
- 목록/캘린더처럼 "한 화면에 여러 건"을 보여주는 초기 조회는 `select`로
  화면에 실제로 필요한 필드만 가져온다. 상세 화면에만 필요한 연관 데이터
  (전체 이력, Rich Text 본문 등)는 목록 조회에 절대 `include`하지 않는다.
- 상세/작성 이력처럼 "그 항목을 열었을 때만" 필요한 무거운 데이터는 Server
  Action으로 분리해 클릭 시점에만 불러온다. 이미 있는 예시:
  [`getTaskDetailAction`](../app/(shell)/schedule/actions.ts), [`getTaskCommentsAction`](../app/(shell)/schedule/actions.ts).
  새 상세 화면을 만들 때도 "목록 select" + "상세 전용 action" 두 개로
  나누는 걸 기본으로 삼는다.

## 2. Cache 헬퍼 — 변경 빈도가 아주 낮은 데이터만

[`lib/cache/memoCache.ts`](../lib/cache/memoCache.ts)의 `cached(key, ttlMs, fetcher)` /
`invalidateCache(key)`를 쓴다.

```ts
const rows = await cached("my-low-churn-key", 60_000, () =>
  prisma.someRarelyChangingTable.findMany(),
);
```

그 데이터를 저장/수정하는 Server Action 안에서 저장 직후 반드시
`invalidateCache("my-low-churn-key")`를 호출한다 — TTL은 "앱을 거치지 않은
변경"에 대한 안전망일 뿐, 정상 흐름에서는 저장 즉시 무효화되어야 한다.

**캐시해도 되는 것**: 관리자만 가끔 바꾸는 설정성 데이터(Sidebar/Dashboard
Layout, KPI 정의+결과, Project Category 등). 지금 캐시된 3가지:
`sidebar-layout-row`([`getRenderableSidebar.ts`](../lib/sidebar/getRenderableSidebar.ts)),
`dashboard-layout-row:HOME_KPI`([`home/page.tsx`](../app/(shell)/home/page.tsx)),
`kpi-definitions-with-results`([`home/page.tsx`](../app/(shell)/home/page.tsx)),
`project-categories`([`schedule/page.tsx`](../app/(shell)/schedule/page.tsx)).

**절대 캐시하면 안 되는 것**: User의 Role/Status(권한 판단), Presence
(lastActiveAt 등 실시간성 데이터), Comment/Reply/Revision/Notification/Task처럼
계속 바뀌는 실데이터, Auth 판단(`auth()` 자체는 손대지 않는다).

## 3. loading.tsx / Skeleton — 새 Route에는 항상 추가

DB 조회가 있는 Route는 반드시 같은 폴더에 `loading.tsx`를 둔다. 공용
컴포넌트를 그대로 재사용한다:

- [`components/ui/SkeletonBlock.tsx`](../components/ui/SkeletonBlock.tsx) — 옅은 펄스 블록 하나. `className`으로 크기만 맞추면 된다.
- [`components/ui/AdminPageSkeleton.tsx`](../components/ui/AdminPageSkeleton.tsx) — "제목 + 설명 + 목록" 구조인 admin류 Route에 그대로 재사용(현재 admin/kpi·sources·users·api-usage 4곳이 씀).
- `/home`, `/schedule`처럼 레이아웃이 특이한 Route는 그 Route 전용
  `loading.tsx`를 새로 만들되, 내부 블록은 SkeletonBlock을 조합해서 쓴다.

과도한 애니메이션(스피너, 강한 트랜지션)은 쓰지 않는다 — 옅은 `animate-pulse`만.

## 4. Lazy-detail 패턴 — 상세를 열 때만 불러오고, 실패 시 저장을 막는다

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

## 5. Shell 레벨 구조 — 참고만, 대부분 새 Route에서는 신경 쓸 필요 없음

모든 Route가 공유하는 [`app/(shell)/layout.tsx`](../app/(shell)/layout.tsx)는 `auth()`만 하고
바로 [`AppShell`](../components/AppShell.tsx)을 렌더링한다. Sidebar 데이터 조회
([`components/SidebarData.tsx`](../components/SidebarData.tsx))는 `<Suspense>`로 따로
분리되어 있어, 새 페이지의 `loading.tsx`가 Sidebar를 기다리지 않고 독립적으로
동작한다 — 새 Route를 추가할 때 이 구조 자체를 건드릴 일은 없다.

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
   맞춘다(서버 왕복 없음). 이 방식은 `pushState`가 아니므로 각 전환마다
   브라우저 히스토리 항목이 쌓이지 않는다 — 뒤로가기로 이전 달로 돌아가지는
   않는다(이전에는 `router.push`라 가능했던 동작). 새로고침/북마크/공유
   URL은 계속 정상 동작한다. 참고: [`PeriodSelector.tsx`](../components/period/PeriodSelector.tsx)의 `syncUrl`.

## 8. 무거운 Client 라이브러리는 next/dynamic으로 늦게 불러온다

모달/에디터처럼 "열어야만 쓰는" 무거운 Client 컴포넌트(Tiptap 같은 Rich
Text 에디터, 대형 차트 라이브러리 등)는 상위 파일에서 정적으로 `import`하지
않는다 — 조건부 렌더링(`{open && <Modal/>}`)만으로는 번들이 분리되지
않는다. `next/dynamic(() => import("./Modal"), { ssr: false })`로 감싸야
그 코드가 별도 chunk로 빠져 실제로 필요할 때만 다운로드된다. 실제 예시:
[`TaskDetailPanel.tsx`](../app/(shell)/schedule/TaskDetailPanel.tsx)의 `UpdateModal`
(Tiptap 포함 약 430KB가 /schedule 최초 로드에서 분리됨).

## 9. 성능 예산 (참고용 가이드, 절대 기준 아님)

새 기능을 만들 때 아래를 대략의 목표로 삼는다. 못 미친다고 무조건 다시
만들어야 하는 건 아니고, "이 정도면 이상하다"를 느끼기 위한 기준이다.

| 항목 | 목표 |
|---|---|
| 클릭 즉시 반응(버튼 disabled/skeleton 등) | 항상 즉시 |
| Warm 상태 단순 DB 조회 1건 | 200ms 미만 |
| 주요 Route의 Warm TTFB | 가능하면 500ms 미만 |
| 상세 Modal 오픈(Lazy Load 포함) | 300ms 미만 |
| 반복 방문/전환 | 가능한 한 cache(2번)/prefetch(기본 Link prefetch)로 왕복 자체를 없앰 |

## 참고: 검토했지만 이번 Step에서 하지 않은 것

- **admin/kpi의 `getPeriodHeaders` N회 호출(Source별)**: admin 전용 저빈도
  화면이라 손대지 않았다.
- **/schedule shell-first(Calendar를 데이터 없이 먼저 그리기)**: Calendar
  자체가 Task 데이터 없이는 의미 있게 그릴 게 없고(빈 격자만), Drag/Resize·
  Revision 등 절대 변경 금지 로직과 강하게 얽혀 있어 복잡도 대비 효과가
  낮다고 판단해 보류했다. 대신 `/schedule`는 이미 Route 단위 `loading.tsx`로
  클릭 즉시 반응은 확보되어 있다.
- **stale-while-revalidate(캐시된 값을 먼저 보여주고 뒤에서 갱신)**: Netlify
  서버리스 환경은 응답을 보낸 뒤의 백그라운드 작업 실행을 보장하지 않아,
  안전하게 구현하려면 오히려 더 복잡해진다. 지금의 "60초 TTL + 저장 즉시
  무효화" 조합이 사실상 같은 효과(대부분의 요청이 캐시 Hit)를 안전하게
  낸다고 보고 별도로 구현하지 않았다.
- **SWR/TanStack Query 같은 Client Cache 라이브러리 도입**: 반복 조회가
  많은 화면(Task 상세, 댓글, 월 KPI 등)은 이미 "목록 select + 상세
  Action + 3단계 Lazy-detail 상태"(4번 패턴)로 구조가 단순하게 해결되어
  있어, 새 dependency를 넣을 만큼의 이득이 확인되지 않았다.
- **Sidebar hover/focus 시 `router.prefetch()` 수동 호출**: 모든 주요
  Route(`/home`, `/schedule`, admin/*)에 이미 `loading.tsx`가 있어, Next
  기본 `<Link>` prefetch(뷰포트 진입 시 자동, 코드 변경 불필요)가 그
  loading 경계까지 미리 받아둔다. 중복 prefetch를 남발하지 않기 위해
  수동 prefetch는 추가하지 않았다.
