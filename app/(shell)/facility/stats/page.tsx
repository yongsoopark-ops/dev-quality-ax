import Link from "next/link";
import { toKstParts } from "@/lib/kst";
import { prisma } from "@/lib/prisma";
import { getChartBars, getStatRows, type FacilityStatsPeriod } from "@/lib/facility/queries";
import {
  EQUIPMENT_GRADE_LABEL,
  EQUIPMENT_GRADE_TAG,
  EQUIPMENT_METRIC_LABEL,
  EQUIPMENT_METRIC_UNIT,
  EQUIPMENT_STATS_PERIODS,
  metricKindOf,
  FACILITY_PAGE_TITLE_CLASS,
  FACILITY_PAGE_SUBTITLE_CLASS,
  FACILITY_TOOLBAR_CARD_CLASS,
  FACILITY_TABLE_CARD_CLASS,
  FACILITY_TABLE_HEAD_ROW_CLASS,
  FACILITY_TABLE_CELL_CLASS,
  FACILITY_BADGE_CLASS,
  FACILITY_NAV_BUTTON_CLASS,
  facilitySegmentButtonClass,
} from "@/lib/facility/constants";
import { FacilityPageShell } from "../FacilityPageShell";
import { StatsCollapsiblePanel } from "./StatsCollapsiblePanel";

/**
 * 설비 관리 — 사용 통계. 캘린더 페이지와 같은 이유로 순수 Server
 * Component다 — 기간 종류/이전·다음/선택 설비 전부 searchParams로
 * 표현하고 Link 이동만으로 동작한다(클라이언트 상태 없음).
 */
export default async function FacilityStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; year?: string; month?: string; equip?: string }>;
}) {
  const params = await searchParams;
  const kstNow = toKstParts(new Date());
  const period: FacilityStatsPeriod = EQUIPMENT_STATS_PERIODS.includes(params.period as FacilityStatsPeriod) ? (params.period as FacilityStatsPeriod) : "월간";
  const year = Number(params.year) || kstNow.year;
  const month = Number(params.month) || kstNow.month + 1;

  const equipmentList = await prisma.equipment.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, kind: true } });
  const pickedId = params.equip && equipmentList.some((e) => e.id === params.equip) ? params.equip! : (equipmentList[0]?.id ?? "");
  const picked = equipmentList.find((e) => e.id === pickedId) ?? equipmentList[0];

  const [statRows, bars] = await Promise.all([
    getStatRows(period, year, month),
    picked ? getChartBars(picked.id, metricKindOf(picked.kind), period, year, month) : Promise.resolve([]),
  ]);

  function shiftedPeriod(dir: number): { year: number; month: number } {
    if (period === "연간") return { year: year + dir, month };
    if (period === "분기별") {
      let m = month + dir * 3;
      let y = year;
      while (m < 1) { m += 12; y -= 1; }
      while (m > 12) { m -= 12; y += 1; }
      return { year: y, month: m };
    }
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    return { year: y, month: m };
  }

  function hrefFor(next: { period?: FacilityStatsPeriod; year?: number; month?: number; equip?: string }) {
    const q = new URLSearchParams({
      period: next.period ?? period,
      year: String(next.year ?? year),
      month: String(next.month ?? month),
      equip: next.equip ?? pickedId,
    });
    return `/facility/stats?${q.toString()}`;
  }

  const prevStep = shiftedPeriod(-1);
  const nextStep = shiftedPeriod(1);
  const periodLabel = period === "연간" ? `${year}년` : period === "분기별" ? `${year}년 ${Math.ceil(month / 3)}분기` : `${year}년 ${month}월`;
  const colThisLabel = period === "연간" ? "연 누적" : period === "분기별" ? "분기 누적" : "이번달 누적";
  const chartUnit = picked ? EQUIPMENT_METRIC_UNIT[metricKindOf(picked.kind)] : "";
  const chartTitle = picked ? `${picked.name} · ${EQUIPMENT_METRIC_LABEL[metricKindOf(picked.kind)]} 추이` : "";
  const maxBar = Math.max(1, ...bars.map((b) => b.value));

  return (
    <FacilityPageShell>
      <header className="flex flex-col gap-1.5">
        <h1 className={FACILITY_PAGE_TITLE_CLASS}>설비 사용 통계</h1>
        <p className={FACILITY_PAGE_SUBTITLE_CLASS}>매년 1월 1일을 기준으로 집계합니다. 일반은 사용 횟수, 반복은 사이클 수, 환경은 사용 시간으로 관리합니다.</p>
      </header>

      <div className={FACILITY_TOOLBAR_CARD_CLASS}>
        <div className="flex gap-1 rounded-md border border-navy-100 p-0.5">
          {EQUIPMENT_STATS_PERIODS.map((p) => (
            <Link key={p} href={hrefFor({ period: p })} className={facilitySegmentButtonClass(p === period)}>
              {p}
            </Link>
          ))}
        </div>
        <Link href={hrefFor(prevStep)} className={FACILITY_NAV_BUTTON_CLASS}>‹</Link>
        <div className="min-w-[140px] text-lg font-medium text-navy-950">{periodLabel}</div>
        <Link href={hrefFor(nextStep)} className={FACILITY_NAV_BUTTON_CLASS}>›</Link>
        <span className="ml-auto text-[13px] text-neutral-500">선택 설비 {pickedId}</span>
      </div>

      <StatsCollapsiblePanel>
        <div className="rounded-xl border border-navy-100 bg-white p-5">
          <div className="mb-5 flex items-baseline justify-between">
            <div className="text-base font-semibold text-navy-950">{chartTitle}</div>
            <div className="text-[13px] text-neutral-500">단위 {chartUnit}</div>
          </div>
          <div className="flex h-[220px] items-end gap-2">
            {bars.map((b, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-[13px] tabular-nums text-neutral-500">{b.value ? b.value.toLocaleString("ko-KR") : "—"}</span>
                <div className="w-full rounded-t" style={{ height: `${Math.max(2, Math.round((b.value / maxBar) * 160))}px`, background: b.isCurrent ? "#2563eb" : "#dbeafe" }} />
                <span className="text-[13px] font-medium" style={{ color: b.isCurrent ? "#2563eb" : "#64748b" }}>{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={FACILITY_TABLE_CARD_CLASS}>
          <div className="overflow-x-auto">
            <table className="min-w-[940px] w-full border-collapse text-center text-sm">
              <thead className={FACILITY_TABLE_HEAD_ROW_CLASS}>
                <tr>
                  <th className={`w-[128px] ${FACILITY_TABLE_CELL_CLASS}`}>장비 관리 번호</th>
                  <th className={`w-[168px] ${FACILITY_TABLE_CELL_CLASS}`}>장비명</th>
                  <th className={FACILITY_TABLE_CELL_CLASS}>등급</th>
                  <th className={FACILITY_TABLE_CELL_CLASS}>지표</th>
                  <th className={FACILITY_TABLE_CELL_CLASS}>{colThisLabel}</th>
                  <th className={FACILITY_TABLE_CELL_CLASS}>전월 대비</th>
                  <th className={FACILITY_TABLE_CELL_CLASS}>전월 누적</th>
                  <th className={FACILITY_TABLE_CELL_CLASS}>전 분기 누적</th>
                  <th className={`${FACILITY_TABLE_CELL_CLASS} pr-4`}>연누적</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map((s) => {
                  const pct = s.prevMonth ? Math.round(((s.cur - s.prevMonth) / s.prevMonth) * 100) : 0;
                  const gradeTag = EQUIPMENT_GRADE_TAG[s.grade];
                  return (
                    <tr key={s.id} className="border-b border-neutral-100 last:border-0">
                      <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} font-mono text-[13px] tabular-nums text-neutral-500`}>{s.id}</td>
                      <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS}`}>
                        <Link href={hrefFor({ equip: s.id })} className={s.id === pickedId ? "font-medium text-blue-600" : "text-navy-950"}>
                          {s.name}
                        </Link>
                      </td>
                      <td className={FACILITY_TABLE_CELL_CLASS}>
                        <span className={FACILITY_BADGE_CLASS} style={{ background: gradeTag.bg, color: gradeTag.text }}>{EQUIPMENT_GRADE_LABEL[s.grade]}</span>
                      </td>
                      <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} text-[13px] text-neutral-500`}>{s.metricLabel}</td>
                      <td className={`${FACILITY_TABLE_CELL_CLASS} tabular-nums`}>{s.cur.toLocaleString("ko-KR")}{s.unit}</td>
                      <td className={`${FACILITY_TABLE_CELL_CLASS} tabular-nums`} style={{ color: pct >= 0 ? "#1d4ed8" : "#dc2626" }}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%</td>
                      <td className={`${FACILITY_TABLE_CELL_CLASS} tabular-nums text-neutral-600`}>{s.prevMonth.toLocaleString("ko-KR")}{s.unit}</td>
                      <td className={`${FACILITY_TABLE_CELL_CLASS} tabular-nums text-neutral-600`}>{s.quarterCumulative.toLocaleString("ko-KR")}{s.unit}</td>
                      <td className={`${FACILITY_TABLE_CELL_CLASS} pr-4 tabular-nums text-neutral-600`}>{s.yearCumulative.toLocaleString("ko-KR")}{s.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </StatsCollapsiblePanel>
    </FacilityPageShell>
  );
}
