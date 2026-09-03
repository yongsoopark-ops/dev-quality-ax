"use server";

import { auth } from "@/auth";
import { formatKstTime } from "@/lib/kst";
import { prisma } from "@/lib/prisma";
import { parseDocumentContentInput, validateDocumentContent } from "@/lib/meetingTemplates/richText";
import { TASK_CATEGORY_KEY } from "@/lib/schedule/constants";
import { computeFirstOccurrenceOnOrAfter, taskRowToRecurrenceRule } from "@/lib/schedule/recurrence";
import { buildWeeklySections, type WeeklyTaskInfo } from "./build";
import { MEETING_FIELD_KEY } from "./fieldSemantics";
import { mergeSectionsIntoDocument } from "./injectDocument";
import { injectMeetingInfoFields } from "./injectMeetingInfo";
import { getWeeklyMeetingRange, type WeekRange } from "./weekRange";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(`일정 불러오기` 버튼 Trigger 전환) — 로그인한 누구나(ADMIN/MEMBER
 * 모두) 쓸 수 있다(기존 정책 그대로).
 */
async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("FORBIDDEN");
  return session;
}

export interface WeeklyScheduleLoadResult {
  range: WeekRange;
  /** Client(Tiptap Editor)에 그대로 넘기는 문서 — 호출부가 넘긴 "지금 화면에
   * 있던 문서"를 deep clone한 뒤 그 clone에만 병합한 결과다. Template DB는
   * 이 함수 안에서 아예 조회조차 하지 않는다.
   *
   * 실제로 재현한 문제(2건째): Server Action 인자(currentDocument)뿐 아니라
   * **반환값**도 같은 이유로 손상될 수 있다 — 여기서는 같은 attrs 모양이
   * 반복되는 큰 문서를 객체 그대로 반환했더니, 일부 heading의 attrs.level
   * (H1/H2/H3 구분) 자체가 사라져 전부 H1로 렌더링되는 현상을 실제로
   * 확인했다. 그래서 이 필드는 JSONContent 객체가 아니라 JSON 문자열로
   * 내려주고, Client(MeetingMinutesPreviewClient.tsx)가 JSON.parse해서
   * 쓴다 — TemplateEditor.tsx가 저장 시 쓰는 것과 같은 우회다. */
  documentJson: string;
  /** 자동 반영이 필요했는데 문서에서 그 heading을 못 찾은 섹션 이름들. */
  missingHeadings: string[];
  taskCount: number;
  /** 대상 업무기간(range)과 별개로, 그 기간을 회고하는 실제 회의 일시
   * ("YYYY-MM-DD HH:mm ~ HH:mm")다. 기준 반복 미팅을 못 찾았거나 다음
   * 회차가 없으면(반복 종료 등) null. */
  meetingDateTime: string | null;
  /** Step(일정 관리 + 회의록 UI Polish) — 상단 compact 컨텍스트 표시
   * (요청사항 8: "파트 주간회의 · 9월 2주차 · 2026.09.07")에 그대로 쓴다.
   * 문서 표에 이미 주입하는 것과 같은 값을 Client 표시용으로도 함께
   * 반환할 뿐, 병합/저장 로직에는 아무 영향이 없다. */
  meetingWeek: string | null;
  /** 기준이 되는 반복 미팅 자체를 Schedule에서 찾지 못했을 때만 채워지는
   * 안내 문구 — missingFields(Template 쪽 문제)와는 원인이 다르다. */
  meetingNotFoundReason: string | null;
  /** 회의 주차/대상 주간/회의 일시/회의 장소 중 채울 값은 있었는데 문서
   * 에서 그 라벨 행을 못 찾은 것들. */
  missingFields: string[];
}

/**
 * "파트 주간 회의"라는 이름 문자열로 찾지 않는다(요청사항). 대신 시스템
 * semantic category(MEETING)와 recurrence rule(WEEKLY)만으로 특정한다.
 *
 * Step(참석자 자동입력) — meetingDetail.attendees도 함께 조회한다.
 * TaskMeetingAttendee에는 별도 순서 컬럼이 없어(스키마 확인 완료) "Schedule에
 * 저장된 참석자 순서를 가능하면 유지"(요청사항)의 가장 안정적인 대안으로
 * id(cuid) 오름차순을 쓴다 — cuid는 생성 시각 순으로 정렬되므로 "참석자로
 * 추가한 순서"에 가장 가까운 근사치다.
 */
async function findPartWeeklyMeetingCandidate() {
  return prisma.task.findMany({
    where: { categoryOptionId: TASK_CATEGORY_KEY.MEETING, recurrenceType: "WEEKLY" },
    orderBy: { createdAt: "asc" },
    include: {
      meetingDetail: {
        include: { attendees: { orderBy: { id: "asc" }, include: { user: { select: { name: true, email: true } } } } },
      },
    },
  });
}

/** 참석자 표시명 목록 — user id가 아니라 표시명(name, 없으면 email)을 쓰고
 * (요청사항), 중복은 제거하되 먼저 나온 순서를 유지한다. */
function extractAttendeeNames(attendees: { user: { name: string | null; email: string } }[] | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const a of attendees ?? []) {
    const name = a.user.name ?? a.user.email;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hotfix Audit(Production KST/UTC 시간대 오차) — 회의 시작/종료 시각은
 * "그 순간이 KST로 몇 시인가"가 진짜 값이다. timeSource.getHours() 같은
 * 로컬 접근자는 서버 런타임이 KST가 아니면(Netlify Production은 UTC)
 * 실제로 관찰된 9시간 오차의 원인이었다 — lib/kst.ts의 formatKstTime으로
 * 교체해 서버 런타임 timezone과 무관하게 항상 KST 기준 시:분을 뽑는다.
 * (예전엔 occurrenceDate 위에 시:분만 얹은 뒤 다시 시:분만 읽었는데,
 * 그 "날짜 얹기"는 반환값에 아무 영향이 없어 occurrenceDate 인자를
 * 그대로 없앴다.) */
function formatTimeOfDay(timeSource: Date): string {
  return formatKstTime(timeSource);
}

/** Step(파트 주간회의 Table UX + AUTO 필드 개편) — "회의 주차"는 실제 회의일이
 * 속한 월의 몇 번째 주인지를 뜻한다(요청사항 예시: 2026-09-07 → "9월
 * 2주차"). 월요일 시작 기준으로 그 달 1일이 속한 주를 1주차로 센다 — 임의
 * 값을 만들지 않고 실제 회의 occurrence 날짜에서만 계산한다.
 *
 * date는 computeFirstOccurrenceOnOrAfter가 계산한 "달력 날짜"(UTC 자정
 * anchored 입력을 그대로 유지하는 값)라 getFullYear()/getMonth()/getDate()
 * 같은 로컬 접근자로 읽어도 서버 런타임 timezone과 무관하게 항상 같은
 * 달력 날짜를 준다(아래 loadWeeklyScheduleIntoDraftAction의 입력 구성
 * 주석 참고) — 여기서는 그대로 둔다. */
function formatMeetingWeek(date: Date): string {
  const month = date.getMonth() + 1;
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstWeekdayMonBased = (firstOfMonth.getDay() + 6) % 7; // 0=월요일
  const weekNumber = Math.ceil((date.getDate() + firstWeekdayMonBased) / 7);
  return `${month}월 ${weekNumber}주차`;
}

/**
 * 예전 getWeeklyMeetingMinutesPreviewAction은 "활성 Template을 조회 → clone
 * → Schedule 자동입력"을 화면 진입/새로고침마다 전부 다시 했다. 이제
 * Template 조회/clone은 화면 진입 시 딱 한 번만(lib/meetingMinutes/draft.ts의
 * buildTemplateOnlyDraft) 하고, 이 함수는 "지금 Client가 들고 있는 문서
 * (currentDocument)"를 받아 그 위에 Schedule 데이터만 병합해 돌려준다.
 *
 * 재클릭 정책(요청사항: "AUTO 데이터만 최신화 + 사람이 작성한 내용 유지")은
 * 이 함수가 아니라 mergeSectionsIntoDocument(injectDocument.ts)가 그룹명·
 * fieldKey 단위로 담당한다. 기본정보 4개 AUTO 필드(회의 주차/대상 주간/
 * 회의 일시/회의 장소)는 injectMeetingInfoFields가 담당한다 — 라벨 셀을
 * fieldKey로 찾아 그 행의 값 셀만 바꾸는 방식이라 원래도 재호출에 안전하다.
 * 참석자/미참 인원은 실제 참석 기준이라 이 Step에서도 자동 채우지 않는다
 * (요청사항) — 아예 fields 배열에 넣지 않는다.
 */
export async function loadWeeklyScheduleIntoDraftAction(
  currentDocument: unknown,
  range?: WeekRange,
): Promise<{ result?: WeeklyScheduleLoadResult; error?: string }> {
  await requireUser();

  // Template 저장과 동일한 이유로 문자열로 받아 파싱한다(실제로 재현한
  // Next.js Server Action 직렬화 문제 우회 — TemplateEditor.tsx 참고).
  const validatedDoc = validateDocumentContent(parseDocumentContentInput(currentDocument));
  if (!validatedDoc) return { error: "현재 회의록 문서 내용이 올바르지 않습니다." };

  const effectiveRange = range ?? getWeeklyMeetingRange();
  // Hotfix Audit(Production KST/UTC 시간대 오차) — "T00:00:00"/"T23:59:59.999"처럼
  // 시각을 붙이면서 "Z"(UTC 표시)를 빠뜨리면 그 순간부터 new Date()가 서버
  // 런타임의 로컬 시간으로 파싱한다(날짜만 있는 문자열과 달리 타임존
  // 독립적이지 않다) — Netlify Production(UTC)에서는 이 두 값 자체가
  // 최대 9시간 밀려, 아래 Task 조회 필터(startDate/dueDate 비교)가 로컬
  // 검증과 다른 Task 집합을 가져올 수 있었다. "Z"를 명시해 Task.startDate/
  // dueDate와 같은 "UTC 자정 기준 달력 날짜" 표현으로 통일한다.
  const rangeStart = new Date(`${effectiveRange.start}T00:00:00Z`);
  const rangeEnd = new Date(`${effectiveRange.end}T23:59:59.999Z`);

  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { scheduleRevisions: { none: {} }, startDate: { lte: rangeEnd }, dueDate: { gte: rangeStart } },
        { scheduleRevisions: { some: {} } },
      ],
    },
    select: {
      id: true,
      title: true,
      startDate: true,
      dueDate: true,
      goalName: true,
      // Step(V1 Fix — 회의록 공통 일정 그룹 분리) — "공통"과 "미배정"을
      // 구분하려면 이 값이 반드시 필요하다(요청사항 1) — assignees가
      // 비어 있다는 사실만으로는 둘을 구분할 수 없다.
      isCommonAssignee: true,
      assignees: { select: { user: { select: { name: true, email: true, createdAt: true } } } },
      projectDetail: { select: { projectName: true } },
      categoryOption: { select: { meetingReportSection: true } },
      scheduleRevisions: { orderBy: { revisionNo: "desc" }, take: 1, select: { startDate: true, dueDate: true } },
    },
  });

  const weeklyTasks: WeeklyTaskInfo[] = tasks
    .map((t) => {
      const latestRevision = t.scheduleRevisions[0] ?? null;
      const effectiveStart = latestRevision?.startDate ?? t.startDate;
      const effectiveDue = latestRevision?.dueDate ?? t.dueDate;
      return {
        id: t.id,
        title: t.title,
        meetingReportSection: t.categoryOption.meetingReportSection,
        projectName: t.projectDetail?.projectName ?? null,
        goalName: t.goalName,
        assigneeNames: t.assignees.map((a) => a.user.name ?? a.user.email),
        isCommonAssignee: t.isCommonAssignee,
        startDate: effectiveStart,
        dueDate: effectiveDue,
      };
    })
    .filter((t) => t.startDate.getTime() <= rangeEnd.getTime() && t.dueDate.getTime() >= rangeStart.getTime());

  // Step(담당자별 그룹핑) — 담당자 정렬은 하드코딩된 이름 순서가 아니라
  // 이미 이 코드베이스가 쓰는 안정적 기준(admin/users 목록의
  // createdAt asc)을 재사용한다(lib/meetingMinutes/build.ts 상단 주석
  // 참고). 같은 이름이 여러 Task에 걸쳐 나와도 Map이라 한 번만 기록된다.
  const assigneeSortKeys = new Map<string, number>();
  for (const t of tasks) {
    for (const a of t.assignees) {
      const name = a.user.name ?? a.user.email;
      if (!assigneeSortKeys.has(name)) assigneeSortKeys.set(name, a.user.createdAt.getTime());
    }
  }

  const sections = buildWeeklySections(weeklyTasks, assigneeSortKeys);
  const { document: sectionsDocument, missingHeadings } = mergeSectionsIntoDocument(validatedDoc, sections);

  // 대상 업무기간(월~금) 다음에 열리는 실제 회의 회차를 찾는다. "그 다음
  // 회의는 업무기간이 끝난 다음 날(토요일) 이후 첫 유효 회차"로 계산해야,
  // 업무기간의 월요일 자신이 우연히 그 반복 규칙과도 맞아떨어질 때 자기
  // 자신을 반환해버리는 것을 피한다.
  const meetingCandidates = await findPartWeeklyMeetingCandidate();

  let meetingDateTime: string | null = null;
  let meetingWeek: string | null = null;
  let meetingNotFoundReason: string | null = null;
  let meetingLocation: string | null = null;
  // Step(참석자 자동입력) — 참석자는 회의 회차의 날짜/시간 계산 성공 여부와
  // 무관하게 항상 그 미팅 Task의 meetingDetail.attendees 그대로다(회의
  // 일시를 못 구해도 참석자 명단 자체는 이미 확정된 값이므로 별개로 채운다).
  let attendeeNames: string[] = [];

  if (meetingCandidates.length === 0) {
    meetingNotFoundReason = "MEETING 업무구분이면서 매주 반복하는 Schedule 일정을 찾지 못했습니다.";
  } else {
    const target = meetingCandidates[0];
    attendeeNames = extractAttendeeNames(target.meetingDetail?.attendees);
    const rule = taskRowToRecurrenceRule(target);
    // Hotfix Audit — date-fns의 addDays(rangeEnd, 1)는 rangeEnd의 시:분:초를
    // 그대로 보존한 채(23:59:59.999) 날짜만 옮긴다. computeFirstOccurrenceOnOrAfter
    // 내부는 startOfDay() 등 "로컬 접근자" 기준으로 계산하는데, 그 입력이
    // 자정에서 먼(23:59:59.999) 값이면 서버 런타임의 로컬 timezone에 따라
    // "같은 순간이 어느 달력 날짜로 해석되는지"가 달라질 수 있다. rangeEnd + 1ms로
    // "다음 날 UTC 자정"을 정확히 만들면(Task.startDate와 같은 달력 날짜
    // 표현), UTC/KST 어느 런타임에서 읽어도 같은 날짜로 해석된다(KST는 UTC보다
    // 항상 앞서 있어 "UTC 자정"은 KST 기준으로도 같은 날짜의 오전 9시일 뿐,
    // 전날로 밀리지 않는다) — 이 두 런타임 조합에 한해 안전하다.
    const dayAfterRangeEnd = new Date(rangeEnd.getTime() + 1);
    const nextOccurrence = computeFirstOccurrenceOnOrAfter(rule, dayAfterRangeEnd);
    if (!nextOccurrence) {
      meetingNotFoundReason = "다음 회의 회차를 계산하지 못했습니다(반복 종료일이 지났을 수 있습니다).";
    } else if (target.meetingDetail?.time && target.meetingDetail.endTime) {
      const startTime = formatTimeOfDay(target.meetingDetail.time);
      const endTime = formatTimeOfDay(target.meetingDetail.endTime);
      meetingDateTime = `${formatDateOnly(nextOccurrence)} ${startTime} ~ ${endTime}`;
      meetingWeek = formatMeetingWeek(nextOccurrence);
      meetingLocation = target.meetingDetail.location ?? null;
    } else {
      meetingNotFoundReason = "기준 미팅에 시작/종료 시간이 설정돼 있지 않습니다.";
    }
  }

  const { document, missingFields } = injectMeetingInfoFields(sectionsDocument, [
    { key: MEETING_FIELD_KEY.MEETING_WEEK, value: meetingWeek },
    { key: MEETING_FIELD_KEY.TARGET_RANGE, value: `${effectiveRange.start} ~ ${effectiveRange.end}` },
    { key: MEETING_FIELD_KEY.MEETING_DATETIME, value: meetingDateTime },
    { key: MEETING_FIELD_KEY.MEETING_LOCATION, value: meetingLocation },
    // Step(참석자 자동입력) — Schedule의 TaskMeetingAttendee 전원을 표시명
    // 기준, 중복 제거, 원래 순서(근사)로 자동입력한다(요청사항). 0명이면
    // value가 빈 문자열이라 injectMeetingInfoFields가 아예 건드리지 않고
    // 지나간다 — 기존 값이 없는 상태(Template 골격 직후)라면 자연히 빈칸
    // 그대로 유지된다(요청사항: "참석자가 0명이면 빈칸 유지").
    { key: MEETING_FIELD_KEY.ATTENDEES, value: attendeeNames.length > 0 ? attendeeNames.join(", ") : null },
    // 미참 인원은 실제 참석 기준이라 USER 작성 영역으로 둔다(요청사항) —
    // 이 목록에 아예 넣지 않아 injectMeetingInfoFields가 손대지 않는다.
  ]);

  return {
    result: {
      range: effectiveRange,
      documentJson: JSON.stringify(document),
      missingHeadings,
      // 이번 주 안에 있어도 자동 반영 대상이 아닌 업무(미팅/휴가/반차 등)는
      // 세지 않는다 — 실제로 회의록에 반영된 업무 수만 보여준다.
      taskCount: weeklyTasks.filter((t) => t.meetingReportSection !== null).length,
      meetingDateTime,
      meetingWeek,
      meetingNotFoundReason,
      missingFields,
    },
  };
}
