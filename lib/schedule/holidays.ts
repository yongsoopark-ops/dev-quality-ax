import Holidays from "date-holidays";

/**
 * Step(일정 관리 + 회의록 UI Polish) — 대한민국 공휴일 표시(요청사항 6).
 * "구현 전에 현재 코드베이스에 휴일 source/library가 있는지 확인, 없다면
 * 안정적인 계산/데이터 소스를 최소 범위로 사용, 임의 날짜 하드코딩은 피한다"
 * (요청사항) — 확인 결과 기존에 없었다. `date-holidays`(MIT, 널리 쓰이는
 * 라이브러리)를 새로 설치해 대체공휴일 규칙과 음력 기반 공휴일(설날/추석)의
 * 실제 계산 규칙까지 내장된 데이터를 그대로 쓴다 — 날짜를 직접 계산하거나
 * 하드코딩하지 않는다.
 *
 * `Holidays` 인스턴스 생성 자체가 내부적으로 데이터 파일을 파싱하는 비용이
 * 있어 모듈 스코프에서 한 번만 만들어 재사용한다(Task 목록처럼 매 렌더
 * 반복 조회되는 값이 아니라 서버 프로세스 생명주기 동안 사실상 상수).
 */
const kr = new Holidays("KR");

/** 이 날짜가 대한민국 공휴일이면 그 이름을(예: "추석", "개천절 (대체공휴일)"),
 * 아니면 null을 반환한다. 설날/추석처럼 여러 날에 걸친 공휴일도
 * `Holidays.isHoliday`가 날짜별로 정확히 판별해 준다(추석 연휴 3일 각각을
 * 직접 날짜 범위로 펼칠 필요가 없다). `type === "public"`만 실제 공휴일로
 * 취급한다 — 라이브러리가 함께 제공하는 관찰용(observance) 항목은 제외한다. */
export function getHolidayName(date: Date): string | null {
  const result = kr.isHoliday(date);
  if (!result) return null;
  const publicHoliday = result.find((h) => h.type === "public");
  return publicHoliday?.name ?? null;
}
