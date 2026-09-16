"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EquipmentTeamLabel, EquipmentTimeHalf, EquipmentUsagePurpose } from "@/app/generated/prisma/enums";
import { FacilityPageShell } from "../FacilityPageShell";
import type { EquipmentRow, FacilityAssigneeOption } from "@/lib/facility/types";
import {
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_LOCATION_LABEL,
  EQUIPMENT_GRADE_LABEL,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_GRADE_TAG,
  EQUIPMENT_STATUS_TAG,
  EQUIPMENT_ACTION_TAG,
  EQUIPMENT_KIND_FILTERS,
  EQUIPMENT_TIME_HALF_LABEL,
  EQUIPMENT_TIME_HALF_HINT,
  EQUIPMENT_USAGE_PURPOSE_LABEL,
  isReservationEligibleGrade,
  FACILITY_PAGE_TITLE_CLASS,
  FACILITY_PAGE_SUBTITLE_CLASS,
  FACILITY_TOOLBAR_CARD_CLASS,
  FACILITY_TABLE_CARD_CLASS,
  FACILITY_TABLE_HEAD_ROW_CLASS,
  FACILITY_TABLE_CELL_CLASS,
  FACILITY_BADGE_CLASS,
  facilitySegmentButtonClass,
  type EquipmentActionLabel,
} from "@/lib/facility/constants";
import { parseCalendarDateInput, formatCalendarDate } from "@/lib/facility/date";
import {
  updateEquipmentAssignmentAction,
  startUsingEquipmentAction,
  endUsingEquipmentAction,
  confirmReservationAction,
  cancelReservationAction,
  reportBreakdownAction,
  completeRepairAction,
  confirmSampleUsageAction,
  cancelSampleUsageAction,
} from "../actions";

/**
 * 설비 관리 — 예약 등록 화면. 디자인 레퍼런스(설비 관리.dc.html)의 예약
 * 등록 페이지 + 다이얼로그 A/B/C/D를 그대로 재현한다. 값은 Server Action을
 * 통해 실제 DB에 저장되고, 성공하면 revalidatePath로 이 페이지의
 * initialRows가 최신화된다(별도 optimistic mirror state를 두지 않는다 —
 * Schedule 등 기존 기능과 동일한 관례).
 */

type ReserveDialog = {
  type: "reserve";
  equipmentId: string;
  editMode: boolean;
  start: string;
  end: string;
  half: EquipmentTimeHalf;
  purpose: EquipmentUsagePurpose;
  cycles: string;
  hours: string;
  sampleCount: string;
  calYear: number;
  calMonth: number;
  anchor: string | null;
};
type UseDialog = { type: "use"; equipmentId: string; editMode: boolean; sampleCount: string };
type BreakDialog = { type: "break"; equipmentId: string; reason: string };
type FixDialog = { type: "fix"; equipmentId: string };
type DialogState = ReserveDialog | UseDialog | BreakDialog | FixDialog | null;

function actionLabelFor(row: EquipmentRow): EquipmentActionLabel {
  if (row.status === "UNDER_REPAIR") return "예약 불가";
  if (row.grade === "LOW") return "사용";
  if (row.status === "AVAILABLE") return "예약";
  if (row.status === "RESERVED") return "시작";
  return "종료";
}

function canEditRow(row: EquipmentRow): boolean {
  if (row.grade === "LOW") return (row.manualSampleCount ?? 0) > 0;
  return row.status === "RESERVED" || row.status === "IN_USE";
}

function assigneeValue(row: EquipmentRow): string {
  if (row.assignedUserId) return `USER:${row.assignedUserId}`;
  if (row.assignedTeamLabel) return `TEAM:${row.assignedTeamLabel}`;
  return "";
}

export function ReservationClient({ initialRows, assigneeOptions }: { initialRows: EquipmentRow[]; assigneeOptions: FacilityAssigneeOption[] }) {
  const rows = initialRows;
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<(typeof EQUIPMENT_KIND_FILTERS)[number]>("전체");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState(false);

  function say(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (kindFilter === "전체" || EQUIPMENT_KIND_LABEL[r.kind] === kindFilter) && (!q || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)));
  }, [rows, query, kindFilter]);

  const availCount = rows.filter((r) => r.status === "AVAILABLE").length;
  const fixCount = rows.filter((r) => r.status === "UNDER_REPAIR").length;

  async function runAction(fn: () => Promise<{ ok?: true; error?: string }>, successMessage?: string) {
    setPending(true);
    try {
      const result = await fn();
      if (result.error) say(result.error);
      else if (successMessage) say(successMessage);
    } finally {
      setPending(false);
    }
  }

  function handleAssigneeChange(row: EquipmentRow, value: string) {
    if (value.startsWith("USER:")) {
      void runAction(() => updateEquipmentAssignmentAction(row.id, { kind: "USER", userId: value.slice(5) }));
    } else if (value.startsWith("TEAM:")) {
      void runAction(() => updateEquipmentAssignmentAction(row.id, { kind: "TEAM", team: value.slice(5) as EquipmentTeamLabel }));
    } else {
      // value === "" — "미지정" 선택. assignedUserId/assignedTeamLabel을 둘 다 null로 되돌린다.
      void runAction(() => updateEquipmentAssignmentAction(row.id, { kind: "NONE" }));
    }
  }

  function openReserveDialog(row: EquipmentRow, editMode: boolean) {
    const detail = row.lastReservationDetail;
    const base = parseCalendarDateInput(row.currentStart ?? "") ?? new Date();
    setDialog({
      type: "reserve",
      equipmentId: row.id,
      editMode,
      start: row.currentStart ?? "",
      end: row.currentEnd ?? "",
      half: row.currentHalf ?? "AM",
      purpose: (editMode ? detail?.purpose : null) ?? "ONE_OFF",
      cycles: editMode && detail?.cycles ? String(detail.cycles) : "",
      hours: editMode && detail?.hours ? String(detail.hours) : "",
      sampleCount: editMode && detail?.sampleCount ? String(detail.sampleCount) : "",
      calYear: base.getUTCFullYear(),
      calMonth: base.getUTCMonth() + 1,
      anchor: null,
    });
  }

  function handleActionClick(row: EquipmentRow) {
    const label = actionLabelFor(row);
    if (label === "예약 불가") { setDialog({ type: "fix", equipmentId: row.id }); return; }
    if (label === "사용") { setDialog({ type: "use", equipmentId: row.id, editMode: false, sampleCount: "" }); return; }
    if (label === "예약") { openReserveDialog(row, false); return; }
    if (label === "시작") { void runAction(() => startUsingEquipmentAction(row.id), `${row.name} 사용을 시작했습니다.`); return; }
    void runAction(() => endUsingEquipmentAction(row.id), `${row.name} 사용을 종료하고 예약 가능으로 전환했습니다.`);
  }

  function handleStatusBadgeClick(row: EquipmentRow) {
    if (row.status === "UNDER_REPAIR") setDialog({ type: "fix", equipmentId: row.id });
    else setDialog({ type: "break", equipmentId: row.id, reason: "" });
  }

  function handleEditClick(row: EquipmentRow) {
    if (row.grade === "LOW") setDialog({ type: "use", equipmentId: row.id, editMode: true, sampleCount: String(row.manualSampleCount ?? "") });
    else openReserveDialog(row, true);
  }

  async function handleConfirmReserve(equip: EquipmentRow) {
    if (dialog?.type !== "reserve") return;
    if (!dialog.start || !dialog.end) { say("시작일과 마감일을 입력하세요."); return; }
    const d = dialog;
    await runAction(async () => {
      const result = await confirmReservationAction({
        equipmentId: d.equipmentId,
        start: d.start,
        end: d.end,
        half: d.half,
        purpose: equip.kind === "GENERAL_REPEAT" ? d.purpose : undefined,
        cycles: d.cycles,
        hours: d.hours,
        sampleCount: d.sampleCount,
        editMode: d.editMode,
      });
      if (!result.error) {
        setDialog(null);
        say(d.editMode ? `${equip.name} 예약 내용을 수정했습니다.` : `${equip.name} 예약이 등록되어 일정 캘린더에 반영되었습니다.`);
      }
      return result;
    });
  }

  async function handleCancelReserve(equip: EquipmentRow) {
    if (dialog?.type !== "reserve") return;
    await runAction(async () => {
      const result = await cancelReservationAction(dialog.equipmentId);
      if (!result.error) {
        setDialog(null);
        say(`${equip.name} 예약을 취소했습니다. 집계된 수량도 함께 차감되었습니다.`);
      }
      return result;
    });
  }

  async function handleConfirmUse(equip: EquipmentRow) {
    if (dialog?.type !== "use") return;
    const d = dialog;
    await runAction(async () => {
      const result = await confirmSampleUsageAction(d.equipmentId, d.sampleCount, d.editMode);
      if (!result.error) {
        setDialog(null);
        say(d.editMode ? `${equip.name} 시료 수량을 수정했습니다.` : `${equip.name} 시료를 사용 통계에 반영했습니다.`);
      }
      return result;
    });
  }

  async function handleCancelUse(equip: EquipmentRow) {
    if (dialog?.type !== "use") return;
    await runAction(async () => {
      const result = await cancelSampleUsageAction(dialog.equipmentId);
      if (!result.error) {
        setDialog(null);
        say(`${equip.name} 시료 집계를 취소했습니다.`);
      }
      return result;
    });
  }

  async function handleConfirmBreak(equip: EquipmentRow) {
    if (dialog?.type !== "break") return;
    const d = dialog;
    await runAction(async () => {
      const result = await reportBreakdownAction(d.equipmentId, d.reason);
      if (!result.error) {
        setDialog(null);
        say(`${equip.name}을(를) 수리중으로 전환했습니다. 진행 중이던 예약은 취소되었습니다.`);
      }
      return result;
    });
  }

  async function handleConfirmFixed(equip: EquipmentRow) {
    if (dialog?.type !== "fix") return;
    await runAction(async () => {
      const result = await completeRepairAction(dialog.equipmentId);
      if (!result.error) {
        setDialog(null);
        say("수리 완료 처리되어 예약 가능으로 전환되었습니다.");
      }
      return result;
    });
  }

  const dialogEquip = dialog ? rows.find((r) => r.id === dialog.equipmentId) ?? null : null;

  return (
    <FacilityPageShell>
      <header className="flex flex-col gap-1.5">
        <h1 className={FACILITY_PAGE_TITLE_CLASS}>예약 등록</h1>
        <p className={FACILITY_PAGE_SUBTITLE_CLASS}>설비 상태를 확인하고 사용 일정을 등록합니다. 개발팀이 사용하는 설비는 파트원이 일정을 문의한 뒤 대리 등록합니다.</p>
      </header>

      <div className={FACILITY_TOOLBAR_CARD_CLASS}>
        <input
          className="w-56 rounded-md border border-navy-100 px-3 py-2 text-sm"
          placeholder="설비명 · 관리번호 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-1 rounded-md border border-navy-100 p-0.5">
          {EQUIPMENT_KIND_FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setKindFilter(f)} className={facilitySegmentButtonClass(kindFilter === f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-3 text-[13px] text-neutral-500">
          <span>표시 {visibleRows.length}대</span>
          <span>예약 가능 {availCount}대</span>
          <span>수리중 {fixCount}대</span>
        </div>
      </div>

      <div className={FACILITY_TABLE_CARD_CLASS}>
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full border-collapse text-center text-sm">
            <thead className={FACILITY_TABLE_HEAD_ROW_CLASS}>
              <tr>
                <th rowSpan={2} className={FACILITY_TABLE_CELL_CLASS}>장비 관리 번호</th>
                <th rowSpan={2} className={FACILITY_TABLE_CELL_CLASS}>구분</th>
                <th rowSpan={2} className={FACILITY_TABLE_CELL_CLASS}>설비명</th>
                <th rowSpan={2} className={FACILITY_TABLE_CELL_CLASS}>위치</th>
                <th rowSpan={2} className={FACILITY_TABLE_CELL_CLASS}>관리 대상</th>
                <th rowSpan={2} className={FACILITY_TABLE_CELL_CLASS}>사용자</th>
                <th rowSpan={2} className={FACILITY_TABLE_CELL_CLASS}>상태</th>
                <th colSpan={3} className="px-2 py-1.5">일정</th>
                <th rowSpan={2} className={`w-[112px] ${FACILITY_TABLE_CELL_CLASS}`}>액션</th>
                <th rowSpan={2} className={`w-[80px] ${FACILITY_TABLE_CELL_CLASS} pr-4`}>수정</th>
              </tr>
              <tr>
                <th className="px-3 pb-3 text-[13px] font-medium">시작</th>
                <th className="px-3 pb-3 text-[13px] font-medium">종료</th>
                <th className="px-3 pb-3 text-[13px] font-medium">시간대</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const actionLabel = actionLabelFor(r);
                const actionTag = EQUIPMENT_ACTION_TAG[actionLabel];
                const statusTag = EQUIPMENT_STATUS_TAG[r.status];
                const gradeTag = EQUIPMENT_GRADE_TAG[r.grade];
                return (
                  <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                    <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} font-mono text-[13px] tabular-nums text-neutral-600`}>{r.id}</td>
                    <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} text-[13px] text-neutral-500`}>{EQUIPMENT_KIND_LABEL[r.kind]}</td>
                    <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} text-[14px] font-medium text-navy-950`}>{r.name}</td>
                    <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} text-[13px] text-neutral-500`}>{EQUIPMENT_LOCATION_LABEL[r.location]}</td>
                    <td className={FACILITY_TABLE_CELL_CLASS}>
                      <span className={FACILITY_BADGE_CLASS} style={{ background: gradeTag.bg, color: gradeTag.text }}>
                        {EQUIPMENT_GRADE_LABEL[r.grade]}
                      </span>
                    </td>
                    <td className={FACILITY_TABLE_CELL_CLASS}>
                      <select
                        className="w-[120px] min-h-[36px] rounded border border-navy-100 px-1.5 text-sm"
                        value={assigneeValue(r)}
                        onChange={(e) => handleAssigneeChange(r, e.target.value)}
                        disabled={pending}
                      >
                        <option value="">미지정</option>
                        {assigneeOptions.map((opt) =>
                          opt.kind === "USER" ? (
                            <option key={opt.userId} value={`USER:${opt.userId}`}>{opt.name}</option>
                          ) : (
                            <option key={opt.team} value={`TEAM:${opt.team}`}>{opt.name}</option>
                          ),
                        )}
                      </select>
                    </td>
                    <td className={FACILITY_TABLE_CELL_CLASS}>
                      <button
                        type="button"
                        className={FACILITY_BADGE_CLASS}
                        style={{ background: statusTag.bg, color: statusTag.text }}
                        title={r.status === "UNDER_REPAIR" ? "클릭하여 수리 완료 처리" : "클릭하여 고장 신고 · 예약 불가로 전환"}
                        onClick={() => handleStatusBadgeClick(r)}
                        disabled={pending}
                      >
                        {EQUIPMENT_STATUS_LABEL[r.status]}
                      </button>
                    </td>
                    <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} text-[13px] tabular-nums text-neutral-600`}>{r.currentStart ?? "—"}</td>
                    <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} text-[13px] tabular-nums text-neutral-600`}>{r.currentEnd ?? "—"}</td>
                    <td className={`whitespace-nowrap ${FACILITY_TABLE_CELL_CLASS} text-[13px] text-neutral-500`}>{r.currentHalf ? EQUIPMENT_TIME_HALF_LABEL[r.currentHalf] : "—"}</td>
                    <td className={FACILITY_TABLE_CELL_CLASS}>
                      <button
                        type="button"
                        className="w-[92px] rounded px-2 py-2 text-[13px] font-medium"
                        style={{ background: actionTag.bg, color: actionTag.text }}
                        disabled={pending}
                        onClick={() => handleActionClick(r)}
                      >
                        {actionLabel}
                      </button>
                    </td>
                    <td className={`${FACILITY_TABLE_CELL_CLASS} pr-4`}>
                      {canEditRow(r) && (
                        <button type="button" className="min-w-[60px] rounded border border-neutral-300 px-2.5 py-1.5 text-[13px] text-neutral-600" disabled={pending} onClick={() => handleEditClick(r)}>
                          수정
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 text-[13px] text-neutral-500">
        <div className="flex items-center gap-1.5">
          <span>관리 대상</span>
          {(["HIGH", "MID", "LOW"] as const).map((g) => (
            <span key={g} className={FACILITY_BADGE_CLASS} style={{ background: EQUIPMENT_GRADE_TAG[g].bg, color: EQUIPMENT_GRADE_TAG[g].text }}>{EQUIPMENT_GRADE_LABEL[g]}</span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span>상태</span>
          {(["AVAILABLE", "RESERVED", "IN_USE", "UNDER_REPAIR"] as const).map((s) => (
            <span key={s} className={FACILITY_BADGE_CLASS} style={{ background: EQUIPMENT_STATUS_TAG[s].bg, color: EQUIPMENT_STATUS_TAG[s].text }}>{EQUIPMENT_STATUS_LABEL[s]}</span>
          ))}
        </div>
        <div>관리 대상 &apos;하&apos; 설비는 시료 수량 건수로만 집계되어 사용 통계에 반영되고, 일정 캘린더에는 등록되지 않습니다.</div>
      </div>

      {dialog?.type === "reserve" && dialogEquip && (
        <ReserveDialogView
          dialog={dialog}
          equip={dialogEquip}
          onChange={(patch) => setDialog((prev) => (prev?.type === "reserve" ? { ...prev, ...patch } : prev))}
          onClose={() => setDialog(null)}
          onConfirm={() => void handleConfirmReserve(dialogEquip)}
          onCancelReservation={() => void handleCancelReserve(dialogEquip)}
          pending={pending}
        />
      )}
      {dialog?.type === "use" && dialogEquip && (
        <UseDialogView
          dialog={dialog}
          equip={dialogEquip}
          onChange={(sampleCount) => setDialog((prev) => (prev?.type === "use" ? { ...prev, sampleCount } : prev))}
          onClose={() => setDialog(null)}
          onConfirm={() => void handleConfirmUse(dialogEquip)}
          onCancel={() => void handleCancelUse(dialogEquip)}
          pending={pending}
        />
      )}
      {dialog?.type === "break" && dialogEquip && (
        <BreakDialogView
          dialog={dialog}
          equip={dialogEquip}
          onChange={(reason) => setDialog((prev) => (prev?.type === "break" ? { ...prev, reason } : prev))}
          onClose={() => setDialog(null)}
          onConfirm={() => void handleConfirmBreak(dialogEquip)}
          pending={pending}
        />
      )}
      {dialog?.type === "fix" && dialogEquip && (
        <FixDialogView equip={dialogEquip} onClose={() => setDialog(null)} onConfirm={() => void handleConfirmFixed(dialogEquip)} pending={pending} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-sm shadow-[0_0_0_1px_#e5e7eb,0_6px_18px_rgba(15,23,42,0.08)]">{toast}</div>
      )}
    </FacilityPageShell>
  );
}

function equipLabel(equip: EquipmentRow): string {
  return `${equip.id} · ${equip.name} · ${EQUIPMENT_LOCATION_LABEL[equip.location]} · 관리 대상 ${EQUIPMENT_GRADE_LABEL[equip.grade]} · 사용자 ${equip.assignedUserName ?? "미지정"}`;
}

function DialogShell({ children, width = 400 }: { children: React.ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,23,42,0.45)]">
      <div className="flex max-h-[92vh] flex-col gap-3 overflow-y-auto rounded-lg bg-white p-5 shadow-[0_0_0_1px_#e2e8f0,0_16px_40px_rgba(15,23,42,0.16)]" style={{ width: `min(${width}px, 100%)` }}>
        {children}
      </div>
    </div>
  );
}

function ReserveDialogView({
  dialog,
  equip,
  onChange,
  onClose,
  onConfirm,
  onCancelReservation,
  pending,
}: {
  dialog: ReserveDialog;
  equip: EquipmentRow;
  onChange: (patch: Partial<ReserveDialog>) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCancelReservation: () => void;
  pending: boolean;
}) {
  const needsPurpose = equip.kind === "GENERAL_REPEAT";
  const needsCycle = equip.kind === "REPEAT" || (equip.kind === "GENERAL_REPEAT" && dialog.purpose === "CYCLE");
  const needsSamples = equip.kind === "GENERAL_REPEAT" && dialog.purpose === "ONE_OFF";
  const needsHours = equip.kind === "ENVIRONMENT";

  const first = new Date(Date.UTC(dialog.calYear, dialog.calMonth - 1, 1));
  const lead = first.getUTCDay();
  const len = new Date(Date.UTC(dialog.calYear, dialog.calMonth, 0)).getUTCDate();
  const a = parseCalendarDateInput(dialog.start);
  const b = parseCalendarDateInput(dialog.end);

  function pickDay(day: number) {
    const picked = new Date(Date.UTC(dialog.calYear, dialog.calMonth - 1, day));
    const pickedLabel = formatCalendarDate(picked);
    if (!dialog.anchor) {
      onChange({ anchor: pickedLabel, start: pickedLabel, end: pickedLabel });
      return;
    }
    const anchorDate = parseCalendarDateInput(dialog.anchor)!;
    const lo = anchorDate <= picked ? anchorDate : picked;
    const hi = anchorDate <= picked ? picked : anchorDate;
    onChange({ anchor: null, start: formatCalendarDate(lo), end: formatCalendarDate(hi) });
  }

  function shiftMonth(dir: number) {
    let month = dialog.calMonth + dir;
    let year = dialog.calYear;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    onChange({ calYear: year, calMonth: month });
  }

  return (
    <DialogShell width={560}>
      <div className="flex flex-col gap-0.5">
        <div className="text-base font-medium text-navy-950">{dialog.editMode ? "예약 내용 수정" : "예약 일정 등록"}</div>
        <div className="text-xs text-neutral-500">{equipLabel(equip)}</div>
      </div>

      <div className="flex gap-2">
        <label className="flex-1 text-xs text-neutral-600">
          시작일
          <input className="mt-1 w-full rounded border border-navy-100 px-2 py-1.5 text-sm" placeholder="2026.09.09" value={dialog.start} onChange={(e) => onChange({ start: e.target.value })} />
        </label>
        <label className="flex-1 text-xs text-neutral-600">
          마감일
          <input className="mt-1 w-full rounded border border-navy-100 px-2 py-1.5 text-sm" placeholder="2026.09.11" value={dialog.end} onChange={(e) => onChange({ end: e.target.value })} />
        </label>
      </div>

      <div className="rounded-lg border border-navy-100 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-navy-50" onClick={() => shiftMonth(-1)}>‹</button>
          <span className="text-sm font-medium text-navy-950">{dialog.calYear}년 {dialog.calMonth}월</span>
          <button type="button" className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-navy-50" onClick={() => shiftMonth(1)}>›</button>
        </div>
        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
            <div key={w} className="text-center text-[10px] text-neutral-400">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
          {Array.from({ length: len }, (_, i) => i + 1).map((day) => {
            const cur = new Date(Date.UTC(dialog.calYear, dialog.calMonth - 1, day));
            const inRange = !!(a && b && cur >= a && cur <= b);
            const edge = !!((a && formatCalendarDate(cur) === formatCalendarDate(a)) || (b && formatCalendarDate(cur) === formatCalendarDate(b)));
            return (
              <button
                key={day}
                type="button"
                onClick={() => pickDay(day)}
                className="h-[30px] rounded text-[13px]"
                style={{ border: `1px solid ${edge ? "#2563eb" : "transparent"}`, background: inRange ? "rgba(37,99,235,0.16)" : "transparent", color: inRange ? "#172554" : "#334155" }}
              >
                {day}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] text-neutral-400">날짜를 두 번 클릭해 시작일과 마감일 범위를 지정합니다.</div>
      </div>

      <div>
        <div className="mb-1.5 text-xs text-neutral-500">시간대</div>
        <div className="grid grid-cols-2 gap-2">
          {(["AM", "PM"] as const).map((half) => (
            <button
              key={half}
              type="button"
              className="flex flex-col items-center gap-0.5 rounded-lg p-3"
              style={{ border: `1px solid ${dialog.half === half ? "#2563eb" : "#e5e7eb"}`, background: dialog.half === half ? "rgba(37,99,235,0.12)" : "transparent" }}
              onClick={() => onChange({ half })}
            >
              <span className="text-sm font-medium text-navy-950">{EQUIPMENT_TIME_HALF_LABEL[half]}</span>
              <span className="text-[11px] text-neutral-500">{EQUIPMENT_TIME_HALF_HINT[half]}</span>
            </button>
          ))}
        </div>
      </div>

      {needsPurpose && (
        <div>
          <div className="mb-1.5 text-xs text-neutral-500">사용 목적</div>
          <div className="flex gap-4">
            {(["ONE_OFF", "CYCLE"] as const).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="purpose"
                  checked={dialog.purpose === p}
                  onChange={() => onChange({ purpose: p, cycles: p === "CYCLE" ? dialog.cycles : "", sampleCount: p === "ONE_OFF" ? dialog.sampleCount : "" })}
                />
                {EQUIPMENT_USAGE_PURPOSE_LABEL[p]}
              </label>
            ))}
          </div>
        </div>
      )}

      {needsSamples && (
        <label className="text-xs text-neutral-600">
          시료 수량 (1회성 일반 사용)
          <input className="mt-1 w-full rounded border border-navy-100 px-2 py-1.5 text-sm" placeholder="예: 12" value={dialog.sampleCount} onChange={(e) => onChange({ sampleCount: e.target.value })} />
        </label>
      )}
      {needsCycle && (
        <label className="text-xs text-neutral-600">
          사이클 횟수 (구분: 반복)
          <input className="mt-1 w-full rounded border border-navy-100 px-2 py-1.5 text-sm" placeholder="1,000 / 2,000 등" value={dialog.cycles} onChange={(e) => onChange({ cycles: e.target.value })} />
        </label>
      )}
      {needsHours && (
        <label className="text-xs text-neutral-600">
          사용 시간 (구분: 환경)
          <input className="mt-1 w-full rounded border border-navy-100 px-2 py-1.5 text-sm" placeholder="n시간" value={dialog.hours} onChange={(e) => onChange({ hours: e.target.value })} />
        </label>
      )}

      <div className="flex items-center gap-2">
        {dialog.editMode && (
          <button type="button" className="mr-auto rounded border border-red-300 px-3 py-1.5 text-sm text-red-700" disabled={pending} onClick={onCancelReservation}>
            예약 취소
          </button>
        )}
        <button type="button" className="rounded border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70" onClick={onClose}>닫기</button>
        <button type="button" className="rounded bg-navy-900 px-3 py-1.5 text-sm text-white" disabled={pending} onClick={onConfirm}>
          {dialog.editMode ? "수정 저장" : "예약 등록"}
        </button>
      </div>
    </DialogShell>
  );
}

function UseDialogView({
  dialog,
  equip,
  onChange,
  onClose,
  onConfirm,
  onCancel,
  pending,
}: {
  dialog: UseDialog;
  equip: EquipmentRow;
  onChange: (sampleCount: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <DialogShell>
      <div className="flex flex-col gap-0.5">
        <div className="text-base font-medium text-navy-950">{dialog.editMode ? "시료 수량 수정" : "시료 수량 입력"}</div>
        <div className="text-xs text-neutral-500">{equipLabel(equip)}</div>
      </div>
      <p className="m-0 text-sm text-neutral-600">관리 대상 &apos;하&apos; 설비입니다. 입력한 시료 수량이 수량별 건수로 집계되며, 일정 캘린더에는 반영되지 않습니다.</p>
      <label className="text-xs text-neutral-600">
        시료 수량
        <input className="mt-1 w-full rounded border border-navy-100 px-2 py-1.5 text-sm" placeholder="예: 12" value={dialog.sampleCount} onChange={(e) => onChange(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        {dialog.editMode && (
          <button type="button" className="mr-auto rounded border border-red-300 px-3 py-1.5 text-sm text-red-700" disabled={pending} onClick={onCancel}>
            집계 취소
          </button>
        )}
        <button type="button" className="rounded border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70" onClick={onClose}>닫기</button>
        <button type="button" className="rounded bg-navy-900 px-3 py-1.5 text-sm text-white" disabled={pending} onClick={onConfirm}>
          {dialog.editMode ? "수정 저장" : "건수 등록"}
        </button>
      </div>
    </DialogShell>
  );
}

function BreakDialogView({
  dialog,
  equip,
  onChange,
  onClose,
  onConfirm,
  pending,
}: {
  dialog: BreakDialog;
  equip: EquipmentRow;
  onChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const body =
    equip.status === "RESERVED" || equip.status === "IN_USE"
      ? "진행 중인 예약이 취소되어 일정 캘린더에서 제거되고, 이 예약으로 집계된 시료 수량도 함께 차감됩니다. 수리가 완료되면 상태를 다시 클릭해 예약 가능으로 전환합니다."
      : "해당 설비를 수리중으로 전환해 예약을 받지 않습니다. 수리가 완료되면 상태를 다시 클릭해 예약 가능으로 전환합니다.";
  return (
    <DialogShell>
      <div className="text-base font-medium text-navy-950">고장 신고 · 예약 불가 전환</div>
      <div className="text-xs text-neutral-500">{equipLabel(equip)}</div>
      <p className="m-0 text-sm text-neutral-600">{body}</p>
      <label className="text-xs text-neutral-600">
        고장 내용 (선택)
        <input className="mt-1 w-full rounded border border-navy-100 px-2 py-1.5 text-sm" placeholder="예: 모터 구동 불량" value={dialog.reason} onChange={(e) => onChange(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" className="ml-auto rounded border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70" onClick={onClose}>닫기</button>
        <button type="button" className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700" disabled={pending} onClick={onConfirm}>
          수리중으로 전환
        </button>
      </div>
    </DialogShell>
  );
}

function FixDialogView({ equip, onClose, onConfirm, pending }: { equip: EquipmentRow; onClose: () => void; onConfirm: () => void; pending: boolean }) {
  return (
    <DialogShell>
      <div className="text-base font-medium text-navy-950">예약 불가 · 수리중</div>
      <div className="text-xs text-neutral-500">{equipLabel(equip)}</div>
      <p className="m-0 text-sm text-neutral-600">수리가 진행 중인 설비로 예약할 수 없습니다. 수리가 완료되면 아래에서 예약 가능 상태로 수동 전환합니다.</p>
      {equip.currentFaultNote && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">신고된 고장 내용 · {equip.currentFaultNote}</div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="rounded border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70" onClick={onClose}>닫기</button>
        <button type="button" className="rounded bg-navy-900 px-3 py-1.5 text-sm text-white" disabled={pending} onClick={onConfirm}>
          수리 완료 · 예약 가능으로 전환
        </button>
      </div>
    </DialogShell>
  );
}
