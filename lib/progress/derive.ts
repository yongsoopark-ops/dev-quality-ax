import { PROGRESS_ROUND_STAGE_INDEX, PROGRESS_SAMPLE_STAGE_PW3_INDEX, PROGRESS_SAMPLE_STAGE_PW4_INDEX, pwStageLabel } from "@/lib/progress/constants";
import { addMonthsToDate, daysBetweenDates, parseIsoDate, todayCalendarDate } from "@/lib/progress/date";
import type { ProgressCommonTaskRow, ProgressRegularProjectRow, ProgressSubProjectRow } from "@/lib/progress/types";

/**
 * 진행 현황 — 순수 파생값 계산(DB 의존 없음). ZIP 분석 리포트가 정리한
 * 규칙을 그대로 옮긴다. Server Component(초기 렌더)와 Client Component
 * (Action 직후 Optimistic 재계산 없이 revalidatePath로 새 Row를 받은 뒤의
 * 재렌더)에서 동일하게 쓸 수 있도록 순수 함수로만 구성한다.
 */

/** "현재 단계" — stageRunIndexes 중 최댓값(ZIP curStage: 8칸을 순서대로
 * 훑어 마지막 "run"을 찾는 것과 동일 — PW1~PW8 순서가 index 오름차순이라
 * 결과가 같다). 하나도 없으면 -1(미착수). */
export function currentStageIndex(runIndexes: number[]): number {
  return runIndexes.length ? Math.max(...runIndexes) : -1;
}

export function currentStageText(runIndexes: number[]): string {
  const cur = currentStageIndex(runIndexes);
  return cur === -1 ? "미착수" : pwStageLabel(cur);
}

/** 개선 차수 배지 값 — PW4(index 3)가 현재 단계일 때만 0보다 크다(ZIP
 * effRounds, §3). */
export function effectiveRounds(runIndexes: number[], storedRounds: number): number {
  return currentStageIndex(runIndexes) === PROGRESS_ROUND_STAGE_INDEX ? Math.max(1, storedRounds) : 0;
}

export type BadgeTone = "none" | "ok" | "soon" | "late" | "done";

export interface DDayBadge {
  text: string;
  tone: BadgeTone;
  tooltip: string;
}

/** PW8 검토(품질 유효성 평가) — 실제 출시일 기준 3개월 후(ZIP §2). 핸드오프
 * §4.5: 배지에 잔여 일수(D-N/D-DAY/D+N)를 함께 표시하고, 검토일이 지나면
 * 주황으로 강조한다. */
export function pw8ReviewBadge(actualReleaseDate: string): DDayBadge | null {
  const actual = parseIsoDate(actualReleaseDate);
  if (!actual) return null;
  const reviewDate = addMonthsToDate(actual, 3);
  const left = daysBetweenDates(todayCalendarDate(), reviewDate);
  const y = reviewDate.getUTCFullYear();
  const m = String(reviewDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(reviewDate.getUTCDate()).padStart(2, "0");
  const dSuffix = left > 0 ? `D-${left}` : left === 0 ? "D-DAY" : `D+${-left}`;
  return {
    text: `PW8 검토 ${y}.${m}.${d} ${dSuffix}`,
    tone: left <= 0 ? "soon" : "ok",
    tooltip: "실제 출시일 기준 3개월 후 PW8 품질 유효성 평가",
  };
}

/** 일정 D-day 배지 — 목표/실제 출시일 조합에 따른 표시(ZIP §6). */
export function releaseDday(targetReleaseDate: string, actualReleaseDate: string): DDayBadge {
  const target = parseIsoDate(targetReleaseDate);
  const actual = parseIsoDate(actualReleaseDate);
  const today = todayCalendarDate();

  if (actual) {
    const elapsed = daysBetweenDates(actual, today);
    const review = pw8ReviewBadge(actualReleaseDate);
    let tooltip = `실제 출시일 기준 ${elapsed}일 경과.`;
    if (target) {
      const gap = daysBetweenDates(target, actual);
      tooltip += gap > 0 ? ` 목표 대비 ${gap}일 지연.` : gap < 0 ? ` 목표 대비 ${Math.abs(gap)}일 단축.` : " 목표일 준수.";
    }
    if (review) tooltip += ` ${review.tooltip}(${review.text.replace("PW8 검토 ", "")}).`;
    const left = review ? daysBetweenDates(today, addMonthsToDate(actual, 3)) : Infinity;
    const tone: BadgeTone = left <= 0 ? "soon" : left <= 30 ? "ok" : "done";
    return { text: `출시 D+${elapsed}`, tone, tooltip: tooltip.trim() };
  }

  if (target) {
    const n = daysBetweenDates(today, target);
    const text = n > 0 ? `D-${n}` : n === 0 ? "D-DAY" : `D+${-n}`;
    const tone: BadgeTone = n <= 0 ? "late" : n <= 30 ? "soon" : "ok";
    return { text, tone, tooltip: n >= 0 ? `목표 출시까지 ${n}일 남음` : `목표 출시일이 ${-n}일 지났습니다` };
  }

  return { text: "출시일 미정", tone: "none", tooltip: "목표/실제 출시일이 아직 등록되지 않았습니다" };
}

/** 샘플 확보(PW3/PW4 전용) D-day — 현재 단계가 그 두 단계일 때만 의미가
 * 있다(ZIP §2). */
export function sampleDday(runIndexes: number[], samplePw3Date: string, samplePw4Date: string): DDayBadge | null {
  const cur = currentStageIndex(runIndexes);
  const dateStr = cur === PROGRESS_SAMPLE_STAGE_PW3_INDEX ? samplePw3Date : cur === PROGRESS_SAMPLE_STAGE_PW4_INDEX ? samplePw4Date : "";
  const date = parseIsoDate(dateStr);
  if (!date) return null;
  const n = daysBetweenDates(todayCalendarDate(), date);
  const text = n > 0 ? `샘플 D-${n}` : n === 0 ? "샘플 D-DAY" : `샘플 D+${-n}`;
  const tone: BadgeTone = n <= 0 ? "late" : n <= 14 ? "soon" : "ok";
  return { text, tone, tooltip: `샘플 확보 예정 ${dateStr} · ${n >= 0 ? `${n}일 남음` : `${-n}일 경과`}` };
}

/** 서브 프로젝트 완료 — status가 done이거나, 모든 세부 목표가 완료(ZIP
 * subDone, §4). status/items 각 항목의 status만 있으면 되므로, 호출부가
 * Row 전체를 만들 필요 없이 최소 구조만 넘길 수 있게 구조적 타입을 쓴다. */
export function isSubProjectDone(row: { status: ProgressSubProjectRow["status"]; items: { status: ProgressSubProjectRow["items"][number]["status"] }[] }): boolean {
  if (row.status === "DONE") return true;
  return row.items.length > 0 && row.items.every((it) => it.status === "DONE");
}

/** 공통 업무 완료 — 그룹 자체엔 status가 없고 항목 전부 완료일 때만(ZIP
 * commonDone, §5). */
export function isCommonTaskDone(row: { items: { status: ProgressCommonTaskRow["items"][number]["status"] }[] }): boolean {
  return row.items.length > 0 && row.items.every((it) => it.status === "DONE");
}

/** 공통 업무가 지금 보고 있는 월에 항목을 갖고 있는지 — "업무 유형" 필터
 * 칩의 공통 건수가 서브(isSubProjectDone과 quarter 일치 조건 조합)와 같은
 * 기준으로 선택된 기간에 반응하도록 분리한 순수 함수. */
export function isCommonTaskActiveInMonth(
  row: { items: { monthYear: number; monthNum: number }[] },
  month: { year: number; month: number },
): boolean {
  return row.items.some((it) => it.monthYear === month.year && it.monthNum === month.month);
}

/** 반복 업무 기준일 경과 강조(핸드오프 §4.10 repeatOverdue) — 실제
 * 오늘이 속한 달의 항목이고, 오늘이 기준일을 지났을 때만 true. 말일은 그
 * 달의 마지막 날로 계산한다. */
export function isRepeatDueDayPassed(repeatDay: string, viewMonth: { year: number; month: number }): boolean {
  const today = todayCalendarDate();
  if (viewMonth.year !== today.getUTCFullYear() || viewMonth.month !== today.getUTCMonth() + 1) return false;
  const lastDay = new Date(Date.UTC(viewMonth.year, viewMonth.month, 0)).getUTCDate();
  const dueDay = repeatDay === "last" ? lastDay : parseInt(repeatDay, 10);
  return today.getUTCDate() > dueDay;
}

/** 서브 프로젝트의 실제 등록 구간(min~max 분기) — 명목상 quarterStart/End와
 * 별개로 항목들이 실제로 걸쳐 있는 범위(ZIP qSpan, §4). */
export function subProjectItemSpan(items: { quarterYear: number; quarterNum: number }[]): { start: { year: number; q: number }; end: { year: number; q: number } } | null {
  if (items.length === 0) return null;
  const idx = (i: { quarterYear: number; quarterNum: number }) => i.quarterYear * 4 + (i.quarterNum - 1);
  let min = items[0];
  let max = items[0];
  for (const it of items) {
    if (idx(it) < idx(min)) min = it;
    if (idx(it) > idx(max)) max = it;
  }
  return { start: { year: min.quarterYear, q: min.quarterNum }, end: { year: max.quarterYear, q: max.quarterNum } };
}
