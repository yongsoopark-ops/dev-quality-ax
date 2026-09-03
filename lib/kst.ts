/**
 * Hotfix Audit(Production KST/UTC 시간대 오차) — 업무 기준 시간대는
 * Asia/Seoul(UTC+9, DST 없음)로 고정한다. 서버 런타임의 로컬 timezone(로컬
 * 개발 PC는 보통 KST, Netlify Production은 UTC)에 의존하면 같은 코드가
 * 배포 환경에 따라 다른 결과를 낸다 — 실제로 겪은 문제: Meeting Minutes
 * 회의 일시가 로컬/Production에서 9시간 다르게 표시되고, "이번 주" 계산이
 * 자정 근처에서 하루 어긋날 수 있었다.
 *
 * 이 파일은 "그 순간이 실제로 몇 시(KST)인지"처럼 절대 시각(instant)에서
 * KST 벽시계 값을 뽑거나(toKstParts) 반대로 만드는(kstWallClockToInstant)
 * 함수만 담당한다 — getUTC*()/Date.UTC()만 쓰므로 서버 런타임의 로컬
 * timezone 설정과 완전히 무관하게 항상 같은 결과를 준다(getHours() 등
 * 로컬 접근자는 이 파일 안에서 전혀 쓰지 않는다).
 *
 * "달력 날짜"(Task.startDate/dueDate/recurrenceEndDate처럼 시각 의미가 없는
 * 값)는 이 파일의 대상이 아니다 — "YYYY-MM-DD" 문자열을 new Date()로 시각을
 * 붙이지 않고 그대로 파싱하면 스펙상 항상 UTC 자정으로 해석되어 이미
 * 타임존과 무관하다. 그 관례를 그대로 따르면 되고 이 파일의 변환이 필요
 * 없다 — 단, "T00:00:00"처럼 시각을 붙이되 "Z"(UTC 표시)를 빠뜨리면 그
 * 순간부터는 로컬 시간으로 파싱되어 버그가 되므로 주의(실제로 재현한
 * 문제 중 하나).
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface KstParts {
  year: number;
  month: number; // 0-based(1월=0), Date 생성자/getMonth()와 동일한 관례
  day: number;
  hour: number;
  minute: number;
}

/** 절대 시각(instant)을 KST 벽시계 값(연/월/일/시/분)으로 분해한다. */
export function toKstParts(instant: Date): KstParts {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** "HH:mm" — 절대 시각을 KST 기준 시:분 문자열로. */
export function formatKstTime(instant: Date): string {
  const { hour, minute } = toKstParts(instant);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" + "HH:mm"(둘 다 KST 벽시계 기준 입력)이 실제로 가리키는
 * 절대 시각(Date)을 만든다. 사용자가 미팅 날짜/시작·종료 시간을 KST로
 * 입력했을 때, 저장할 절대 시각을 구하는 데 쓴다. */
export function kstWallClockToInstant(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - KST_OFFSET_MS);
}

/** calendarDate(Task.startDate처럼 "UTC 자정 기준 달력 날짜"로 저장된 값)의
 * 연/월/일에, timeSource(기존에 저장된 절대 시각)의 KST 기준 시:분만 그대로
 * 얹은 새 절대 시각을 만든다. Schedule에서 미팅을 새 날짜로 옮길 때(시간은
 * 유지) 쓴다 — getHours()/setHours() 같은 로컬 접근자를 쓰지 않으므로 서버
 * 런타임 timezone과 무관하게 항상 같은 결과를 준다. */
export function combineDateWithKstTimeOfDay(calendarDate: Date, timeSource: Date): Date {
  const { hour, minute } = toKstParts(timeSource);
  return new Date(
    Date.UTC(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth(), calendarDate.getUTCDate(), hour, minute) - KST_OFFSET_MS,
  );
}
