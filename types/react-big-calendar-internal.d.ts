/**
 * Step(Month Calendar 실제 표시 순서 보장) — react-big-calendar@1.20.0의
 * Month view 관련 내부 모듈(공식 @types/react-big-calendar에도 타입이 없고
 * index.js에서도 export되지 않는 private 모듈, node_modules 내용 자체는
 * 전혀 수정하지 않음)을 TypeScript에서 안전하게 deep-import하기 위한 최소
 * ambient 선언. 이 두 모듈은 react-big-calendar가 자체적으로도 이미
 * export하는 "순수 정렬/판정 유틸"이라 UI 렌더링 로직을 복제하지 않는다.
 * app/(shell)/schedule/TierAwareMonthView.tsx에서만 사용한다.
 */
declare module "react-big-calendar/lib/Month" {
  import type { Component } from "react";

  /** react-big-calendar 자신의 Month view 클래스 — 그대로 상속(subclass)해
   * renderWeek 한 곳만 재정의할 목적으로만 타입을 선언한다. props/state는
   * 공식 @types/react-big-calendar의 ViewProps와 동일하게 대부분 `any`다
   * (그 패키지 자체도 accessors/components/getters/localizer를 `any`로
   * 선언한다 — lib/@types/react-big-calendar/index.d.ts의 ViewProps 참고). */
  export default class Month extends Component<any, any> {
    static range: (date: Date, opts: any) => { start: Date; end: Date };
    static navigate: (date: Date, action: any, opts: any) => Date;
    static title: (date: Date, opts: any) => string;
  }
}

declare module "react-big-calendar/lib/DateContentRow" {
  import type { ComponentType } from "react";

  /** Month.js가 각 주(week) row를 그릴 때 실제로 사용하는 바로 그 컴포넌트
   * (드래그/리사이즈/클릭/팝오버 트리거를 전부 포함) — 렌더링 로직은 전혀
   * 손대지 않고, 여기 넘기는 `events` prop의 순서만 우리가 바꾼다. */
  const DateContentRow: ComponentType<any>;
  export default DateContentRow;
}

declare module "react-big-calendar/lib/utils/eventLevels" {
  /** 어떤 이벤트가 주어진 날짜 범위(range)와 겹치는지 판정한다 — Month.js의
   * eventsForWeek가 내부적으로 쓰는 것과 동일한 함수(순수 판정, 렌더링 없음). */
  export function inRange(event: unknown, start: Date, end: Date, accessors: any, localizer: any): boolean;

  /** react-big-calendar의 기본 Month 정렬(멀티데이 우선 + 시작일 등,
   * localizer.sortEvents에 위임) — Month.js가 매 주(week)마다 실제로 호출하는
   * 바로 그 함수. 우리는 이 결과를 그대로 재사용해 "동일 tier 내 기존 순서"로
   * 삼는다(중복 재구현 금지). */
  export function sortWeekEvents<TEvent = unknown>(events: TEvent[], accessors: any, localizer: any): TEvent[];
}
