import { toKstParts } from "@/lib/kst";

/**
 * 진행 현황 — 순수 날짜/분기/월 헬퍼(DB·Prisma 의존 없음). 분기는 달력
 * 분기(1월 시작)가 아니라 "Q1=3~5월, Q2=6~8월, Q3=9~11월, Q4=12~다음해
 * 2월" 시작인 자사 회계 분기다(핸드오프 §2 확정). Q4는 12월에 시작해
 * 다음 해 2월까지 이어지고, 회계연도는 12월이 속한 해로 귀속한다 — 즉 월
 * <= 2면 (연-1) Q4, 그 외에는 연 Q(floor((월-3)/3)+1)로 변환한다. 이
 * 변환은 fiscalQuarterOfCalendarMonth 한 곳에만 두고, 섹션 분기 이동
 * 기본값(currentFiscalQuarter)·세부 목표 분기 필터·분기 카드 피커가 모두
 * 이 함수(또는 그 결과인 currentFiscalQuarter)를 거쳐가도록 한다 — 회계
 * 분기 변환 로직을 여러 곳에 복제하지 않는다.
 */

export interface FiscalQuarter {
  year: number;
  q: 1 | 2 | 3 | 4;
}

/** 분기 시작 월(1-based) — Q4는 12월에 시작해 다음 해 2월까지 이어진다. */
export const FISCAL_QUARTER_START_MONTH: Record<1 | 2 | 3 | 4, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };

/** 달력 (year, month 1~12)이 속하는 회계 분기. 1~2월은 전년도 Q4로
 * 롤백된다(ZIP fqOf 그대로). */
export function fiscalQuarterOfCalendarMonth(year: number, month1to12: number): FiscalQuarter {
  if (month1to12 <= 2) return { year: year - 1, q: 4 };
  if (month1to12 <= 5) return { year, q: 1 };
  if (month1to12 <= 8) return { year, q: 2 };
  if (month1to12 <= 11) return { year, q: 3 };
  return { year, q: 4 };
}

/** "오늘"이 속한 회계 분기 — KST 기준(lib/kst.ts), ZIP의 하드코딩된 Mock
 * TODAY(2026-09-10)는 이식하지 않는다(실제 서비스이므로 실제 오늘을 쓴다). */
export function currentFiscalQuarter(): FiscalQuarter {
  const now = toKstParts(new Date());
  return fiscalQuarterOfCalendarMonth(now.year, now.month + 1);
}

function quarterIndex(fq: FiscalQuarter): number {
  return fq.year * 4 + (fq.q - 1);
}

export function compareQuarter(a: FiscalQuarter, b: FiscalQuarter): number {
  return quarterIndex(a) - quarterIndex(b);
}

export function addQuarters(fq: FiscalQuarter, delta: number): FiscalQuarter {
  const idx = quarterIndex(fq) + delta;
  const year = Math.floor(idx / 4);
  const q = ((idx % 4) + 4) % 4;
  return { year, q: (q + 1) as 1 | 2 | 3 | 4 };
}

export function quarterLabel(fq: FiscalQuarter): string {
  return `${fq.year} Q${fq.q}`;
}

/** "26.03–26.05" 형태 — 분기 시작월부터 3개월 구간(ZIP qRange 그대로).
 * Q4(12월 시작)만 종료월(2월)의 연도가 시작연도+1로 넘어간다. */
export function quarterRangeLabel(fq: FiscalQuarter): string {
  const startMonth = FISCAL_QUARTER_START_MONTH[fq.q];
  const endMonth = ((startMonth + 2 - 1) % 12) + 1;
  const endYear = fq.q === 4 ? fq.year + 1 : fq.year;
  const y2 = (n: number) => String(n % 100).padStart(2, "0");
  return `${y2(fq.year)}.${String(startMonth).padStart(2, "0")}–${y2(endYear)}.${String(endMonth).padStart(2, "0")}`;
}

/** 분기 범위(start~end, inclusive) 안의 모든 분기 목록. */
export function quartersBetween(start: FiscalQuarter, end: FiscalQuarter): FiscalQuarter[] {
  const out: FiscalQuarter[] = [];
  let cur = start;
  while (compareQuarter(cur, end) <= 0) {
    out.push(cur);
    cur = addQuarters(cur, 1);
  }
  return out;
}

// ── 월(공통 업무) ───────────────────────────────────────────────────────
// 공통 업무는 회계 분기가 아니라 평범한 달력 월(1~12월)을 쓴다(ZIP §5).

export interface CalendarMonth {
  year: number;
  month: number; // 1~12
}

export function currentCalendarMonth(): CalendarMonth {
  const now = toKstParts(new Date());
  return { year: now.year, month: now.month + 1 };
}

function monthIndex(m: CalendarMonth): number {
  return m.year * 12 + (m.month - 1);
}

export function compareMonth(a: CalendarMonth, b: CalendarMonth): number {
  return monthIndex(a) - monthIndex(b);
}

export function addMonthsTo(m: CalendarMonth, delta: number): CalendarMonth {
  const idx = monthIndex(m) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

export function monthKey(m: CalendarMonth): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}

export function monthLabel(m: CalendarMonth): string {
  return `${String(m.year % 100).padStart(2, "0")}.${String(m.month).padStart(2, "0")}`;
}

export function monthsBetween(start: CalendarMonth, end: CalendarMonth): CalendarMonth[] {
  const out: CalendarMonth[] = [];
  let cur = start;
  while (compareMonth(cur, end) <= 0) {
    out.push(cur);
    cur = addMonthsTo(cur, 1);
  }
  return out;
}

// ── YYYY-MM-DD ⇄ Date(UTC 자정) ────────────────────────────────────────
// app/(shell)/schedule/DateTextInput.tsx가 쓰는 것과 동일한 "달력 날짜"
// 문자열 형식(구분자 있는 YYYY-MM-DD) — 그 컴포넌트를 그대로 재사용하므로
// 별도 포맷 변환 없이 이 두 헬퍼만 있으면 된다.

export function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function formatIsoDate(date: Date | null): string {
  if (!date) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** "YYYY.MM.DD" 표시용(ZIP dDate) — 빈 값은 "—". */
export function displayDate(date: Date | null): string {
  if (!date) return "—";
  return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** 두 달력 날짜 사이의 일수(끝 - 시작). D-day 계산에 쓴다. */
export function daysBetweenDates(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export function addMonthsToDate(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, date.getUTCDate()));
}

export function todayCalendarDate(): Date {
  const now = toKstParts(new Date());
  return new Date(Date.UTC(now.year, now.month, now.day));
}
