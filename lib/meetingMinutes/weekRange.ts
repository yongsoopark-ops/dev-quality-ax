/**
 * Step 5B-9(주간 파트 회의록 Preview) — V1 주간 범위 고정 정책은 "월요일~
 * 금요일"이다(요청사항). 이번 테스트는 2026-08-31~2026-09-04로 명시 지정해서
 * 쓰지만, 향후 "현재 주 기준 자동 계산"으로 바로 확장할 수 있도록 순수 함수로
 * 분리해 둔다 — referenceDate를 생략하면 오늘이 속한 주의 월~금을 계산한다.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateOnlyString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface WeekRange {
  start: string;
  end: string;
}

/** referenceDate가 속한 주(월요일 시작)의 월요일/금요일을 "YYYY-MM-DD"로
 * 반환한다. 주말(토/일)에 호출하면 그 주의(=바로 지난) 월~금을 가리킨다 —
 * "다음 주"로 앞서가지 않는다. */
export function getWeeklyMeetingRange(referenceDate: Date = new Date()): WeekRange {
  const day = referenceDate.getDay(); // 0=일 ~ 6=토
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(referenceDate);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() + diffToMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { start: toDateOnlyString(monday), end: toDateOnlyString(friday) };
}
