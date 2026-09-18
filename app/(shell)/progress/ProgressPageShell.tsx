/**
 * 진행 현황 페이지 공용 레이아웃 — Claude Design ZIP("진행 현황 관리판
 * v2.dc.html")의 &lt;main&gt; 값을 그대로 옮긴다: `padding: 26px 30px 72px`,
 * 자식 Section 간 `gap: 18px`. UI 정합성 재작업 요청(§최상위 기준)에 따라
 * 이 화면은 설비 관리 등 기존 AX 화면의 여백 값(px-8/gap-6)을 따르지 않고
 * Design 값을 그대로 쓴다 — AppShell/Sidebar/Auth/공통 Color·Font token만
 * 재사용 대상이고, 콘텐츠 내부 여백은 Design이 기준이다.
 *
 * max-width — Design은 1440~1920px 기준으로 짜여 있어, 그 이상의 초광폭
 * 화면(2560px 등)에서 본문을 끝까지 늘리면 정규 카드 PW 레일이 지나치게
 * 늘어지고 우측에 의미 없는 여백만 남는다. 화면에 실제로 보이는(=줌 적용
 * 후) 폭 기준 PROGRESS_MAX_WIDTH_TARGET(2400px)에서 자르고 왼쪽(사이드바
 * 옆)에 붙인다 — 가운데 정렬은 사이드바 옆 콘텐츠가 화면 중앙으로 쏠려
 * 보이는 부작용이 있어 쓰지 않는다.
 *
 * 전역 확대 배율 — 이 화면 코드는 Design의 px 값을 Tailwind 임의값
 * (`text-[14px]`처럼 대괄호 리터럴)으로 그대로 옮겨놨다. 이런 임의값은
 * Tailwind의 theme.fontSize/spacing 배율 설정이나 "루트 font-size 기준
 * rem 환산"의 영향을 받지 않는다(둘 다 rem 기반 유틸리티 클래스 이름에만
 * 작동하는데, 여기 있는 건 전부 px 리터럴이라 대상이 아니다) — 그래서 두
 * 방식 모두 이 화면에는 쓸 수 없고, 실제로 값을 바꾸려면 이 화면의 수백 개
 * 클래스를 다 고쳐야 한다.
 *
 * 대신 CSS `zoom`을 이 최상위 래퍼 한 곳에만 걸었다. `zoom`은 안쪽의 모든
 * px 값(폰트·패딩·gap·radius·아바타 지름·바 높이 등)과 레이아웃 계산에
 * 쓰이는 값(max-width/grid minmax/flex-basis)까지 실제 레이아웃 박스
 * 크기로 그대로 곱해서 렌더링한다(브라우저가 그 배율로 확대한 것처럼
 * 동작 — `transform: scale()`과 달리 주변 요소와의 흐름·스크롤 계산도
 * 같이 맞물려 돈다). 배율을 바꾸려면 아래 PROGRESS_UI_SCALE 한 줄만
 * 고치면 된다 — 개별 클래스를 다시 손볼 필요가 없다(1.5배가 과하다는
 * 피드백으로 1.2배로 낮췄고, 그 조정도 이 줄 하나만 바꿔서 끝났다).
 * 사이드바·다른 AX 페이지는 이 wrapper 바깥이라 전혀 영향받지 않는다.
 *
 * max-width와 배율의 관계 — max-width 소스값에 zoom이 그대로 곱해지므로,
 * 소스값을 고정 px로 박아두면(예: 1600px) 배율을 바꿀 때마다 화면에 실제
 * 보이는 캡(1600×배율)이 같이 흔들린다(1.5배일 땐 2400px이었는데 1.2배로
 * 낮추자 1920px로 줄어 "2560px에서 우측 여백이 남는" 원래 문제가 되돌아온
 * 적이 있었다). 그래서 소스값을 고정 상수로 두지 않고
 * `PROGRESS_MAX_WIDTH_TARGET ÷ PROGRESS_UI_SCALE`로 계산한다 — 목표
 * 유효 캡(2400px)을 상수로 고정해두면, 나중에 PROGRESS_UI_SCALE만
 * 바꿔도 화면에 보이는 캡은 항상 2400px로 그대로 유지된다(주석으로 "곱해서
 * 얼마"라고만 적어두는 방식은 배율을 바꿀 때 사람이 값을 다시 계산해서
 * 고쳐야 하므로 쓰지 않았다 — 잊어버리기 쉽다).
 *
 * 알아둘 것:
 *  - `zoom`은 비표준이지만 Chromium/Edge/최신 Safari·Firefox가 지원한다
 *    (표준 `transform: scale()`은 레이아웃에 반영이 안 돼 주변 요소가
 *    겹치므로 이 용도엔 못 쓴다).
 *  - Drawer(등록/수정 폼)는 `position: fixed`지만 (Portal 없이) 이
 *    wrapper 안에 그대로 중첩 렌더링되므로 zoom을 또 걸 필요가 없다 —
 *    `position: fixed`는 위치 계산의 containing block만 viewport로
 *    바꿀 뿐, zoom의 렌더링 스케일은 DOM 트리를 따라 그대로 상속된다.
 *    처음엔 이 착각으로 DrawerShell에도 zoom을 걸었다가 곱배가 되는 걸
 *    실측으로 발견해 되돌렸다(ProgressDrawer.tsx 참고).
 */
export const PROGRESS_UI_SCALE = 1.2;

/** 화면에 실제로 보이는(줌 적용 후) 본문 최대 폭 목표. max-width 소스값은
 * 이 값을 PROGRESS_UI_SCALE로 나눠서 구한다 — 배율이 바뀌어도 이 목표는
 * 그대로 유지된다. */
export const PROGRESS_MAX_WIDTH_TARGET = 2400;

export function ProgressPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex w-full flex-col gap-[18px] px-[30px] pb-[72px] pt-[26px]"
      style={{ zoom: PROGRESS_UI_SCALE, maxWidth: PROGRESS_MAX_WIDTH_TARGET / PROGRESS_UI_SCALE }}
    >
      {children}
    </div>
  );
}
