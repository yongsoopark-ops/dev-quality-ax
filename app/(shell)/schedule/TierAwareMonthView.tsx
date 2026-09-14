"use client";

import { createElement } from "react";
import MonthView from "react-big-calendar/lib/Month";
import DateContentRow from "react-big-calendar/lib/DateContentRow";
import { inRange, sortWeekEvents } from "react-big-calendar/lib/utils/eventLevels";
import { applyMonthCalendarTierOrder, type CalendarTaskEvent } from "@/lib/schedule/calendarMapper";

/**
 * Step(Month Calendar 실제 표시 순서 보장) — react-big-calendar@1.20.0의 Month
 * view는 주(week) row를 그릴 때마다 자체 sortWeekEvents(내부적으로
 * localizer.sortEvents에 위임, 각 이벤트의 start/end/allDay만 참조)를 무조건
 * 다시 실행해, CalendarView.tsx가 이미 tier 순으로 정렬해 넘긴 `events` prop의
 * 순서를 매번 덮어쓴다(node_modules/react-big-calendar/lib/Month.js:70,
 * renderWeek). localizer.sortEvents는 category/isCommonAssignee 등 tier
 * 계산에 필요한 정보를 아예 전달받지 못해(evtA/evtB에 start/end/allDay만
 * 있음) 공식 hook으로는 이 요구사항을 반영할 수 없다(Final Fix Step 감사
 * 결과). dayLayoutAlgorithm도 Day/Week/TimeGrid 전용이라 Month에는 없다.
 *
 * react-big-calendar가 공식 지원하는 확장점인 `views={{ month: Component }}`를
 * 이용해, 원본 Month 클래스를 그대로 상속(subclass)하고 renderWeek 한 곳만
 * 재정의한다 — node_modules는 전혀 수정하지 않고(fork 아님), DateContentRow/
 * Popup/드래그/클릭/팝업 등 나머지 로직은 원본 인스턴스 메서드를 그대로
 * 물려받아 사용한다(super(props) 이후 this.getContainer/slotRowRef/
 * readerDateHeading/handleShowMore/handleSelectEvent/handleDoubleClickEvent/
 * handleKeyPressEvent/handleSelectSlot가 전부 원본 그대로 세팅돼 있다).
 *
 * renderWeek 안에서 하는 일은 원본과 딱 한 곳만 다르다:
 *   원본: sorted = sortWeekEvents(weeksEvents, accessors, localizer)
 *   여기: sorted = "위 결과에 tier 기준 안정 정렬을 한 번 더 적용한 것"
 * tier는 새로 계산하지 않고 CalendarView.tsx의 sortEventsForMonthCalendar가
 * 이미 각 이벤트에 찍어둔 `monthCalendarTier`(getMonthCalendarSortTier 재사용,
 * 중복 priority map 없음)를 그대로 읽는다. Array.prototype.sort는 안정
 * 정렬이라 같은 tier 안에서는 react-big-calendar 자신의 순서(멀티데이 우선 +
 * 시작일 등, "기존 second-order")가 그대로 보존된다.
 *
 * Week/Day/Agenda 뷰는 이 컴포넌트를 전혀 참조하지 않으므로 영향이 없다.
 *
 * ⚠️ 기술 부채(react-big-calendar 버전 고정 의존) — 위 세 deep-import
 * (`react-big-calendar/lib/Month`, `.../lib/DateContentRow`,
 * `.../lib/utils/eventLevels`)는 공식 export가 아닌 내부 모듈이라 semver
 * 보장이 없다. **react-big-calendar를 업그레이드할 때는 반드시** 이 세 모듈의
 * 경로/시그니처(특히 Month.js의 renderWeek 내부 구조와 DateContentRow props)가
 * 그대로인지 소스로 재확인하고, 이 파일이 만드는 tier 순서(월 캘린더 셀 표시
 * 순서 + "+N 더보기" popup 순서)에 회귀가 없는지 재검증해야 한다.
 */
class TierAwareMonthView extends MonthView {
  constructor(props: any) {
    super(props);

    (this as any).renderWeek = (week: Date[], weekIdx: number) => {
      const { events, components, selectable, getNow, selected, date, localizer, longPressThreshold, accessors, getters, showAllEvents } =
        this.props as any;
      const { needLimitMeasure, rowLimit } = this.state as any;

      const weeksEvents = (events as CalendarTaskEvent[]).filter((event) =>
        inRange(event, week[0], week[week.length - 1], accessors, localizer),
      );
      const librarySorted = sortWeekEvents(weeksEvents, accessors, localizer) as CalendarTaskEvent[];
      // 요청사항(3): 동일 tier 내에서는 위 librarySorted 순서를 그대로 유지한다
      // — applyMonthCalendarTierOrder는 안정 정렬이라 tier가 같은 이벤트끼리는
      // 서로 위치가 바뀌지 않는다. lib/schedule/calendarMapper.ts의 단위
      // 테스트가 이 함수를 이 파일과 동일하게 재사용해 검증한다.
      const sorted = applyMonthCalendarTierOrder(librarySorted);

      return createElement(DateContentRow, {
        key: weekIdx,
        ref: weekIdx === 0 ? (this as any).slotRowRef : undefined,
        container: (this as any).getContainer,
        className: "rbc-month-row",
        getNow,
        date,
        range: week,
        events: sorted,
        maxRows: showAllEvents ? Infinity : rowLimit,
        selected,
        selectable,
        components,
        accessors,
        getters,
        localizer,
        renderHeader: (this as any).readerDateHeading,
        renderForMeasure: needLimitMeasure,
        onShowMore: (this as any).handleShowMore,
        onSelect: (this as any).handleSelectEvent,
        onDoubleClick: (this as any).handleDoubleClickEvent,
        onKeyPress: (this as any).handleKeyPressEvent,
        onSelectSlot: (this as any).handleSelectSlot,
        longPressThreshold,
        rtl: (this.props as any).rtl,
        resizable: (this.props as any).resizable,
        showAllEvents,
      });
    };
  }
}

export default TierAwareMonthView;
