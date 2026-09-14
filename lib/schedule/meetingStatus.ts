import { TASK_CATEGORY_KEY, TASK_STATUS_KEY } from "@/lib/schedule/constants";
import { toKstParts } from "@/lib/kst";
import type { TaskWithRelations } from "@/lib/schedule/types";

/**
 * Step 5B-7(미팅 반복일정 UX + 회차별 자동 상태) — MEETING은 statusOptionId를
 * 사용자가 직접 고르지 않고, "이 회차(occurrenceDate)의 날짜 + 저장된 시작/종료
 * 시각 + 현재 시각"만으로 예정/진행중/완료를 매번 계산한다(요청사항: DB를
 * 주기적으로 갱신하는 cron/polling 없이 조회 시점 계산 우선). 반복 미팅은 원본
 * Task Row 하나만 있고 미래 회차는 실제 Row가 아니므로(calendarMapper.ts), 절대
 * 원본 Task.statusOptionId 자체를 DONE으로 못박지 않는다 — 대신 이 함수를 매
 * occurrence(단발 미팅은 자기 자신, 반복 미팅은 계산된 각 회차)마다 그 회차의
 * 날짜로 다시 호출해서 "회차별 표시 상태"를 그때그때 얻는다.
 *
 * 단발성 미팅도 동일 함수(getEffectiveTaskStatus)를 거치므로 상태 판단 로직이
 * 하나로 통일된다(요청사항).
 */

const AUTO_MANAGED_STATUSES: readonly string[] = [TASK_STATUS_KEY.TODO, TASK_STATUS_KEY.IN_PROGRESS, TASK_STATUS_KEY.DONE];

/** timeSource(시:분:초만 쓴다)를 occurrenceDate(연/월/일만 쓴다)에 그대로
 * 얹는다 — 반복 회차마다 "그 날짜 + 원래 미팅의 시각"을 재구성하는 데 쓴다. */
function combineDateWithTimeOfDay(occurrenceDate: Date, timeSource: Date): Date {
  const combined = new Date(occurrenceDate);
  combined.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds(), 0);
  return combined;
}

/**
 * current < start → TODO(예정)
 * start <= current < end → IN_PROGRESS(진행중)
 * current >= end → DONE(완료)
 */
export function computeMeetingOccurrenceStatus(occurrenceDate: Date, startTimeIso: string, endTimeIso: string, now: Date): string {
  const start = combineDateWithTimeOfDay(occurrenceDate, new Date(startTimeIso));
  const end = combineDateWithTimeOfDay(occurrenceDate, new Date(endTimeIso));
  if (now.getTime() < start.getTime()) return TASK_STATUS_KEY.TODO;
  if (now.getTime() < end.getTime()) return TASK_STATUS_KEY.IN_PROGRESS;
  return TASK_STATUS_KEY.DONE;
}

/**
 * Step(예정 → 진행중 자동 상태 표시) — MEETING 이외 모든 업무구분 공용. DB의
 * statusOptionId는 절대 갱신하지 않고 표시용으로만 계산한다(요청사항: "매일
 * 강제 UPDATE하지 않는다"). 저장된 값이 예약 "TODO"일 때만 관여하고, 그
 * 외(IN_PROGRESS/DONE/ON_HOLD/사용자 정의 상태)는 그대로 존중한다 — 신규
 * 옵션은 기본 GENERIC 동작, 사람이 고른 값을 자동 계산이 덮어쓰지 않는다.
 *
 * startDate도 dueDate와 같은 "달력 날짜"(UTC 자정 기준)라 오늘의 KST 달력
 * 날짜(toKstParts 기반, lib/kst.ts 참고)와 날짜 단위로만 비교한다 — 오늘이
 * startDate 이후(오늘 >= startDate)면 진행중으로 표시한다.
 */
function computeGeneralEffectiveStatus(statusOptionId: string, startDate: Date | string, now: Date): string {
  if (statusOptionId !== TASK_STATUS_KEY.TODO) return statusOptionId;
  const { year, month, day } = toKstParts(now);
  const todayCalendarMs = Date.UTC(year, month, day);
  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  return todayCalendarMs >= start.getTime() ? TASK_STATUS_KEY.IN_PROGRESS : statusOptionId;
}

/**
 * Calendar(Month/Week)가 "표시할 상태"를 결정할 때 공통으로 부르는 진입점.
 *
 * MEETING이면 저장된 statusOptionId가 TODO/IN_PROGRESS/DONE 예약 3종이 아닐
 * 때(예: 사용자가 "보류"로 직접 바꿨거나, 사용자 정의 상태를 골랐다면) 그
 * 값을 그대로 존중한다 — 예외적으로 사람이 개입해야 하는 상태는 자동 계산이
 * 절대 덮어쓰지 않는다(요청사항: 자동 상태와 수동 예외 상태 충돌 방지).
 * endTime이 없는(레거시) 미팅도 안전하게 저장된 값을 그대로 쓴다 — 이 컬럼이
 * 생기기 전에는 자동 계산 자체가 없었으므로, 새 로직이 옛 데이터를 잘못
 * 재해석하지 않게 하기 위한 안전장치다.
 *
 * MEETING이 아니면 computeGeneralEffectiveStatus(예정→진행중, 요청사항)로
 * 넘긴다 — TaskDetailPanel의 MEETING 전용 실시간 미리보기는 이 함수를 쓰지
 * 않고 별도 계산을 유지한다(범위 밖, 회귀 없음).
 */
export function getEffectiveTaskStatus(task: TaskWithRelations, occurrenceDate: Date, now: Date = new Date()): string {
  if (task.category !== TASK_CATEGORY_KEY.MEETING) {
    return computeGeneralEffectiveStatus(task.status, task.startDate, now);
  }
  if (!AUTO_MANAGED_STATUSES.includes(task.status)) return task.status;

  const startTimeIso = task.meetingDetail?.time ?? null;
  const endTimeIso = task.meetingDetail?.endTime ?? null;
  if (!startTimeIso || !endTimeIso) return task.status;

  return computeMeetingOccurrenceStatus(occurrenceDate, startTimeIso, endTimeIso, now);
}
