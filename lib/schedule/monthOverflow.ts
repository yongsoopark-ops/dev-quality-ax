import { startOfDay } from "date-fns";
import type { CalendarTaskEvent } from "./calendarMapper";

/**
 * Step(Final Fix — Month 더보기 강제 보장) — react-big-calendar가 "몇 개가
 * 들어가는지" 계산하는 내부 로직은 CSS로 바꿀 수 없음을 실측으로 확인했다
 * (지난 Step 완료 보고 참고 — .rbc-event min-height를 20~45px로 바꿔봐도
 * 표시 개수가 전혀 안 바뀜, 오히려 더 큰 값에서는 clipping만 늘어남).
 * 라이브러리 내부를 patch하는 대신, 렌더 결과를 실제 데이터(events)와
 * 비교해서 "이 날짜에 실제로 있어야 할 이벤트 수"를 구하는 순수 함수만
 * 이 파일에 둔다(DOM 스캔 자체는 MonthOverflowFallback.tsx가 담당 — 이
 * 함수는 그 결과를 해석하는 데 필요한 "정답"만 계산).
 */

/** 특정 날짜(day)에 걸리는(시작일<=day<=마감일, all-day 기준) 이벤트만
 * 골라낸다 — allDay 이벤트의 end는 mapTaskToEvent가 "마감일 당일의 마지막
 * 순간"으로 이미 만들어 두므로, 날짜 단위 비교(startOfDay)만으로 충분하다. */
export function eventsOnDay(events: CalendarTaskEvent[], day: Date): CalendarTaskEvent[] {
  const dayStart = startOfDay(day).getTime();
  return events.filter((e) => dayStart >= startOfDay(e.start).getTime() && dayStart <= startOfDay(e.end).getTime());
}
