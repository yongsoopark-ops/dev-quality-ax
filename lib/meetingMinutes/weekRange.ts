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

/**
 * referenceDate(절대 시각)가 KST 기준으로 속한 주(월요일~금요일 범위)의
 * 월요일/금요일을 "YYYY-MM-DD"로 반환한다. 반환하는 범위 자체는 여전히
 * "월~금"이다 — 바뀐 것은 "언제 다음 주로 넘어가는지"뿐이다.
 *
 * Step(회의록 주간 갱신 기준일 월요일 → 화요일) — 기존에는 월요일 당일부터
 * 이미 그 주(이번 주 월~금)로 넘어갔다. 이제는 화요일부터 새 주차로
 * 넘어가고, 월요일까지는 직전 주(=지난주 월~금) 기준을 그대로 유지한다
 * (요청사항). 요일 판정 기준일 하루를 통째로 앞당겨서(하루 전 날짜로
 * 요일/월요일을 계산) 처리한다 — 그러면 실제 오늘이 월요일일 때는 "어제
 * (일요일)가 속한 주"로 계산되어 직전 주 범위가 그대로 나오고, 실제 오늘이
 * 화요일 이상일 때는 "어제(월요일 이상)가 속한 주"로 계산되어 새 주차
 * 범위가 나온다 — 기존 월요일 기준 계산식 자체는 그대로 재사용한다(새
 * 요일 계산 방식을 따로 만들지 않음).
 */
export function getWeeklyMeetingRange(referenceDate: Date = new Date()): WeekRange {
  const { year, month, day } = toKstParts(referenceDate);
  // KST 기준 "오늘 자정"을 UTC 자정 anchored 값으로 재구성한다 — 이후
  // Task.startDate/dueDate와 같은 "달력 날짜" 표현 방식(UTC 자정 기준)으로
  // 통일해, 이 값을 다른 날짜와 비교하는 호출부와 표현이 어긋나지 않게 한다.
  const todayUtcMidnightMs = Date.UTC(year, month, day);
  // 갱신 기준일을 화요일로 미루기 위해, 요일/월요일 계산은 항상 "어제" 기준으로
  // 한다(위 주석 참고) — 그 뒤의 diffToMonday 공식은 기존과 완전히 동일하다.
  const rolloverAnchorMs = todayUtcMidnightMs - DAY_MS;
  const weekday = new Date(rolloverAnchorMs).getUTCDay(); // 0=일~6=토 — 달력 날짜만의 요일이라 로컬 접근자 문제와 무관
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(rolloverAnchorMs + diffToMonday * DAY_MS);
  const friday = new Date(rolloverAnchorMs + (diffToMonday + 4) * DAY_MS);
  return { start: formatDateOnlyUtc(monday), end: formatDateOnlyUtc(friday) };
}
