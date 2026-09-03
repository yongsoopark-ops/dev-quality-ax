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
  /** 2면 "격주"/"격월"/"이틀마다"/"2년마다" 등. DAILY/WEEKLY/MONTHLY/YEARLY
   * 전부 이 하나의 필드를 공유한다(요청사항: "격주를 별도 recurrence type으로
   * 만들지 말고 기존 interval 방식 재사용"). */
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
  /** null이면 종료일 없음. count와 동시에 값을 갖지 않는다(서버가 저장 시
   * 항상 한쪽만 채운다 — buildRecurrenceData 참고). */
  endDate: string | null;
  /** Step(반복 일정 UX 개선) — "N회 반복". null이면 횟수 제한 없음(endDate만으로
   * 종료 판단, 그마저 null이면 무기한 반복). anchor 자신을 포함한 전체 발생
   * 횟수를 의미한다 — count=5면 anchor 1회 + 계산된 회차 4회 = 총 5회
   * (computeRecurringOccurrenceDates의 count 처리 주석 참고). */
  count: number | null;
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
  recurrenceCount: number | null;
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
    count: row.recurrenceCount,
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
  count: null,
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
  // Step(반복 일정 UX 개선) — "N회 반복"(count)은 endDate와 달리 "이 조회
  // 구간 안에서 몇 번째인지"가 아니라 "anchor로부터 전체 계열에서 몇 번째인지"로
  // 세어야 정확하다(요청사항 13: 화면 요약/DB 값/실제 발생 횟수 3개 일치).
  // 그래서 count가 있으면 반드시 anchor부터 순서대로 순회하며 세고
  // (loopStart를 rangeStart로 당기지 않는다), 화면에 실제로 보여줄지는
  // [rangeStart, rangeEnd] 안인지로 별도 필터링한다. count는 유한한 값이라
  // (검증에서 양의 정수만 허용) 순회량이 count로 자연히 제한돼 성능 문제가
  // 없다 — 무한 루프 방지용 안전 상한만 넉넉히 둔다(50년).
  const maxCount = rule.count && rule.count > 1 ? rule.count : rule.count === 1 ? 1 : null;
  const useCountLoop = maxCount !== null;
  const safetyCapDate = addDays(anchorDateOnly, 366 * 50);

  const results: Date[] = [];
  let emittedAfterAnchor = 0; // anchor 자신을 제외하고 지금까지 찾은(=이미 지나친) 회차 수

  /** true를 반환하면 이 지점에서 순회를 완전히 멈춰야 한다(종료일/횟수 도달). */
  function emit(d: Date): boolean {
    if (d.getTime() <= anchorDateOnly.getTime()) return false; // anchor 자신/이전은 제외, 계속 진행
    if (endDateOnly && d.getTime() > endDateOnly.getTime()) return true; // 오름차순 순회 가정 — 이후로도 전부 종료일 초과
    if (maxCount !== null && emittedAfterAnchor >= maxCount - 1) return true; // anchor가 이미 1회 — 나머지 count-1개를 다 찾음
    emittedAfterAnchor++;
    if (d.getTime() >= rangeStartOnly.getTime() && d.getTime() <= rangeEndOnly.getTime()) {
      results.push(new Date(d));
    }
    return false;
  }

  if (rule.type === "DAILY") {
    let d = useCountLoop ? anchorDateOnly : rangeStartOnly.getTime() < anchorDateOnly.getTime() ? anchorDateOnly : rangeStartOnly;
    // interval 배수에 맞춰 정렬(anchor 기준) — 정렬 안 된 시작점이면 다음 유효
    // 날짜로 스냅한다.
    const daysSinceAnchor = Math.round((d.getTime() - anchorDateOnly.getTime()) / 86_400_000);
    const remainder = ((daysSinceAnchor % interval) + interval) % interval;
    if (remainder !== 0) d = addDays(d, interval - remainder);
    const loopEnd = useCountLoop ? safetyCapDate : endDateOnly && endDateOnly.getTime() < rangeEndOnly.getTime() ? endDateOnly : rangeEndOnly;
    while (d.getTime() <= loopEnd.getTime()) {
      if (emit(d)) break;
      d = addDays(d, interval);
    }
  } else if (rule.type === "WEEKLY") {
    if (rule.weekdays.length === 0) return [];
    const anchorWeekStart = startOfWeek(anchorDateOnly, { weekStartsOn: 1 });
    const loopStart = useCountLoop ? anchorDateOnly : rangeStartOnly.getTime() < anchorDateOnly.getTime() ? anchorDateOnly : rangeStartOnly;
    const loopEnd = useCountLoop ? safetyCapDate : endDateOnly && endDateOnly.getTime() < rangeEndOnly.getTime() ? endDateOnly : rangeEndOnly;
    for (let d = loopStart; d.getTime() <= loopEnd.getTime(); d = addDays(d, 1)) {
      const wd = jsDayToWeekday(d.getDay());
      if (!rule.weekdays.includes(wd)) continue;
      const weeksSinceAnchor = differenceInCalendarWeeks(d, anchorWeekStart, { weekStartsOn: 1 });
      if (weeksSinceAnchor < 0 || weeksSinceAnchor % interval !== 0) continue;
      if (emit(d)) break;
    }
  } else if (rule.type === "MONTHLY") {
    const anchorMonthIndex = anchorDateOnly.getFullYear() * 12 + anchorDateOnly.getMonth();
    const rangeEndMonthIndex = useCountLoop
      ? anchorMonthIndex + 12 * 50
      : rangeEndOnly.getFullYear() * 12 + rangeEndOnly.getMonth();
    let monthIndex = useCountLoop ? anchorMonthIndex : Math.max(anchorMonthIndex, rangeStartOnly.getFullYear() * 12 + rangeStartOnly.getMonth());

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
        if (occDate && emit(occDate)) break;
      }
      monthIndex += 1;
    }
  } else if (rule.type === "YEARLY") {
    // 매년 — "현재 일정의 월/일을 반복"(요청사항 11). anchor 자신의 월/일을
    // 그대로 매 interval년마다 재사용한다(별도 저장 필드 불필요).
    const anchorYear = anchorDateOnly.getFullYear();
    const anchorMonth = anchorDateOnly.getMonth();
    const anchorDay = anchorDateOnly.getDate();
    const endYear = useCountLoop ? anchorYear + 50 : rangeEndOnly.getFullYear();
    let year = useCountLoop ? anchorYear : Math.max(anchorYear, rangeStartOnly.getFullYear() - 1);

    while (year <= endYear) {
      const yearsSinceAnchor = year - anchorYear;
      if (yearsSinceAnchor >= 0 && yearsSinceAnchor % interval === 0) {
        // 2/29 같은 윤년 전용 날짜가 그 해에 없으면(MONTHLY의 monthDay와 동일
        // 정책) 그 해는 건너뛴다 — 임의 보정(3/1 등)으로 밀지 않는다.
        const occDate = computeDayOfMonth(year, anchorMonth, anchorDay);
        if (occDate && emit(occDate)) break;
      }
      year += 1;
    }
  }

  return results;
}

/**
 * Step 5B-7(미팅 반복 UX) — MEETING이 매주/매월 반복일 때는 사용자가 날짜를
 * 직접 입력하지 않는다(요청사항: "미팅 날짜 + 반복 규칙을 이중으로 입력하지
 * 않는다"). 대신 반복 규칙만으로 referenceDate 이후(당일 포함) 첫 유효 회차
 * 날짜를 계산해 anchor로 쓴다. computeRecurringOccurrenceDates와 달리 anchor
 * 자신을 "이미 표시된 것으로 제외"하는 로직이 없다 — 여기서는 정확히 그 anchor
 * 자체를 찾는 것이 목적이기 때문이다(용도가 다른 별도 함수).
 *
 * Step 5B-10(회의록 Preview 기본정보 자동입력)에서 "다음 회의 occurrence"를
 * 찾는 데도 그대로 재사용한다 — 그 용도에서는 이미 반복 종료일이 지정돼 있는
 * 기존 미팅을 다룰 수 있으므로, endDate를 넘는 결과는 null로 취급하도록
 * 보강했다(반복 일정 새로 만들 때는 endDate가 항상 null이라 이 보강이 기존
 * 동작에 영향을 주지 않는다).
 */
export function computeFirstOccurrenceOnOrAfter(rule: RecurrenceRule, referenceDate: Date): Date | null {
  const refOnly = startOfDay(referenceDate);
  const endDateOnly = rule.endDate ? startOfDay(new Date(rule.endDate)) : null;

  function withinEndDate(d: Date): boolean {
    return !endDateOnly || d.getTime() <= endDateOnly.getTime();
  }

  // DAILY/YEARLY는 WEEKLY/MONTHLY와 달리 "특정 요일/날짜"라는 별도 제약이
  // 없다 — 첫 회차는 항상 referenceDate 그 자신이다(그 날짜가 이후 anchor가
  // 되어 실제 interval 정렬의 기준점이 된다).
  if (rule.type === "DAILY" || rule.type === "YEARLY") {
    return withinEndDate(refOnly) ? refOnly : null;
  }

  if (rule.type === "WEEKLY") {
    if (rule.weekdays.length === 0) return null;
    for (let i = 0; i < 7; i++) {
      const d = addDays(refOnly, i);
      if (rule.weekdays.includes(jsDayToWeekday(d.getDay()))) return withinEndDate(d) ? d : null;
    }
    return null;
  }

  if (rule.type === "MONTHLY") {
    let monthIndex = refOnly.getFullYear() * 12 + refOnly.getMonth();
    // 24개월 안에서 못 찾으면(예: 필수 값이 비어 있는 등) null — 무한 루프 방지.
    for (let i = 0; i < 24; i++) {
      const year = Math.floor(monthIndex / 12);
      const month = monthIndex % 12;
      const occDate =
        rule.monthlyRuleType === "NTH_WEEKDAY" && rule.monthlyWeekday && rule.monthlyWeekOrdinal
          ? computeNthWeekdayOfMonth(year, month, rule.monthlyWeekday, rule.monthlyWeekOrdinal)
          : rule.monthDay
            ? computeDayOfMonth(year, month, rule.monthDay)
            : null;
      if (occDate && occDate.getTime() >= refOnly.getTime()) return withinEndDate(occDate) ? occDate : null;
      monthIndex += 1;
    }
    return null;
  }

  return null;
}

/**
 * Step(반복 일정 UX 개선, 요청사항 15) — 저장 전 사용자가 설정을 한눈에
 * 확인할 수 있는 한 줄 요약. "반복: 2주마다 월요일 · 무한 반복" 형태.
 * anchorDate는 YEARLY의 "매년 M월 D일" 표시에만 쓰인다(다른 타입은 저장된
 * 필드만으로 충분).
 */
export function describeRecurrenceRule(rule: RecurrenceRule, anchorDate: Date): string {
  if (rule.type === "NONE") return "반복 없음";
  const interval = Math.max(1, Math.floor(rule.interval) || 1);
  const pad = (n: number) => String(n).padStart(2, "0");

  let pattern: string;
  if (rule.type === "DAILY") {
    pattern = interval === 1 ? "매일" : `${interval}일마다`;
  } else if (rule.type === "WEEKLY") {
    const days = rule.weekdays.map((w) => WEEKDAY_LABELS[w]).join(", ");
    const daysSuffix = days ? ` ${days}요일` : "";
    pattern = interval === 1 ? `매주${daysSuffix}` : interval === 2 ? `격주${daysSuffix}` : `${interval}주마다${daysSuffix}`;
  } else if (rule.type === "MONTHLY") {
    if (rule.monthlyRuleType === "NTH_WEEKDAY" && rule.monthlyWeekday && rule.monthlyWeekOrdinal) {
      const ordinalLabel = MONTHLY_WEEK_ORDINAL_LABELS[rule.monthlyWeekOrdinal];
      const weekdayLabel = WEEKDAY_LABELS[rule.monthlyWeekday];
      pattern = interval === 1 ? `매월 ${ordinalLabel} ${weekdayLabel}요일` : `${interval}개월마다 ${ordinalLabel} ${weekdayLabel}요일`;
    } else if (rule.monthDay) {
      pattern = interval === 1 ? `매월 ${rule.monthDay}일` : `${interval}개월마다 ${rule.monthDay}일`;
    } else {
      pattern = interval === 1 ? "매월" : `${interval}개월마다`;
    }
  } else {
    // YEARLY
    pattern = interval === 1 ? `매년 ${anchorDate.getMonth() + 1}월 ${anchorDate.getDate()}일` : `${interval}년마다 ${anchorDate.getMonth() + 1}월 ${anchorDate.getDate()}일`;
  }

  let endPart: string;
  if (rule.count) {
    endPart = `${rule.count}회`;
  } else if (rule.endDate) {
    const d = new Date(rule.endDate);
    endPart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}까지`;
  } else {
    endPart = "무한 반복";
  }

  return `반복: ${pattern} · ${endPart}`;
}
