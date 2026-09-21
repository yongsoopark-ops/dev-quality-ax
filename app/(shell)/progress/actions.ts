"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseIsoDate, addMonthsTo, monthsBetween, compareMonth, currentCalendarMonth, compareQuarter } from "@/lib/progress/date";
import { PROGRESS_SAMPLE_STAGE_PW3_INDEX } from "@/lib/progress/constants";
import { cycleSubItemStatus } from "@/lib/progress/derive";
import type { ProgressItemStatus, ProgressStatus } from "@/app/generated/prisma/enums";

/**
 * 진행 현황 — 모든 mutation은 이 파일 하나에 모은다(설비 관리 actions.ts와
 * 동일한 관례). ZIP(진행 현황 관리판 v2.dc.html)의 각 Component 메서드를
 * 실제 DB Transaction으로 옮긴 것이다 — 대응 관계는 각 함수 주석 참고.
 */

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("FORBIDDEN");
  return session;
}

function revalidateProgress() {
  revalidatePath("/progress");
}

type ActionResult = { ok?: true; error?: string };

function parseIsoDateOrNull(value: string): Date | null {
  if (!value) return null;
  return parseIsoDate(value);
}

// ── 정규 프로젝트 ───────────────────────────────────────────────────────

export interface RegularProjectFormInput {
  name: string;
  ownerId: string;
  status: ProgressStatus;
  kickoffDate: string;
  targetReleaseDate: string;
  actualReleaseDate: string;
  samplePw3Date: string;
  samplePw4Date: string;
  artifactUrl: string;
}

function regularProjectData(input: RegularProjectFormInput) {
  return {
    name: input.name.trim(),
    ownerId: input.ownerId,
    status: input.status,
    kickoffDate: parseIsoDateOrNull(input.kickoffDate),
    targetReleaseDate: parseIsoDateOrNull(input.targetReleaseDate),
    actualReleaseDate: parseIsoDateOrNull(input.actualReleaseDate),
    samplePw3Date: parseIsoDateOrNull(input.samplePw3Date),
    samplePw4Date: parseIsoDateOrNull(input.samplePw4Date),
    artifactUrl: input.artifactUrl.trim() || null,
  };
}

export async function createRegularProjectAction(input: RegularProjectFormInput): Promise<ActionResult> {
  await requireUser();
  if (!input.name.trim()) return { error: "이름을 입력해 주세요." };
  await prisma.progressRegularProject.create({ data: regularProjectData(input) });
  revalidateProgress();
  return { ok: true };
}

export async function updateRegularProjectAction(id: string, input: RegularProjectFormInput): Promise<ActionResult> {
  await requireUser();
  if (!input.name.trim()) return { error: "이름을 입력해 주세요." };
  await prisma.progressRegularProject.update({ where: { id }, data: regularProjectData(input) });
  revalidateProgress();
  return { ok: true };
}

export async function deleteRegularProjectAction(id: string): Promise<ActionResult> {
  await requireUser();
  await prisma.progressRegularProject.delete({ where: { id } });
  revalidateProgress();
  return { ok: true };
}

export async function setRegularProjectStatusAction(id: string, status: ProgressStatus): Promise<ActionResult> {
  await requireUser();
  await prisma.progressRegularProject.update({ where: { id }, data: { status } });
  revalidateProgress();
  return { ok: true };
}

/** PW 단계 레일의 팝업(진행/생략/취소) — ZIP은 8칸 고정 배열의 해당 index를
 * "run"/"skip"/""로 바꾸는 것뿐이다. 여기선 run/skip 두 index 배열에서 그
 * index를 먼저 지운 뒤 필요하면 한쪽에 다시 넣는다. */
export async function setRegularProjectStageAction(id: string, stageIndex: number, mark: "RUN" | "SKIP" | "NONE"): Promise<ActionResult> {
  await requireUser();
  const row = await prisma.progressRegularProject.findUnique({ where: { id }, select: { stageRunIndexes: true, stageSkipIndexes: true } });
  if (!row) return { error: "프로젝트를 찾을 수 없습니다." };
  const run = row.stageRunIndexes.filter((i) => i !== stageIndex);
  const skip = row.stageSkipIndexes.filter((i) => i !== stageIndex);
  if (mark === "RUN") run.push(stageIndex);
  if (mark === "SKIP") skip.push(stageIndex);
  await prisma.progressRegularProject.update({ where: { id }, data: { stageRunIndexes: run, stageSkipIndexes: skip } });
  revalidateProgress();
  return { ok: true };
}

/** PW3/PW4 팝업 안에서 바로 고치는 "샘플 확보" 날짜 — 카드에서 즉시
 * 반영되는 퀵 액션이라 전체 폼을 거치지 않는다. */
export async function setRegularProjectSampleDateAction(id: string, stageIndex: number, value: string): Promise<ActionResult> {
  await requireUser();
  const date = parseIsoDateOrNull(value);
  const field = stageIndex === PROGRESS_SAMPLE_STAGE_PW3_INDEX ? "samplePw3Date" : "samplePw4Date";
  await prisma.progressRegularProject.update({ where: { id }, data: { [field]: date } });
  revalidateProgress();
  return { ok: true };
}

/** "+ 다음 차수로" / PW4 팝업의 "차수 추가" 둘 다 이 Action 하나를 쓴다(ZIP
 * 양쪽 다 `Math.max(1, rCount(rounds)) + 1`로 동일). */
export async function incrementRegularProjectRoundAction(id: string): Promise<ActionResult> {
  await requireUser();
  const row = await prisma.progressRegularProject.findUnique({ where: { id }, select: { improvementRounds: true } });
  if (!row) return { error: "프로젝트를 찾을 수 없습니다." };
  await prisma.progressRegularProject.update({ where: { id }, data: { improvementRounds: Math.max(1, row.improvementRounds) + 1 } });
  revalidateProgress();
  return { ok: true };
}

/** "차수 취소" — 1보다 클 때만 1 감소(ZIP removeRound: cur>1일 때만 동작,
 * 1 이하로는 내려가지 않는다). */
export async function decrementRegularProjectRoundAction(id: string): Promise<ActionResult> {
  await requireUser();
  const row = await prisma.progressRegularProject.findUnique({ where: { id }, select: { improvementRounds: true } });
  if (!row) return { error: "프로젝트를 찾을 수 없습니다." };
  if (row.improvementRounds > 1) {
    await prisma.progressRegularProject.update({ where: { id }, data: { improvementRounds: row.improvementRounds - 1 } });
    revalidateProgress();
  }
  return { ok: true };
}

/** 업데이트 로그 추가 — ZIP은 읽기 전용 표시만 있었다(작성 UI 없음, ZIP
 * 분석 리포트 §12-3). 실제 데이터로 운영하려면 로그를 남길 방법이 있어야
 * 해서 추가한 최소 입력이다(REVIEW_REQUIRED, 최종 보고 참고). */
export async function addRegularProjectUpdateLogAction(id: string, content: string): Promise<ActionResult> {
  const session = await requireUser();
  const trimmed = content.trim();
  if (!trimmed) return { error: "내용을 입력해 주세요." };
  await prisma.progressUpdateLog.create({ data: { projectId: id, authorId: session.user.id, content: trimmed } });
  revalidateProgress();
  return { ok: true };
}

// ── 서브 프로젝트 ───────────────────────────────────────────────────────

export interface SubProjectItemInput {
  text: string;
  quarterYear: number;
  quarterNum: number;
  status: ProgressItemStatus;
  order: number;
}

export interface SubProjectFormInput {
  name: string;
  ownerId: string;
  status: ProgressStatus;
  quarterStartYear: number;
  quarterStartQ: number;
  quarterEndYear: number;
  quarterEndQ: number;
  sheetUrl: string;
  items: SubProjectItemInput[];
}

function quarterIdx(year: number, q: number) {
  return year * 4 + (q - 1);
}

function validateSubProjectInput(input: SubProjectFormInput): string | null {
  if (!input.name.trim()) return "이름을 입력해 주세요.";
  if (quarterIdx(input.quarterEndYear, input.quarterEndQ) < quarterIdx(input.quarterStartYear, input.quarterStartQ)) {
    return "종료 분기가 시작 분기보다 앞설 수 없습니다.";
  }
  if (input.items.filter((it) => it.text.trim()).length === 0) return "세부 목표를 1개 이상 입력해 주세요.";
  return null;
}

export async function createSubProjectAction(input: SubProjectFormInput): Promise<ActionResult> {
  await requireUser();
  const error = validateSubProjectInput(input);
  if (error) return { error };
  const items = input.items.filter((it) => it.text.trim());
  await prisma.progressSubProject.create({
    data: {
      name: input.name.trim(),
      ownerId: input.ownerId,
      status: input.status,
      quarterStartYear: input.quarterStartYear,
      quarterStartQ: input.quarterStartQ,
      quarterEndYear: input.quarterEndYear,
      quarterEndQ: input.quarterEndQ,
      sheetUrl: input.sheetUrl.trim() || null,
      items: { create: items.map((it) => ({ text: it.text.trim(), quarterYear: it.quarterYear, quarterNum: it.quarterNum, status: it.status, order: it.order })) },
    },
  });
  revalidateProgress();
  return { ok: true };
}

/** 세부 목표는 Drag 재정렬/추가/삭제가 전부 Client 쪽 Draft 배열에서 먼저
 * 이뤄지고 저장 시 한 번에 반영된다 — ZIP의 `rec.items = ...`(전체 재할당)와
 * 동일하게, 기존 Row를 전부 지우고 Draft로 다시 만든다(Transaction). */
export async function updateSubProjectAction(id: string, input: SubProjectFormInput): Promise<ActionResult> {
  await requireUser();
  const error = validateSubProjectInput(input);
  if (error) return { error };
  const items = input.items.filter((it) => it.text.trim());
  await prisma.$transaction([
    prisma.progressSubProjectItem.deleteMany({ where: { subProjectId: id } }),
    prisma.progressSubProject.update({
      where: { id },
      data: {
        name: input.name.trim(),
        ownerId: input.ownerId,
        status: input.status,
        quarterStartYear: input.quarterStartYear,
        quarterStartQ: input.quarterStartQ,
        quarterEndYear: input.quarterEndYear,
        quarterEndQ: input.quarterEndQ,
        sheetUrl: input.sheetUrl.trim() || null,
        items: { create: items.map((it) => ({ text: it.text.trim(), quarterYear: it.quarterYear, quarterNum: it.quarterNum, status: it.status, order: it.order })) },
      },
    }),
  ]);
  revalidateProgress();
  return { ok: true };
}

export async function deleteSubProjectAction(id: string): Promise<ActionResult> {
  await requireUser();
  await prisma.progressSubProject.delete({ where: { id } });
  revalidateProgress();
  return { ok: true };
}

export async function setSubProjectStatusAction(id: string, status: ProgressStatus): Promise<ActionResult> {
  await requireUser();
  await prisma.progressSubProject.update({ where: { id }, data: { status } });
  revalidateProgress();
  return { ok: true };
}

/** 세부 목표 항목의 예정→진행중→완료→예정 순환. */
export async function toggleSubProjectItemStatusAction(itemId: string): Promise<ActionResult> {
  await requireUser();
  const item = await prisma.progressSubProjectItem.findUnique({ where: { id: itemId }, select: { status: true } });
  if (!item) return { error: "항목을 찾을 수 없습니다." };
  await prisma.progressSubProjectItem.update({ where: { id: itemId }, data: { status: cycleSubItemStatus(item.status) } });
  revalidateProgress();
  return { ok: true };
}

/** 요청 1(재설계) — "다음 분기로"만 가능한 고정 이월 대신, 프로젝트에 이미
 * 설정된 분기 구간(quarterStart~End) 중 아무 분기로나 직접 지정한다. UI가
 * 이미 그 구간 밖의 값은 절대 보내지 않지만(ProgressCards.tsx의
 * projectQuarters 드롭다운), 방어적으로 서버에서도 그 프로젝트의 실제
 * 구간 안인지 확인한다 — 임의 분기로 튀는 걸 막는다. */
export async function setSubProjectItemQuarterAction(itemId: string, year: number, q: number): Promise<ActionResult> {
  await requireUser();
  const item = await prisma.progressSubProjectItem.findUnique({
    where: { id: itemId },
    select: { subProject: { select: { quarterStartYear: true, quarterStartQ: true, quarterEndYear: true, quarterEndQ: true } } },
  });
  if (!item) return { error: "항목을 찾을 수 없습니다." };
  const target = { year, q: q as 1 | 2 | 3 | 4 };
  const start = { year: item.subProject.quarterStartYear, q: item.subProject.quarterStartQ as 1 | 2 | 3 | 4 };
  const end = { year: item.subProject.quarterEndYear, q: item.subProject.quarterEndQ as 1 | 2 | 3 | 4 };
  if (compareQuarter(target, start) < 0 || compareQuarter(target, end) > 0) {
    return { error: "이 프로젝트에 설정된 분기 구간 밖입니다." };
  }
  await prisma.progressSubProjectItem.update({ where: { id: itemId }, data: { quarterYear: year, quarterNum: q } });
  revalidateProgress();
  return { ok: true };
}

// ── 공통 업무 ───────────────────────────────────────────────────────────

export interface CommonTaskFormInput {
  name: string;
  ownerId: string;
  repeat: boolean;
  repeatDay: string;
  monthStartYear: number;
  monthStartNum: number;
  monthEndYear: number;
  monthEndNum: number;
}

function monthIdx(year: number, month: number) {
  return year * 12 + (month - 1);
}

function validateCommonTaskInput(input: CommonTaskFormInput): string | null {
  if (!input.name.trim()) return "이름을 입력해 주세요.";
  if (monthIdx(input.monthEndYear, input.monthEndNum) < monthIdx(input.monthStartYear, input.monthStartNum)) {
    return "종료 월이 시작 월보다 앞설 수 없습니다.";
  }
  return null;
}

export async function createCommonTaskAction(input: CommonTaskFormInput): Promise<ActionResult> {
  await requireUser();
  const error = validateCommonTaskInput(input);
  if (error) return { error };
  const span = monthsBetween({ year: input.monthStartYear, month: input.monthStartNum }, { year: input.monthEndYear, month: input.monthEndNum });
  await prisma.progressCommonTask.create({
    data: {
      name: input.name.trim(),
      ownerId: input.ownerId,
      repeat: input.repeat,
      repeatDay: input.repeat ? input.repeatDay : null,
      monthStartYear: input.monthStartYear,
      monthStartNum: input.monthStartNum,
      monthEndYear: input.monthEndYear,
      monthEndNum: input.monthEndNum,
      items: { create: span.map((m) => ({ monthYear: m.year, monthNum: m.month })) },
    },
  });
  revalidateProgress();
  return { ok: true };
}

/** 이름/담당자/반복/대상 월 구간을 고치는 수정 — ZIP은 저장 시 대상 월
 * 구간의 항목을 통째로 다시 만들지만(기존 상태만 달별로 이어받음), 여기서는
 * "이월"로 같은 달에 항목이 여러 개일 수 있어(§12 재검토 — 스키마 주석 참고)
 * 단순 덮어쓰기 대신 다음 규칙으로 최소 변경만 한다:
 *  - 새 구간 밖으로 벗어난 기존 항목은 삭제한다(ZIP의 "구간 재설정 = 계획
 *    재작성" 의도를 그대로 따름).
 *  - 새 구간 안에 이미 항목이 있는 달은 손대지 않는다(완료 여부·이월 이력
 *    보존).
 *  - 새 구간에 새로 들어온 달(기존 항목이 전혀 없던 달)만 새 항목을 만든다. */
export async function updateCommonTaskAction(id: string, input: CommonTaskFormInput): Promise<ActionResult> {
  await requireUser();
  const error = validateCommonTaskInput(input);
  if (error) return { error };
  const span = monthsBetween({ year: input.monthStartYear, month: input.monthStartNum }, { year: input.monthEndYear, month: input.monthEndNum });
  const spanKeys = new Set(span.map((m) => `${m.year}-${m.month}`));

  const existing = await prisma.progressCommonTaskItem.findMany({ where: { commonTaskId: id }, select: { id: true, monthYear: true, monthNum: true } });
  const outsideIds = existing.filter((it) => !spanKeys.has(`${it.monthYear}-${it.monthNum}`)).map((it) => it.id);
  const presentKeys = new Set(existing.filter((it) => spanKeys.has(`${it.monthYear}-${it.monthNum}`)).map((it) => `${it.monthYear}-${it.monthNum}`));
  const missing = span.filter((m) => !presentKeys.has(`${m.year}-${m.month}`));

  await prisma.$transaction([
    prisma.progressCommonTaskItem.deleteMany({ where: { id: { in: outsideIds } } }),
    prisma.progressCommonTask.update({
      where: { id },
      data: {
        name: input.name.trim(),
        ownerId: input.ownerId,
        repeat: input.repeat,
        repeatDay: input.repeat ? input.repeatDay : null,
        monthStartYear: input.monthStartYear,
        monthStartNum: input.monthStartNum,
        monthEndYear: input.monthEndYear,
        monthEndNum: input.monthEndNum,
        items: { create: missing.map((m) => ({ monthYear: m.year, monthNum: m.month })) },
      },
    }),
  ]);
  revalidateProgress();
  return { ok: true };
}

/** "매월 반복" 버그 수정 — 코드 확인 결과 `repeat`/`repeatDay`는 지금까지
 * ①"매월 N일" 표시 태그, ②기준일 경과 강조(isRepeatDueDayPassed)에만
 * 쓰였고, 실제로 새 달이 될 때 항목을 자동 생성하는 코드 경로가 어디에도
 * 없었다 — `ProgressCommonTaskItem`은 등록/수정 시점에 지정한
 * monthStart~monthEnd 구간에 대해서만 한 번 만들어지고(createCommonTaskAction/
 * updateCommonTaskAction), 그 뒤로 monthEnd는 사용자가 직접 수정 폼을 다시
 * 저장하기 전까지는 절대 넓어지지 않는다. 그래서 9월까지로 등록해 둔
 * "매월 20일 반복" 업무는 10월이 실제로 와도 10월 항목이 저절로 생기지
 * 않았다(반복 로직 자체가 없었던 것이지, 조건 분기가 잘못된 게 아니다).
 *
 * 1차 수정(오늘이 속한 달까지만 채움) 이후 실사용 확인에서 또 다른 문제가
 * 드러났다 — 공통 업무 월 이동(‹ ›)은 서버 재조회 없이 이미 받아온
 * 데이터만 넘겨보는 구조라, "아직 오지 않은 달"(예: 오늘이 9월인데 10월을
 * 미리 눌러보는 경우)은 그 시점에 DB에 항목 자체가 없어 항상 비어
 * 보였다("연속해서 예약 등록되지 않는다"로 보고된 증상). 고침: 목표를
 * "오늘이 속한 달"이 아니라 "오늘이 속한 달 + 11개월"(총 1년치)로 올려서,
 * 페이지 진입마다 항상 향후 1년 분량이 미리 채워지게 한다. */
export async function extendRepeatingCommonTasksToCurrentMonth(): Promise<void> {
  // 1년(12개월) 앞까지 항상 미리 채워 둔다 — 오늘이 속한 달 포함 12개월.
  const target = addMonthsTo(currentCalendarMonth(), 11);
  const repeating = await prisma.progressCommonTask.findMany({
    where: { repeat: true },
    select: { id: true, monthEndYear: true, monthEndNum: true },
  });
  const behind = repeating.filter((t) => compareMonth(target, { year: t.monthEndYear, month: t.monthEndNum }) > 0);
  if (behind.length === 0) return;

  await prisma.$transaction(
    behind.map((t) => {
      const missing = monthsBetween(addMonthsTo({ year: t.monthEndYear, month: t.monthEndNum }, 1), target);
      return prisma.progressCommonTask.update({
        where: { id: t.id },
        data: {
          monthEndYear: target.year,
          monthEndNum: target.month,
          items: { create: missing.map((m) => ({ monthYear: m.year, monthNum: m.month })) },
        },
      });
    }),
  );
  // revalidatePath는 호출하지 않는다 — 이 함수는 page.tsx(Server Component)
  // 렌더 중에 직접 호출되고, 바로 다음 줄에서 getCommonTasks()를 다시
  // 조회해 같은 요청 안에서 최신 데이터를 그대로 쓴다(Prisma 직접 호출은
  // Next Data Cache 대상이 아니라 애초에 무효화할 캐시가 없다). 이 페이지는
  // 세션 게이팅으로 항상 동적 렌더링되므로 다음 요청도 자동으로 최신이다.
}

export async function deleteCommonTaskAction(id: string): Promise<ActionResult> {
  await requireUser();
  await prisma.progressCommonTask.delete({ where: { id } });
  revalidateProgress();
  return { ok: true };
}

export async function toggleCommonTaskItemStatusAction(itemId: string): Promise<ActionResult> {
  await requireUser();
  const item = await prisma.progressCommonTaskItem.findUnique({ where: { id: itemId }, select: { status: true } });
  if (!item) return { error: "항목을 찾을 수 없습니다." };
  await prisma.progressCommonTaskItem.update({ where: { id: itemId }, data: { status: item.status === "DONE" ? "WAITING" : "DONE" } });
  revalidateProgress();
  return { ok: true };
}

/** 이월 — 항목의 월을 한 달 뒤로 옮기고, 최초 1회만 원래 달을 carriedFrom에
 * 기록한다(ZIP §5: "다시 이월돼도 원래 월을 계속 가리킴"). 같은 달에 이미
 * 다른 항목이 있어도 그대로 둔다(§12 재검토 — 스키마 주석 참고, 같은 업무가
 * 한 달에 "원래 계획 + 이월분" 2건으로 보일 수 있다). */
export async function carryForwardCommonTaskItemAction(itemId: string): Promise<ActionResult> {
  await requireUser();
  const item = await prisma.progressCommonTaskItem.findUnique({ where: { id: itemId } });
  if (!item) return { error: "항목을 찾을 수 없습니다." };
  const next = addMonthsTo({ year: item.monthYear, month: item.monthNum }, 1);
  await prisma.progressCommonTaskItem.update({
    where: { id: itemId },
    data: {
      monthYear: next.year,
      monthNum: next.month,
      carriedFromYear: item.carriedFromYear ?? item.monthYear,
      carriedFromMonth: item.carriedFromMonth ?? item.monthNum,
    },
  });
  revalidateProgress();
  return { ok: true };
}
