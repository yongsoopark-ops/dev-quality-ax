import { prisma } from "@/lib/prisma";
import { formatCalendarDate } from "@/lib/facility/date";
import { metricKindOf, EQUIPMENT_GRADE_SORT_ORDER, EQUIPMENT_METRIC_LABEL, EQUIPMENT_METRIC_UNIT, FACILITY_PART_MEMBER_NAMES } from "@/lib/facility/constants";
import type { EquipmentRow, FacilityAssigneeOption, FacilityReservationEvent, FacilityStatRow } from "@/lib/facility/types";

/**
 * 설비 관리 — 순수 조회 헬퍼. Server Component(page.tsx)가 직접 호출한다
 * (Schedule의 page.tsx가 prisma를 직접 호출하는 것과 동일한 패턴 — "use
 * server" Action 파일에는 mutation만 둔다).
 */

/** README "사용자" 정의: 파트원 4명(김현나·이지민·박용수·정효준) + 개발
 * 1팀/2팀. ACTIVE 사용자 전체가 아니라 이 4명만 대상이다 — 이름으로 조회한다
 * (이 4명은 이미 Schedule/회의록 기능 전반에서 실명으로 하드코딩되어 쓰이는
 * 이 회사 파트의 고정 구성원이다). 순서는 디자인 레퍼런스의 USERS 배열
 * 순서와 동일하게 유지한다. */
export async function getFacilityAssigneeOptions(): Promise<FacilityAssigneeOption[]> {
  const users = await prisma.user.findMany({
    where: { name: { in: [...FACILITY_PART_MEMBER_NAMES] } },
    select: { id: true, name: true },
  });
  const byName = new Map(users.map((u) => [u.name, u.id]));
  const userOptions: FacilityAssigneeOption[] = FACILITY_PART_MEMBER_NAMES.filter((name) => byName.has(name)).map((name) => ({
    kind: "USER",
    userId: byName.get(name)!,
    name,
  }));
  return [
    ...userOptions,
    { kind: "TEAM", team: "TEAM_1", name: "개발 1팀" },
    { kind: "TEAM", team: "TEAM_2", name: "개발 2팀" },
  ];
}

function toDateLabel(d: Date | null): string | null {
  return d ? formatCalendarDate(d) : null;
}

/** 예약 등록 표 1행 — 설비 마스터 + 현재 스냅샷 + (수정 다이얼로그 프리필용)
 * 최신 예약의 입력값 + (등급 '하') 최신 수동 시료 등록값.
 *
 * 정렬: 관리대상 등급 "상 → 중 → 하"(1차) → 같은 등급 내 관리번호 오름차순
 * (2차). Prisma의 orderBy는 enum에 임의 순서를 줄 수 없으므로(DB 컬럼
 * 순서는 정의 순서일 뿐 이 요구사항과 무관), DB에서는 관리번호 오름차순만
 * 받아온 뒤(2차 기준을 이미 만족하는 상태) EQUIPMENT_GRADE_SORT_ORDER로
 * 안정 정렬(stable sort)한다 — Array.prototype.sort는 표준상 항상
 * 안정적이라, 같은 등급 안에서는 원래의 관리번호 오름차순이 그대로
 * 보존된다(그래서 2차 정렬을 별도로 구현할 필요가 없다). */
export async function getEquipmentRows(): Promise<EquipmentRow[]> {
  const rows = await prisma.equipment.findMany({
    orderBy: { id: "asc" },
    include: {
      assignedUser: { select: { name: true } },
      reservations: { orderBy: { createdAt: "desc" }, take: 1 },
      usageLogs: { where: { reservationId: null }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  rows.sort((a, b) => EQUIPMENT_GRADE_SORT_ORDER[a.grade] - EQUIPMENT_GRADE_SORT_ORDER[b.grade]);

  return rows.map((r) => {
    const latestReservation = r.reservations[0] ?? null;
    const latestManualLog = r.usageLogs[0] ?? null;
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      location: r.location,
      grade: r.grade,
      status: r.status,
      assignedUserId: r.assignedUserId,
      assignedUserName: r.assignedUser?.name ?? null,
      assignedTeamLabel: r.assignedTeamLabel,
      currentStart: toDateLabel(r.currentStart),
      currentEnd: toDateLabel(r.currentEnd),
      currentHalf: r.currentHalf,
      currentFaultNote: r.currentFaultNote,
      lastReservationDetail: latestReservation
        ? { purpose: latestReservation.purpose, cycles: latestReservation.cycles, hours: latestReservation.hours, sampleCount: latestReservation.sampleCount }
        : null,
      manualSampleCount: latestManualLog?.amount ?? null,
    };
  });
}

/** 캘린더 주간 뷰 — [weekStart, weekEnd] 범위와 겹치는 예약 전부. 담당자가
 * 팀 placeholder인 예약은 isTeamAssigned=true로 내려보내고, 화면(Client)이
 * 그 레인에는 막대를 그리지 않는다(README: "개발 1팀·2팀 레인은 항상 회색
 * 빈 행"). assigneeName도 null이고 isTeamAssigned도 false면 "담당자
 * 미지정" 상태 — 이 둘을 하나의 null 값으로 합치면 화면에서 구분할 수
 * 없어(버그로 실제 발견, 완료 보고 참고) 별도 필드로 분리했다. */
export async function getWeekReservations(weekStart: Date, weekEnd: Date): Promise<FacilityReservationEvent[]> {
  const reservations = await prisma.equipmentReservation.findMany({
    where: { startDate: { lte: weekEnd }, endDate: { gte: weekStart } },
    include: { equipment: { select: { name: true, status: true } }, assignedUser: { select: { name: true } } },
    orderBy: { startDate: "asc" },
  });

  return reservations.map((r) => {
    const noteParts: string[] = [];
    if (r.purpose) noteParts.push(r.purpose === "ONE_OFF" ? "일반 사용 (1회성)" : "반복 싸이클 사용");
    if (r.cycles) noteParts.push(`${r.cycles.toLocaleString("ko-KR")}회`);
    if (r.hours) noteParts.push(`${r.hours.toLocaleString("ko-KR")}시간`);
    if (r.sampleCount) noteParts.push(`시료 ${r.sampleCount.toLocaleString("ko-KR")}건`);
    return {
      id: r.id,
      equipmentId: r.equipmentId,
      equipmentName: r.equipment.name,
      equipmentStatus: r.equipment.status,
      start: formatCalendarDate(r.startDate),
      end: formatCalendarDate(r.endDate),
      half: r.half,
      noteLabel: noteParts.join(" · "),
      assigneeName: r.assignedUser?.name ?? null,
      isTeamAssigned: !!r.assignedTeamLabel,
    };
  });
}

interface PeriodWindow {
  year: number;
  month: number; // 1-based
}

function monthsBack(base: PeriodWindow, count: number): PeriodWindow {
  let { year, month } = base;
  month -= count;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return { year, month };
}

/** amount 합계 — [from, to] 양끝 월 포함(달력 날짜, UTC 자정 기준 월 경계). */
async function sumAmount(equipmentId: string, metricKind: ReturnType<typeof metricKindOf>, from: PeriodWindow, to: PeriodWindow): Promise<number> {
  const start = new Date(Date.UTC(from.year, from.month - 1, 1));
  const end = new Date(Date.UTC(to.year, to.month, 1)); // 다음 달 1일 — exclusive upper bound
  const result = await prisma.equipmentUsageLog.aggregate({
    where: { equipmentId, metricKind, recordedAt: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export type FacilityStatsPeriod = "월간" | "분기별" | "연간";

/** 사용 통계 표 — 모든 설비, "전월 대비/전월 누적/전 분기 누적/연누적" 4개
 * 열은 선택 기간(period)과 무관하게 항상 같은 뜻이다(README 표 구조
 * 그대로). 다만 맨 앞 "{이번달|분기|연} 누적" 열(cur)은 헤더 라벨이 실제로
 * period를 따라 바뀌는 만큼(getChartBars 헤더 colThis 참고) 그 값도 같은
 * 기간 범위로 계산한다 — REVIEW: 디자인 레퍼런스 원본은 헤더 텍스트만
 * period로 바뀌고 실제 cur 값은 항상 "이번 달"로 고정돼 있어(더미 해시
 * baseFor를 그대로 재사용) 헤더와 값이 어긋나는 표시 버그가 있었다. 실제
 * 집계로 바꾸면서 이 값도 헤더가 말하는 기간(분기/연) 범위로 정확히
 * 계산되도록 고쳤다. */
export async function getStatRows(period: FacilityStatsPeriod, year: number, month: number): Promise<FacilityStatRow[]> {
  const equipment = await prisma.equipment.findMany({ orderBy: { id: "asc" } });
  const curMonth: PeriodWindow = { year, month };
  const prev = monthsBack(curMonth, 1);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const curQuarterStart: PeriodWindow = { year, month: quarterStartMonth };
  const prevQuarterEnd = monthsBack(curQuarterStart, 1);
  const prevQuarterStart = monthsBack(prevQuarterEnd, 2);
  const yearStart: PeriodWindow = { year, month: 1 };
  const curWindow: [PeriodWindow, PeriodWindow] = period === "연간" ? [yearStart, curMonth] : period === "분기별" ? [curQuarterStart, curMonth] : [curMonth, curMonth];

  return Promise.all(
    equipment.map(async (eq) => {
      const metricKind = metricKindOf(eq.kind);
      const [curSum, prevSum, quarterSum, yearSum] = await Promise.all([
        sumAmount(eq.id, metricKind, curWindow[0], curWindow[1]),
        sumAmount(eq.id, metricKind, prev, prev),
        sumAmount(eq.id, metricKind, prevQuarterStart, prevQuarterEnd),
        sumAmount(eq.id, metricKind, yearStart, curMonth),
      ]);
      return {
        id: eq.id,
        name: eq.name,
        grade: eq.grade,
        metricLabel: EQUIPMENT_METRIC_LABEL[metricKind],
        unit: EQUIPMENT_METRIC_UNIT[metricKind],
        cur: curSum,
        prevMonth: prevSum,
        quarterCumulative: quarterSum,
        yearCumulative: yearSum,
      };
    }),
  );
}

/** 사용 통계 차트 막대 — 선택 설비 1대, 선택 기간 종류에 따라 x축이
 * 바뀐다(월간 12개월 / 분기별 4분기 / 연간 최근 5년). 디자인 레퍼런스의
 * 더미 해시 시드값(baseFor)은 이식하지 않는다 — 전부 실제 EquipmentUsageLog
 * 합계로 대체한다(README "실제 구현에서는 예약/사용 기록 테이블 집계로
 * 대체"). */
export async function getChartBars(
  equipmentId: string,
  metricKind: ReturnType<typeof metricKindOf>,
  period: FacilityStatsPeriod,
  year: number,
  month: number,
): Promise<{ label: string; value: number; isCurrent: boolean }[]> {
  if (period === "월간") {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const values = await Promise.all(months.map((m) => (m <= month ? sumAmount(equipmentId, metricKind, { year, month: m }, { year, month: m }) : Promise.resolve(0))));
    return months.map((m, i) => ({ label: `${m}월`, value: values[i], isCurrent: m === month }));
  }
  if (period === "분기별") {
    const quarters = [1, 2, 3, 4];
    const currentQuarter = Math.ceil(month / 3);
    const values = await Promise.all(
      quarters.map((q) => {
        const qStartMonth = q * 3 - 2;
        const qEndMonth = q * 3;
        if (qStartMonth > month) return Promise.resolve(0);
        const clampedEnd = Math.min(qEndMonth, month);
        return sumAmount(equipmentId, metricKind, { year, month: qStartMonth }, { year, month: clampedEnd });
      }),
    );
    return quarters.map((q, i) => ({ label: `${q}Q`, value: values[i], isCurrent: q === currentQuarter }));
  }
  const years = Array.from({ length: 5 }, (_, i) => year - 4 + i);
  const values = await Promise.all(
    years.map((y) => sumAmount(equipmentId, metricKind, { year: y, month: 1 }, { year: y, month: y === year ? month : 12 })),
  );
  return years.map((y, i) => ({ label: `${y}`, value: values[i], isCurrent: y === year }));
}
