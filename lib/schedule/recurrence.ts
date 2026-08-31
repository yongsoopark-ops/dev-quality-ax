import { addDays, differenceInCalendarWeeks, startOfDay, startOfWeek } from "date-fns";
import type { RecurrenceMonthlyRuleType, RecurrenceType } from "@/app/generated/prisma/enums";

/**
 * Step 5B-1(반복 일정) — 이 파일은 순수 계산만 담당한다(DB/React 의존 없음).
 * 미래 회차를 Task Row로 미리 만들지 않고, "이 반복 규칙 + 첫 회차(anchor) 날짜"
 * 만으로 임의의 조회 구간 안에 들어오는 회차 날짜를 그때그때 계산한다.
 * anchor 자신의 날짜는 결과에 포함하지 않는다 — 그 날짜는 이미 실제 Task
 * Row(첫 회차)로 별도 표시되기 때문이다(호출부가 중복 없이 합친다).
 */

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export const WEEKDAY_ORDER: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MON: "월",
  TUE: "화",
  WED: "수",
  THU: "목",
  FRI: "금",
  SAT: "토",
  SUN: "일",
};

/** 1=첫째 주 ~ 4=넷째 주, -1=마지막 주. */
export const MONTHLY_WEEK_ORDINAL_OPTIONS: number[] = [1, 2, 3, 4, -1];

export const MONTHLY_WEEK_ORDINAL_LABELS: Record<number, string> = {
  1: "첫째 주",
  2: "둘째 주",
  3: "셋째 주",
  4: "넷째 주",
  "-1": "마지막 주",
};

export interface RecurrenceRule {
  type: RecurrenceType;
  /** 2면 "격주"/"격월". V1 UI는 항상 1만 노출한다. */
  interval: number;
  /** WEEKLY 전용. */
  weekdays: Weekday[];
  /** MONTHLY 전용. */
  monthlyRuleType: RecurrenceMonthlyRuleType | null;
  /** MONTHLY + DAY_OF_MONTH 전용(1~31). */
  monthDay: number | null;
  /** MONTHLY + NTH_WEEKDAY 전용(1~4 또는 -1). */
  monthlyWeekOrdinal: number | null;
  /** MONTHLY + NTH_WEEKDAY 전용. */
  monthlyWeekday: Weekday | null;
  /** null이면 종료일 없음(무기한 반복). */
  endDate: string | null;
}

/** Prisma Task Row의 평평한(flat) recurrence 컬럼들을 RecurrenceRule 하나로
 * 묶는다 — page.tsx/actions.ts의 조회 결과를 TaskWithRelations.recurrence로
 * 바꿀 때 이 함수 하나만 쓰면 된다(양쪽에서 각자 다르게 매핑하지 않도록). */
export function taskRowToRecurrenceRule(row: {
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  recurrenceWeekdays: string[];
  recurrenceMonthlyRuleType: RecurrenceMonthlyRuleType | null;
  recurrenceMonthDay: number | null;
  recurrenceMonthlyWeekOrdinal: number | null;
  recurrenceMonthlyWeekday: string | null;
  recurrenceEndDate: Date | null;
}): RecurrenceRule {
  return {
    type: row.recurrenceType,
    interval: row.recurrenceInterval,
    weekdays: row.recurrenceWeekdays as Weekday[],
    monthlyRuleType: row.recurrenceMonthlyRuleType,
    monthDay: row.recurrenceMonthDay,
    monthlyWeekOrdinal: row.recurrenceMonthlyWeekOrdinal,
    monthlyWeekday: row.recurrenceMonthlyWeekday as Weekday | null,
    endDate: row.recurrenceEndDate ? row.recurrenceEndDate.toISOString() : null,
  };
}

export const NO_RECURRENCE: RecurrenceRule = {
  type: "NONE",
  interval: 1,
  weekdays: [],
  monthlyRuleType: null,
  monthDay: null,
  monthlyWeekOrdinal: null,
  monthlyWeekday: null,
  endDate: null,
};

function jsDayToWeekday(jsDay: number): Weekday {
  // JS Date.getDay(): 0=Sun..6=Sat → WEEKDAY_ORDER: 0=Mon..6=Sun
  return WEEKDAY_ORDER[(jsDay + 6) % 7];
}

function weekdayToJsDay(weekday: Weekday): number {
  return (WEEKDAY_ORDER.indexOf(weekday) + 1) % 7;
}

/** 그 달에 day가 실제로 존재하지 않으면(예: 2월 31일) null — 다음 달로 넘어가거나
 * 하는 보정을 하지 않고 그 달은 건너뛴다(요청사항: 사용자가 예상 못한 날짜로
 * 밀리지 않도록 안전하게 skip). */
function computeDayOfMonth(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day);
  if (d.getMonth() !== month) return null;
  return d;
}

/** ordinal이 1~4면 그 달의 N번째 weekday, -1이면 마지막 weekday. 그 달에 해당
 * 순번이 존재하지 않으면(예: 5주차가 없는 달에 ordinal=4를 넘는 경우는 없지만,
 * 극히 드물게 4번째가 없는 달도 있다) null. */
function computeNthWeekdayOfMonth(year: number, month: number, weekday: Weekday, ordinal: number): Date | null {
  const targetJsDay = weekdayToJsDay(weekday);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const matches: Date[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    if (d.getDay() === targetJsDay) matches.push(d);
  }
  if (matches.length === 0) return null;
  if (ordinal === -1) return matches[matches.length - 1];
  if (ordinal >= 1 && ordinal <= matches.length) return matches[ordinal - 1];
  return null;
}

/**
 * [rangeStart, rangeEnd] 구간(둘 다 포함, 날짜 단위) 안에서 이 규칙이 만들어내는
 * 회차 날짜를 전부 계산한다. anchorStart(첫 회차 날짜) 자신과, 반복 종료일
 * 이후, anchor 이전은 결과에서 제외한다. 시간(시:분)은 다루지 않는다 — 이
 * 프로젝트의 Calendar는 날짜 단위 all-day 표시만 하기 때문에(CustomWeekView
 * 주석 참고), 호출부가 anchor Task의 날짜 span(다음 함수)만 그대로 적용한다.
 */
export function computeRecurringOccurrenceDates(rule: RecurrenceRule, anchorStart: Date, rangeStart: Date, rangeEnd: Date): Date[] {
  if (rule.type === "NONE") return [];
  const interval = Math.max(1, Math.floor(rule.interval) || 1);
  const anchorDateOnly = startOfDay(anchorStart);
  const rangeStartOnly = startOfDay(rangeStart);
  const rangeEndOnly = startOfDay(rangeEnd);
  const endDateOnly = rule.endDate ? startOfDay(new Date(rule.endDate)) : null;

  function withinBounds(d: Date): boolean {
    if (d.getTime() < anchorDateOnly.getTime()) return false;
    if (endDateOnly && d.getTime() > endDateOnly.getTime()) return false;
    if (d.getTime() < rangeStartOnly.getTime() || d.getTime() > rangeEndOnly.getTime()) return false;
    if (d.getTime() === anchorDateOnly.getTime()) return false; // anchor 자신은 실제 Task로 이미 표시됨
    return true;
  }

  const results: Date[] = [];

  if (rule.type === "WEEKLY") {
    if (rule.weekdays.length === 0) return [];
    const anchorWeekStart = startOfWeek(anchorDateOnly, { weekStartsOn: 1 });
    const loopStart = rangeStartOnly.getTime() < anchorDateOnly.getTime() ? anchorDateOnly : rangeStartOnly;
    const loopEnd = endDateOnly && endDateOnly.getTime() < rangeEndOnly.getTime() ? endDateOnly : rangeEndOnly;
    for (let d = loopStart; d.getTime() <= loopEnd.getTime(); d = addDays(d, 1)) {
      const wd = jsDayToWeekday(d.getDay());
      if (!rule.weekdays.includes(wd)) continue;
      const weeksSinceAnchor = differenceInCalendarWeeks(d, anchorWeekStart, { weekStartsOn: 1 });
      if (weeksSinceAnchor < 0 || weeksSinceAnchor % interval !== 0) continue;
      if (withinBounds(d)) results.push(new Date(d));
    }
  } else if (rule.type === "MONTHLY") {
    const anchorMonthIndex = anchorDateOnly.getFullYear() * 12 + anchorDateOnly.getMonth();
    const rangeEndMonthIndex = rangeEndOnly.getFullYear() * 12 + rangeEndOnly.getMonth();
    let monthIndex = Math.max(anchorMonthIndex, rangeStartOnly.getFullYear() * 12 + rangeStartOnly.getMonth());

    while (monthIndex <= rangeEndMonthIndex) {
      const monthsSinceAnchor = monthIndex - anchorMonthIndex;
      if (monthsSinceAnchor % interval === 0) {
        const year = Math.floor(monthIndex / 12);
        const month = monthIndex % 12;
        const occDate =
          rule.monthlyRuleType === "NTH_WEEKDAY" && rule.monthlyWeekday && rule.monthlyWeekOrdinal
            ? computeNthWeekdayOfMonth(year, month, rule.monthlyWeekday, rule.monthlyWeekOrdinal)
            : rule.monthDay
              ? computeDayOfMonth(year, month, rule.monthDay)
              : null;
        if (occDate && withinBounds(occDate)) results.push(occDate);
      }
      monthIndex += 1;
    }
  }

  return results;
}
