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

## 참고: 지금은 하지 않은 것 (다음에 고려할 후보)

- `/home`의 월(Period) 이동은 여전히 `router.push`로 전체 페이지를 다시
  요청한다(캐시 덕분에 `kpis`/`dashboardLayout` 왕복은 사라졌지만
  `activeUsers`는 여전히 매번 새로 조회됨). 완전한 클라이언트 상태 전환 +
  Server Action 방식으로 바꾸면 더 빨라지지만, URL 공유/뒤로가기 동작이
  바뀌므로 이번 Step 범위(최소 리팩터링)에서는 보류했다.
- admin/kpi 페이지의 `getPeriodHeaders` N회 호출(Source별)은 admin 전용
  저빈도 화면이라 이번 Step에서는 손대지 않았다.
