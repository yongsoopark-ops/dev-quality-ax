/**
 * 설비 관리 전용 "달력 날짜" 유틸 — Equipment/EquipmentReservation의
 * startDate/endDate/recordedAt은 전부 lib/kst.ts가 문서화한 "달력 날짜"
 * 관례(시각 없이 "YYYY-MM-DD"를 그대로 new Date()로 파싱 → 항상 UTC
 * 자정)를 따른다. 그래서 이 파일은 KST 변환이 아니라 getUTC*()/setUTCDate()
 * 등 "그 값이 가리키는 UTC 자정 날짜"만 다루는 순수 날짜 연산만 담당한다 —
 * 로컬 timezone getter(getDate()/getDay() 등)는 서버 런타임 timezone에 따라
 * 결과가 달라질 수 있어 이 파일 안에서 전혀 쓰지 않는다(Hotfix Audit 관례,
 * lib/kst.ts 파일 헤더 참고).
 */

/** "2026.09.09" 또는 "2026-09-09" 모두 허용 — 예약 다이얼로그의 수동 입력
 * 형식(README: "2026.09.09 형식 수동 입력 허용")과 DB round-trip 양쪽에
 * 쓰인다. 파싱 실패 시 null. */
export function parseCalendarDateInput(input: string): Date | null {
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(input.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026.09.09" 표시 형식 — 예약 다이얼로그/표에 그대로 쓴다. */
export function formatCalendarDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

export function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** 이 날짜가 속한 주(일요일 시작)의 일요일. README "일 → 토 순서"에 맞춰
 * 캘린더는 항상 일요일 시작이다(Schedule의 월요일 시작 주간뷰와는 다른
 * 규칙 — 디자인 레퍼런스 그대로 재현한다). */
export function sundayOf(date: Date): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - result.getUTCDay());
  return result;
}

/** 오늘(KST 기준 달력 날짜)이 속한 주의 일요일 — "이번 주" 버튼/캘린더
 * 초기값에 쓴다. KST "오늘"을 UTC 자정 달력 날짜로 변환해야 하므로 여기서만
 * lib/kst.ts를 참조한다. */
export function thisWeekSunday(kstNow: { year: number; month: number; day: number }): Date {
  return sundayOf(new Date(Date.UTC(kstNow.year, kstNow.month, kstNow.day)));
}

export function isSameCalendarDate(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;
export function dayOfWeekLabel(date: Date): string {
  return DOW_LABEL[date.getUTCDay()];
}
