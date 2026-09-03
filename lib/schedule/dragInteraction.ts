/**
 * Step(Month/Week Drag·Resize UX 통일) — Week View(CustomWeekView.tsx)에서
 * 실측으로 검증한 "drag/resize 종료 직후 브라우저가 합성하는 click을 억제"
 * 로직을 Month View(CalendarView.tsx, react-big-calendar 자체 DnD)와
 * 공용으로 쓴다.
 *
 * 배경(중복 구현하지 않고 이 helper로 합친 이유): react-big-calendar의 Month
 * View도 자체 `Selection` 유틸(클릭/드래그 구분용 5px tolerance)을 갖고
 * 있지만, 그 유틸은 "resize/move 실행 여부"만 판단할 뿐 이후 브라우저가 그대로
 * 별도로 발생시키는 네이티브 click까지 막아주지는 않는다 — 실측 결과 Month
 * View도 Week View와 동일하게 "resize handle을 드래그해 날짜를 바꾼 직후,
 * 그 결과로 Bar 자신 또는 그 아래 빈 셀에서 발생하는 click이 그대로 통과해
 * 업무 수정/새 일정 등록 팝업을 잘못 연다"는 문제가 재현됐다. 두 View의
 * "drag 결과를 최종 commit하는 지점"(Month는 handleEventDrop/handleEventResize,
 * Week는 commitDrag)이 이미 CalendarView.tsx의 commitDateChange 하나로
 * 합쳐져 있으므로, 그 공통 지점에서 이 함수 하나만 호출하면 두 View 모두
 * 같은 정책으로 커버된다.
 *
 * 반드시 "실제로 threshold를 넘겨 이동한 interaction"에서만 호출해야 한다 —
 * 단순 클릭 경로에서 호출하면 새 일정 등록/업무 수정 기능 자체가 막힌다.
 *
 * {once:true}로 "정확히 다음 click 1개만" 막는 방식은 Week View 실측에서
 * 이미 폐기됐다 — 하나의 drag/resize interaction에서 파생되는 합성 click이
 * 정확히 몇 번, 어떤 target에 발생하는지 브라우저/타이밍에 따라 보장되지
 * 않기 때문이다(주간 일정 Gantt Resize 오동작 수정 Step에서 실제 재현 확인).
 * 대신 window의 capture 단계에서 짧은 시간 창 동안 발생하는 click을 target과
 * 무관하게 전부 억제한다.
 */
export const DRAG_CLICK_SUPPRESSION_WINDOW_MS = 300;

export function suppressClicksAfterDragInteraction(windowMs: number = DRAG_CLICK_SUPPRESSION_WINDOW_MS): void {
  const suppress = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", suppress, { capture: true });
  // 정상 흐름에서는 click이 곧바로 뒤따라와 이 안에서 처리된다 — 혹시 click
  // 자체가 발생하지 않는 예외적인 경로(예: 포인터가 창 밖에서 올라간 경우)를
  // 대비한 안전망으로 windowMs 후 리스너를 정리한다.
  setTimeout(() => window.removeEventListener("click", suppress, { capture: true }), windowMs);
}
