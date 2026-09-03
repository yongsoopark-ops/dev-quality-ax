import { toKstParts } from "@/lib/kst";

/**
 * Step 5B-9(주간 파트 회의록 Preview) — V1 주간 범위 고정 정책은 "월요일~
 * 금요일"이다(요청사항). 이번 테스트는 2026-08-31~2026-09-04로 명시 지정해서
 * 쓰지만, 향후 "현재 주 기준 자동 계산"으로 바로 확장할 수 있도록 순수 함수로
 * 분리해 둔다 — referenceDate를 생략하면 오늘이 속한 주의 월~금을 계산한다.
 *
 * Hotfix Audit(Production KST/UTC 시간대 오차) — referenceDate.getDay()/
 * getDate() 같은 로컬 접근자로 "오늘"을 판정하면 서버 런타임이 KST가
 * 아닐 때(Netlify Production은 UTC) 자정 근처 9시간 구간에서 "오늘"의
 * 요일/날짜 자체가 실제 KST 기준과 달라질 수 있었다(예: KST 00~09시는
 * UTC로는 아직 전날). 이제 toKstParts(lib/kst.ts)로 "지금이 KST 기준
 * 몇 년/월/일/요일인지"를 먼저 구하고, 그 뒤 월~금 계산은 UTC 자정
 * anchored 값으로만 하므로(getUTC*()만 사용) 서버 런타임 timezone과
 * 무관하게 항상 같은 결과를 준다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateOnlyUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface WeekRange {
  start: string;
  end: string;
}

/** referenceDate(절대 시각)가 KST 기준으로 속한 주(월요일 시작)의 월요일/
 * 금요일을 "YYYY-MM-DD"로 반환한다. 주말(토/일, KST 기준)에 호출하면
 * 그 주의(=바로 지난) 월~금을 가리킨다 — "다음 주"로 앞서가지 않는다. */
export function getWeeklyMeetingRange(referenceDate: Date = new Date()): WeekRange {
  const { year, month, day } = toKstParts(referenceDate);
  // KST 기준 "오늘 자정"을 UTC 자정 anchored 값으로 재구성한다 — 이후
  // Task.startDate/dueDate와 같은 "달력 날짜" 표현 방식(UTC 자정 기준)으로
  // 통일해, 이 값을 다른 날짜와 비교하는 호출부와 표현이 어긋나지 않게 한다.
  const todayUtcMidnightMs = Date.UTC(year, month, day);
  const weekday = new Date(todayUtcMidnightMs).getUTCDay(); // 0=일~6=토 — 달력 날짜만의 요일이라 로컬 접근자 문제와 무관
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(todayUtcMidnightMs + diffToMonday * DAY_MS);
  const friday = new Date(todayUtcMidnightMs + (diffToMonday + 4) * DAY_MS);
  return { start: formatDateOnlyUtc(monday), end: formatDateOnlyUtc(friday) };
}
