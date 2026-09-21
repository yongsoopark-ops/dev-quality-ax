import Link from "next/link";
import { toKstParts } from "@/lib/kst";
import { getHolidayName } from "@/lib/schedule/holidays";
import { addCalendarDays, daysBetween, dayOfWeekLabel, formatCalendarDate, isSameCalendarDate, parseCalendarDateInput, sundayOf, thisWeekSunday } from "@/lib/facility/date";
import { getWeekReservations } from "@/lib/facility/queries";
import {
  EQUIPMENT_EVENT_COLOR,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_TIME_HALF_LABEL,
  FACILITY_LANE_THEME_BY_NAME,
  FACILITY_PART_MEMBER_NAMES,
  FACILITY_TEAM_LANE_THEME,
  FACILITY_PAGE_TITLE_CLASS,
  FACILITY_PAGE_SUBTITLE_CLASS,
  FACILITY_TOOLBAR_CARD_CLASS,
  FACILITY_TABLE_CARD_CLASS,
  FACILITY_NAV_BUTTON_CLASS,
} from "@/lib/facility/constants";
import type { FacilityReservationEvent } from "@/lib/facility/types";
import { FacilityPageShell } from "../FacilityPageShell";

/**
 * 설비 관리 — 일정 캘린더. 순수 Server Component다(상호작용은 주 이동
 * 링크뿐이라 client state가 필요 없다 — searchParams `week`로 주 이동을
 * 표현하고, Next.js가 새 주간 데이터를 다시 렌더링한다).
 */
export default async function FacilityCalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const params = await searchParams;
  const kstNow = toKstParts(new Date());
  const requested = params.week ? parseCalendarDateInput(params.week) : null;
  const weekStart = requested ? sundayOf(requested) : thisWeekSunday(kstNow);
  const weekEnd = addCalendarDays(weekStart, 6);
  const todayCalendar = new Date(Date.UTC(kstNow.year, kstNow.month, kstNow.day));

  const reservations = await getWeekReservations(weekStart, weekEnd);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addCalendarDays(weekStart, i);
    const holiday = getHolidayName(date);
    const isToday = isSameCalendarDate(date, todayCalendar);
    const isOff = date.getUTCDay() === 0 || date.getUTCDay() === 6 || !!holiday;
    const label = `${i === 0 ? `${date.getUTCMonth() + 1}월 ` : ""}${date.getUTCDate()}(${dayOfWeekLabel(date)})${holiday ? ` ${holiday}` : ""}`;
    return { label, isToday, isOff };
  });

  const weekEndLabelMonth = weekEnd.getUTCMonth() === weekStart.getUTCMonth() ? "" : `${weekEnd.getUTCMonth() + 1}월 `;
  const weekLabel = `${weekStart.getUTCMonth() + 1}월 ${weekStart.getUTCDate()}일 – ${weekEndLabelMonth}${weekEnd.getUTCDate()}일`;

  const prevWeekHref = `/facility/calendar?week=${formatCalendarDate(addCalendarDays(weekStart, -7)).replaceAll(".", "-")}`;
  const nextWeekHref = `/facility/calendar?week=${formatCalendarDate(addCalendarDays(weekStart, 7)).replaceAll(".", "-")}`;
  const thisWeekHref = `/facility/calendar?week=${formatCalendarDate(thisWeekSunday(kstNow)).replaceAll(".", "-")}`;

  function eventsFor(name: string): FacilityReservationEvent[] {
    return reservations.filter((r) => r.assigneeName === name);
  }

  /** 실제 파트원(name)도 아니고 개발 1/2팀도 아닌 예약 — "담당자 미지정"
   * 상태로 등록된 예약이다. 원본 디자인엔 이 상태를 위한 레인이 없었지만
   * (담당자 select에 "미지정" 옵션 자체가 없었다), 이번 구현은 seed 단계의
   * 임의 배정을 이식하지 않아 실제로 미지정 상태가 나올 수 있다 — 어느
   * 레인에도 표시되지 않아 "이 주 예약 N건"과 화면이 어긋나는 문제를 실제
   * 테스트로 발견해 이 레인을 추가했다(완료 보고 REVIEW 참고). */
  const unassignedEvents = reservations.filter((r) => !r.isTeamAssigned && r.assigneeName === null);

  function eventStyle(event: FacilityReservationEvent) {
    const start = parseCalendarDateInput(event.start)!;
    const end = parseCalendarDateInput(event.end)!;
    const from = Math.max(0, daysBetween(weekStart, start));
    const to = Math.min(6, daysBetween(weekStart, end));
    const color = EQUIPMENT_EVENT_COLOR[event.equipmentStatus];
    const isPast = end < todayCalendar;
    return {
      gridColumn: `${from + 1} / ${to + 2}`,
      background: color.bg,
      borderLeft: `3px solid ${color.bar}`,
      color: color.ink,
      opacity: isPast ? 0.55 : 1,
      textDecoration: isPast ? "line-through" : "none",
    } as const;
  }

  const lanes = [
    ...FACILITY_PART_MEMBER_NAMES.map((name) => ({ name, theme: FACILITY_LANE_THEME_BY_NAME[name], events: eventsFor(name) })),
    ...(unassignedEvents.length > 0 ? [{ name: "미지정", theme: FACILITY_TEAM_LANE_THEME, events: unassignedEvents }] : []),
    { name: "개발 1팀", theme: FACILITY_TEAM_LANE_THEME, events: [] as FacilityReservationEvent[] },
    { name: "개발 2팀", theme: FACILITY_TEAM_LANE_THEME, events: [] as FacilityReservationEvent[] },
  ];

  return (
    <FacilityPageShell>
      <header className="flex flex-col gap-1.5">
        <h1 className={FACILITY_PAGE_TITLE_CLASS}>설비 사용 일정</h1>
        <p className={FACILITY_PAGE_SUBTITLE_CLASS}>예약 등록 페이지의 내역이 누적 저장되어 주간 단위로 표시됩니다.</p>
      </header>

      <div className={FACILITY_TOOLBAR_CARD_CLASS}>
        <Link href={prevWeekHref} className={FACILITY_NAV_BUTTON_CLASS}>‹</Link>
        <div className="min-w-[160px] text-lg font-medium text-navy-950">{weekLabel}</div>
        <Link href={nextWeekHref} className={FACILITY_NAV_BUTTON_CLASS}>›</Link>
        <Link href={thisWeekHref} className="rounded px-2.5 py-1.5 text-sm text-navy-950/70 hover:bg-navy-50">이번 주</Link>
        <span className="ml-auto text-[13px] text-neutral-500">이 주 예약 {reservations.length}건</span>
      </div>

      <div className={FACILITY_TABLE_CARD_CLASS}>
        <div className="grid border-b border-neutral-200" style={{ gridTemplateColumns: "132px repeat(7, minmax(0, 1fr))" }}>
          <div />
          {days.map((d, i) => (
            <div key={i} className="border-l border-neutral-200 px-2 py-3 text-center text-sm font-medium">
              <span className={d.isToday ? "border-b-2 border-blue-600 pb-0.5 text-blue-600" : d.isOff ? "text-red-600" : "text-neutral-600"}>{d.label}</span>
            </div>
          ))}
        </div>
        {lanes.map((lane) => (
          <div key={lane.name} className="grid min-h-[76px] border-b border-neutral-200 last:border-0" style={{ gridTemplateColumns: "132px minmax(0, 1fr)", background: lane.theme.rowBg }}>
            <div className="flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium text-neutral-600" style={{ borderLeft: `4px solid ${lane.theme.bar}` }}>
              <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold" style={{ background: lane.theme.chip, color: lane.theme.ink }}>{lane.name.slice(-2)}</span>
              <span>{lane.name}</span>
            </div>
            <div className="grid items-center gap-1.5 px-2 py-2.5" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridAutoRows: "30px" }}>
              {lane.events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-[3px] px-2 text-[13px] font-medium"
                  style={eventStyle(e)}
                  title={`${e.equipmentManagementNumber} ${e.start}~${e.end} · ${EQUIPMENT_STATUS_LABEL[e.equipmentStatus]}`}
                >
                  {e.equipmentName} | {EQUIPMENT_TIME_HALF_LABEL[e.half]}{e.noteLabel ? ` · ${e.noteLabel}` : ""}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="m-0 text-[13px] text-neutral-400">일정 막대의 색은 해당 설비의 현재 상태(예약 완료 · 사용중 · 수리중 · 예약 가능)를 따르며, 시간대는 오전 08:00–11:20 · 오후 12:20–17:00으로 구분됩니다.</p>
    </FacilityPageShell>
  );
}
