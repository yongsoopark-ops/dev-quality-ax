"use client";

import { useState } from "react";
import type { ProgressItemStatus, ProgressStatus } from "@/app/generated/prisma/enums";
import { PROGRESS_TYPE_FILTERS, type ProgressTypeFilter } from "@/lib/progress/constants";
import { DESIGN_KIND_TAG, designChipClass, designCountPillClass } from "@/lib/progress/designTokens";
import {
  addQuarters,
  addMonthsTo as addMonthsToCal,
  compareMonth,
  compareQuarter,
  currentCalendarMonth,
  currentFiscalQuarter,
  displayDate,
  monthLabel,
  quarterLabel,
  quarterRangeLabel,
  todayCalendarDate,
  type CalendarMonth,
  type FiscalQuarter,
} from "@/lib/progress/date";
import { isCommonTaskDone, isSubProjectDone } from "@/lib/progress/derive";
import type { ProgressAssigneeOption, ProgressCommonTaskRow, ProgressRegularProjectRow, ProgressSubProjectRow } from "@/lib/progress/types";
import { CommonOwnerCard, RegularProjectCard, SubProjectCard } from "./ProgressCards";
import { CommonTaskForm, RegularProjectForm, SubProjectForm, TypePickStep, type CommonDraft, type RegularDraft, type SubDraft } from "./ProgressDrawer";
import { ProgressPageShell } from "./ProgressPageShell";
import type { StageMark } from "./StageRail";
import {
  addRegularProjectUpdateLogAction,
  carryForwardCommonTaskItemAction,
  createCommonTaskAction,
  createRegularProjectAction,
  createSubProjectAction,
  decrementRegularProjectRoundAction,
  deleteCommonTaskAction,
  deleteRegularProjectAction,
  deleteSubProjectAction,
  incrementRegularProjectRoundAction,
  setRegularProjectSampleDateAction,
  setRegularProjectStageAction,
  setRegularProjectStatusAction,
  setSubProjectStatusAction,
  toggleCommonTaskItemStatusAction,
  toggleSubProjectItemStatusAction,
  updateCommonTaskAction,
  updateRegularProjectAction,
  updateSubProjectAction,
  type CommonTaskFormInput,
  type RegularProjectFormInput,
  type SubProjectFormInput,
  type SubProjectItemInput,
} from "./actions";

type ActionResult = { ok?: true; error?: string };

type DialogState =
  | { type: "pick" }
  | { type: "regular"; editId: string | null; draft: RegularDraft; initialDraft: RegularDraft; extraOpen: boolean; confirmDelete: boolean; newLogText: string; error: string }
  | { type: "sub"; editId: string | null; draft: SubDraft; initialDraft: SubDraft; pendingAnchor: FiscalQuarter | null; closedGroups: Set<string>; draftTexts: Record<string, string>; confirmDelete: boolean; error: string }
  | { type: "common"; editId: string | null; draft: CommonDraft; initialDraft: CommonDraft; pendingAnchor: CalendarMonth | null; confirmDelete: boolean; error: string }
  | null;

/** 폼 draft가 열었을 때 값에서 바뀌었는지 — 저장 없이 닫으려 할 때만
 * "변경사항이 저장되지 않습니다" 확인을 받기 위한 판정. UI 전용 상태
 * (pendingAnchor/closedGroups/draftTexts/confirmDelete/error 등)는 저장
 * 대상이 아니므로 draft 필드만 비교한다. */
function isDialogDirty(dialog: DialogState): boolean {
  if (!dialog || dialog.type === "pick") return false;
  return JSON.stringify(dialog.draft) !== JSON.stringify(dialog.initialDraft);
}

function regularDraftFrom(project: ProgressRegularProjectRow): RegularDraft {
  return {
    name: project.name,
    ownerId: project.ownerId,
    status: project.status,
    kickoffDate: project.kickoffDate,
    targetReleaseDate: project.targetReleaseDate,
    actualReleaseDate: project.actualReleaseDate,
    samplePw3Date: project.samplePw3Date,
    samplePw4Date: project.samplePw4Date,
    artifactUrl: project.artifactUrl,
  };
}

function subDraftFrom(project: ProgressSubProjectRow): SubDraft {
  return {
    name: project.name,
    ownerId: project.ownerId,
    status: project.status,
    quarterStart: { year: project.quarterStartYear, q: project.quarterStartQ as 1 | 2 | 3 | 4 },
    quarterEnd: { year: project.quarterEndYear, q: project.quarterEndQ as 1 | 2 | 3 | 4 },
    sheetUrl: project.sheetUrl,
    items: project.items.map((it) => ({ text: it.text, quarterYear: it.quarterYear, quarterNum: it.quarterNum, status: it.status, order: it.order })),
  };
}

function commonDraftFrom(task: ProgressCommonTaskRow): CommonDraft {
  return {
    name: task.name,
    ownerId: task.ownerId,
    repeat: task.repeat,
    repeatDay: task.repeatDay,
    monthStart: { year: task.monthStartYear, month: task.monthStartNum },
    monthEnd: { year: task.monthEndYear, month: task.monthEndNum },
  };
}

function withRecomputedOrder(items: SubProjectItemInput[]): SubProjectItemInput[] {
  const counters = new Map<string, number>();
  return items.map((it) => {
    const key = `${it.quarterYear}-${it.quarterNum}`;
    const order = counters.get(key) ?? 0;
    counters.set(key, order + 1);
    return { ...it, order };
  });
}

export function ProgressClient({
  initialRegularProjects,
  initialSubProjects,
  initialCommonTasks,
  assigneeOptions,
}: {
  initialRegularProjects: ProgressRegularProjectRow[];
  initialSubProjects: ProgressSubProjectRow[];
  initialCommonTasks: ProgressCommonTaskRow[];
  assigneeOptions: ProgressAssigneeOption[];
}) {
  const regularProjects = initialRegularProjects;
  const subProjects = initialSubProjects;
  const commonTasks = initialCommonTasks;

  const [typeFilter, setTypeFilter] = useState<ProgressTypeFilter>("전체");
  const [ownerFilter, setOwnerFilter] = useState<string>("전체");
  const [quarter, setQuarter] = useState<FiscalQuarter>(() => currentFiscalQuarter());
  const [month, setMonth] = useState<CalendarMonth>(() => currentCalendarMonth());
  const [doneOpen, setDoneOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);

  function say(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }

  async function runQuickAction(fn: () => Promise<ActionResult>, successMessage?: string) {
    setPending(true);
    try {
      const result = await fn();
      if (result.error) say(result.error);
      else if (successMessage) say(successMessage);
    } finally {
      setPending(false);
    }
  }

  function ownerOk(ownerId: string): boolean {
    return ownerFilter === "전체" || ownerId === ownerFilter;
  }

  const activeRegular = regularProjects.filter((p) => p.status !== "DONE" && ownerOk(p.ownerId));
  const activeSub = subProjects.filter((p) => !isSubProjectDone(p) && ownerOk(p.ownerId) && p.items.some((it) => it.quarterYear === quarter.year && it.quarterNum === quarter.q));
  const activeCommon = commonTasks.filter((t) => !isCommonTaskDone(t) && ownerOk(t.ownerId));

  const typeCounts: Record<ProgressTypeFilter, number> = {
    전체: activeRegular.length + activeSub.length + activeCommon.length,
    정규: activeRegular.length,
    서브: activeSub.length,
    공통: activeCommon.length,
  };

  const ownerChipOptions = [{ id: "전체", label: "전체" }, ...assigneeOptions.map((o) => ({ id: o.userId, label: o.name }))];
  const filterActive = typeFilter !== "전체" || ownerFilter !== "전체";

  const commonOwnerGroups = (() => {
    const map = new Map<string, { ownerId: string; ownerName: string; items: { itemId: string; taskId: string; taskName: string; status: ProgressItemStatus; repeat: boolean; repeatDay: string; carriedFromYear: number | null; carriedFromMonth: number | null }[] }>();
    for (const task of commonTasks) {
      if (!ownerOk(task.ownerId)) continue;
      for (const item of task.items) {
        if (item.monthYear !== month.year || item.monthNum !== month.month) continue;
        if (!map.has(task.ownerId)) map.set(task.ownerId, { ownerId: task.ownerId, ownerName: task.ownerName, items: [] });
        map.get(task.ownerId)!.items.push({
          itemId: item.id,
          taskId: task.id,
          taskName: task.name,
          status: item.status,
          repeat: task.repeat,
          repeatDay: task.repeatDay,
          carriedFromYear: item.carriedFromYear,
          carriedFromMonth: item.carriedFromMonth,
        });
      }
    }
    return Array.from(map.values());
  })();

  const doneRows = [
    ...regularProjects
      .filter((p) => p.status === "DONE" && ownerOk(p.ownerId))
      .map((p) => ({ key: `r-${p.id}`, kind: "정규" as const, name: p.name, ownerName: p.ownerName, note: p.actualReleaseDate || "—" })),
    ...subProjects
      .filter((p) => isSubProjectDone(p) && ownerOk(p.ownerId))
      .map((p) => ({ key: `s-${p.id}`, kind: "서브" as const, name: p.name, ownerName: p.ownerName, note: `${p.quarterStartYear} Q${p.quarterStartQ}` })),
    ...commonTasks
      .filter((t) => isCommonTaskDone(t) && ownerOk(t.ownerId))
      .map((t) => ({ key: `c-${t.id}`, kind: "공통" as const, name: t.name, ownerName: t.ownerName, note: "" })),
  ];

  function defaultOwnerId(): string {
    if (ownerFilter !== "전체") return ownerFilter;
    return assigneeOptions[0]?.userId ?? "";
  }

  // ── Drawer 열기/닫기 ─────────────────────────────────────────────────

  function openTypePick() {
    setDialog({ type: "pick" });
  }

  function pickType(key: "regular" | "sub" | "common") {
    const ownerId = defaultOwnerId();
    if (key === "regular") {
      const draft: RegularDraft = { name: "", ownerId, status: "IN_PROGRESS", kickoffDate: "", targetReleaseDate: "", actualReleaseDate: "", samplePw3Date: "", samplePw4Date: "", artifactUrl: "" };
      setDialog({ type: "regular", editId: null, draft, initialDraft: draft, extraOpen: false, confirmDelete: false, newLogText: "", error: "" });
    } else if (key === "sub") {
      const q = currentFiscalQuarter();
      const draft: SubDraft = { name: "", ownerId, status: "PLANNED", quarterStart: q, quarterEnd: q, sheetUrl: "", items: [] };
      setDialog({ type: "sub", editId: null, draft, initialDraft: draft, pendingAnchor: null, closedGroups: new Set(), draftTexts: {}, confirmDelete: false, error: "" });
    } else {
      const m = currentCalendarMonth();
      const draft: CommonDraft = { name: "", ownerId, repeat: false, repeatDay: "1", monthStart: m, monthEnd: m };
      setDialog({ type: "common", editId: null, draft, initialDraft: draft, pendingAnchor: null, confirmDelete: false, error: "" });
    }
  }

  function openEditRegular(project: ProgressRegularProjectRow) {
    const draft = regularDraftFrom(project);
    setDialog({ type: "regular", editId: project.id, draft, initialDraft: draft, extraOpen: false, confirmDelete: false, newLogText: "", error: "" });
  }

  function openEditSub(project: ProgressSubProjectRow) {
    const draft = subDraftFrom(project);
    setDialog({ type: "sub", editId: project.id, draft, initialDraft: draft, pendingAnchor: null, closedGroups: new Set(), draftTexts: {}, confirmDelete: false, error: "" });
  }

  function openEditCommon(task: ProgressCommonTaskRow) {
    const draft = commonDraftFrom(task);
    setDialog({ type: "common", editId: task.id, draft, initialDraft: draft, pendingAnchor: null, confirmDelete: false, error: "" });
  }

  function openEditCommonById(taskId: string) {
    const task = commonTasks.find((t) => t.id === taskId);
    if (task) openEditCommon(task);
  }

  function closeDialog() {
    setDialog(null);
  }

  /** 배경 클릭·× 버튼·"닫기" 버튼이 전부 이 함수 하나로 들어온다(셋 다
  * 각 폼에 내려주는 동일한 onClose prop을 쓰기 때문). draft가 연 시점
  * 값에서 바뀌었을 때만 확인을 받고, 바뀐 게 없으면 바로 닫는다. */
  function requestCloseDialog() {
    if (isDialogDirty(dialog)) {
      if (!window.confirm("변경사항이 저장되지 않습니다. 닫으시겠습니까?")) return;
    }
    closeDialog();
  }

  // ── 정규 프로젝트 핸들러 ─────────────────────────────────────────────

  async function handleStatusChangeRegular(projectId: string, status: ProgressStatus) {
    await runQuickAction(() => setRegularProjectStatusAction(projectId, status));
  }

  async function handleStageChange(projectId: string, index: number, mark: StageMark) {
    await runQuickAction(() => setRegularProjectStageAction(projectId, index, mark));
  }

  async function handleSampleDateChange(projectId: string, index: number, value: string) {
    await runQuickAction(() => setRegularProjectSampleDateAction(projectId, index, value));
  }

  async function handleAddRound(projectId: string) {
    await runQuickAction(() => incrementRegularProjectRoundAction(projectId));
  }

  async function handleCancelRound(projectId: string) {
    await runQuickAction(() => decrementRegularProjectRoundAction(projectId));
  }

  async function saveRegular() {
    if (dialog?.type !== "regular") return;
    const input: RegularProjectFormInput = dialog.draft;
    setPending(true);
    try {
      const result = dialog.editId ? await updateRegularProjectAction(dialog.editId, input) : await createRegularProjectAction(input);
      if (result.error) {
        setDialog((prev) => (prev?.type === "regular" ? { ...prev, error: result.error! } : prev));
      } else {
        say(dialog.editId ? "정규 프로젝트를 수정했습니다." : "정규 프로젝트를 등록했습니다.");
        setDialog(null);
      }
    } finally {
      setPending(false);
    }
  }

  async function deleteRegular() {
    if (dialog?.type !== "regular" || !dialog.editId) return;
    await runQuickAction(() => deleteRegularProjectAction(dialog.editId!), "정규 프로젝트를 삭제했습니다.");
    setDialog(null);
  }

  async function addLog() {
    if (dialog?.type !== "regular" || !dialog.editId) return;
    const content = dialog.newLogText;
    setPending(true);
    try {
      const result = await addRegularProjectUpdateLogAction(dialog.editId, content);
      if (result.error) setDialog((prev) => (prev?.type === "regular" ? { ...prev, error: result.error! } : prev));
      else setDialog((prev) => (prev?.type === "regular" ? { ...prev, newLogText: "", error: "" } : prev));
    } finally {
      setPending(false);
    }
  }

  // ── 서브 프로젝트 핸들러 ─────────────────────────────────────────────

  async function handleStatusChangeSub(projectId: string, status: ProgressStatus) {
    await runQuickAction(() => setSubProjectStatusAction(projectId, status));
  }

  async function handleToggleSubItem(itemId: string) {
    await runQuickAction(() => toggleSubProjectItemStatusAction(itemId));
  }

  function pickSubQuarter(fq: FiscalQuarter) {
    setDialog((prev) => {
      if (prev?.type !== "sub") return prev;
      if (!prev.pendingAnchor) {
        return { ...prev, pendingAnchor: fq, draft: { ...prev.draft, quarterStart: fq, quarterEnd: fq } };
      }
      const lo = compareQuarter(prev.pendingAnchor, fq) <= 0 ? prev.pendingAnchor : fq;
      const hi = compareQuarter(prev.pendingAnchor, fq) <= 0 ? fq : prev.pendingAnchor;
      const items = prev.draft.items.map((it) => {
        const q = { year: it.quarterYear, q: it.quarterNum } as FiscalQuarter;
        if (compareQuarter(q, lo) < 0 || compareQuarter(q, hi) > 0) return { ...it, quarterYear: lo.year, quarterNum: lo.q };
        return it;
      });
      return { ...prev, pendingAnchor: null, draft: { ...prev.draft, quarterStart: lo, quarterEnd: hi, items } };
    });
  }

  function toggleSubGroup(key: string) {
    setDialog((prev) => {
      if (prev?.type !== "sub") return prev;
      const next = new Set(prev.closedGroups);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, closedGroups: next };
    });
  }

  function updateSubDraftText(key: string, value: string) {
    setDialog((prev) => (prev?.type === "sub" ? { ...prev, draftTexts: { ...prev.draftTexts, [key]: value } } : prev));
  }

  function addSubItem(year: number, q: number) {
    setDialog((prev) => {
      if (prev?.type !== "sub") return prev;
      const key = `${year}-${q}`;
      const text = (prev.draftTexts[key] ?? "").trim();
      if (!text) return prev;
      const order = prev.draft.items.filter((it) => it.quarterYear === year && it.quarterNum === q).length;
      const items = [...prev.draft.items, { text, quarterYear: year, quarterNum: q, status: "WAITING" as ProgressItemStatus, order }];
      return { ...prev, draft: { ...prev.draft, items }, draftTexts: { ...prev.draftTexts, [key]: "" } };
    });
  }

  function updateSubItemText(index: number, text: string) {
    setDialog((prev) => {
      if (prev?.type !== "sub") return prev;
      const items = prev.draft.items.map((it, i) => (i === index ? { ...it, text } : it));
      return { ...prev, draft: { ...prev.draft, items } };
    });
  }

  function updateSubItemStatus(index: number, status: ProgressItemStatus) {
    setDialog((prev) => {
      if (prev?.type !== "sub") return prev;
      const items = prev.draft.items.map((it, i) => (i === index ? { ...it, status } : it));
      return { ...prev, draft: { ...prev.draft, items } };
    });
  }

  function removeSubItem(index: number) {
    setDialog((prev) => {
      if (prev?.type !== "sub") return prev;
      const items = prev.draft.items.filter((_, i) => i !== index);
      return { ...prev, draft: { ...prev.draft, items } };
    });
  }

  function reorderSubItem(fromIndex: number, toIndex: number) {
    setDialog((prev) => {
      if (prev?.type !== "sub") return prev;
      const items = [...prev.draft.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return { ...prev, draft: { ...prev.draft, items } };
    });
  }

  async function saveSub() {
    if (dialog?.type !== "sub") return;
    const d = dialog.draft;
    const input: SubProjectFormInput = {
      name: d.name,
      ownerId: d.ownerId,
      status: d.status,
      quarterStartYear: d.quarterStart.year,
      quarterStartQ: d.quarterStart.q,
      quarterEndYear: d.quarterEnd.year,
      quarterEndQ: d.quarterEnd.q,
      sheetUrl: d.sheetUrl,
      items: withRecomputedOrder(d.items),
    };
    setPending(true);
    try {
      const result = dialog.editId ? await updateSubProjectAction(dialog.editId, input) : await createSubProjectAction(input);
      if (result.error) {
        setDialog((prev) => (prev?.type === "sub" ? { ...prev, error: result.error! } : prev));
      } else {
        say(dialog.editId ? "서브 프로젝트를 수정했습니다." : "서브 프로젝트를 등록했습니다.");
        setDialog(null);
      }
    } finally {
      setPending(false);
    }
  }

  async function deleteSub() {
    if (dialog?.type !== "sub" || !dialog.editId) return;
    await runQuickAction(() => deleteSubProjectAction(dialog.editId!), "서브 프로젝트를 삭제했습니다.");
    setDialog(null);
  }

  // ── 공통 업무 핸들러 ─────────────────────────────────────────────────

  async function handleToggleCommonItem(itemId: string) {
    await runQuickAction(() => toggleCommonTaskItemStatusAction(itemId));
  }

  async function handleCarryForward(itemId: string) {
    await runQuickAction(() => carryForwardCommonTaskItemAction(itemId));
  }

  function pickCommonMonth(m: CalendarMonth) {
    setDialog((prev) => {
      if (prev?.type !== "common") return prev;
      if (!prev.pendingAnchor) {
        return { ...prev, pendingAnchor: m, draft: { ...prev.draft, monthStart: m, monthEnd: m } };
      }
      const lo = compareMonth(prev.pendingAnchor, m) <= 0 ? prev.pendingAnchor : m;
      const hi = compareMonth(prev.pendingAnchor, m) <= 0 ? m : prev.pendingAnchor;
      return { ...prev, pendingAnchor: null, draft: { ...prev.draft, monthStart: lo, monthEnd: hi } };
    });
  }

  async function saveCommon() {
    if (dialog?.type !== "common") return;
    const d = dialog.draft;
    const input: CommonTaskFormInput = {
      name: d.name,
      ownerId: d.ownerId,
      repeat: d.repeat,
      repeatDay: d.repeatDay,
      monthStartYear: d.monthStart.year,
      monthStartNum: d.monthStart.month,
      monthEndYear: d.monthEnd.year,
      monthEndNum: d.monthEnd.month,
    };
    setPending(true);
    try {
      const result = dialog.editId ? await updateCommonTaskAction(dialog.editId, input) : await createCommonTaskAction(input);
      if (result.error) {
        setDialog((prev) => (prev?.type === "common" ? { ...prev, error: result.error! } : prev));
      } else {
        say(dialog.editId ? "공통 업무를 수정했습니다." : "공통 업무를 등록했습니다.");
        setDialog(null);
      }
    } finally {
      setPending(false);
    }
  }

  async function deleteCommon() {
    if (dialog?.type !== "common" || !dialog.editId) return;
    await runQuickAction(() => deleteCommonTaskAction(dialog.editId!), "공통 업무를 삭제했습니다.");
    setDialog(null);
  }

  return (
    <ProgressPageShell>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-[#1b1f2b]" style={{ letterSpacing: "-0.01em" }}>진행 현황</h1>
          <p className="m-0 mt-[5px] text-[12.5px] text-[#6f778a]">개발품질파트가 지금 어떤 단계·목표·계획으로 업무를 진행하고 있는지 확인하고 갱신합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="whitespace-nowrap text-[12px] text-[#8a91a3]">기준일 {displayDate(todayCalendarDate())}</div>
          <button
            type="button"
            onClick={openTypePick}
            className="whitespace-nowrap rounded-lg border border-navy-700 bg-navy-700 px-4 py-2 text-[12.5px] leading-tight text-white hover:border-navy-800 hover:bg-navy-800"
          >
            + 업무 등록
          </button>
        </div>
      </header>

      <section className="flex flex-col gap-[9px] rounded-xl border border-[#dde2ea] bg-white px-[14px] py-[10px]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-[44px] shrink-0 text-[11.5px] text-[#8a91a3]">업무 유형</div>
          <div className="flex flex-wrap gap-1.5">
            {PROGRESS_TYPE_FILTERS.map((f) => {
              const active = typeFilter === f;
              return (
                <button key={f} type="button" className={designChipClass(active)} onClick={() => setTypeFilter(f)}>
                  <span>{f}</span>
                  <span className={designCountPillClass(active)}>{typeCounts[f]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="h-px bg-[#edf0f4]" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-[44px] shrink-0 text-[11.5px] text-[#8a91a3]">담당자</div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {ownerChipOptions.map((o) => (
              <button key={o.id} type="button" className={designChipClass(ownerFilter === o.id)} onClick={() => setOwnerFilter(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          {filterActive && (
            <button type="button" onClick={() => { setTypeFilter("전체"); setOwnerFilter("전체"); }} className="whitespace-nowrap text-[11.5px] text-[#6f778a] underline">
              필터 초기화
            </button>
          )}
        </div>
      </section>

      {(typeFilter === "전체" || typeFilter === "정규") && (
        <section className="flex flex-col gap-[9px]">
          <div className="flex items-baseline gap-2.5">
            <span className="h-3.5 w-[3px] shrink-0 self-center rounded-sm bg-navy-700" />
            <h2 className="m-0 text-[15px] font-semibold text-[#1b1f2b]">정규 프로젝트</h2>
            <span className="text-[11.5px] text-[#8a91a3]">{activeRegular.length}건 · 현재 PW 단계 기준</span>
          </div>
          {activeRegular.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d5dbe5] bg-white px-[26px] py-[26px] text-center text-[12.5px] text-[#8a91a3]">조건에 해당하는 정규 프로젝트가 없습니다.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeRegular.map((p) => (
                <RegularProjectCard
                  key={p.id}
                  project={p}
                  pending={pending}
                  onEdit={() => openEditRegular(p)}
                  onStatusChange={(s) => handleStatusChangeRegular(p.id, s)}
                  onStageChange={(idx, mark) => handleStageChange(p.id, idx, mark)}
                  onSampleDateChange={(idx, v) => handleSampleDateChange(p.id, idx, v)}
                  onAddRound={() => handleAddRound(p.id)}
                  onCancelRound={() => handleCancelRound(p.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {(typeFilter === "전체" || typeFilter === "서브") && (
        <section className="flex flex-col gap-[9px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="h-3.5 w-[3px] shrink-0 rounded-sm bg-violet-600" />
            <h2 className="m-0 text-[15px] font-semibold text-[#1b1f2b]">서브 프로젝트</h2>
            <span className="text-[11.5px] text-[#8a91a3]">{activeSub.length}건 · 해당 분기에 진행하는 세부 목표만 표시</span>
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-[#dde2ea] bg-white p-[3px]">
              <button type="button" className="h-6 w-[26px] rounded-md text-[13px] text-[#4b5364] hover:bg-[#f1f4f8]" onClick={() => setQuarter((q) => addQuarters(q, -1))}>‹</button>
              <div title={quarterRangeLabel(quarter)} className="min-w-[74px] text-center text-[12.5px] font-semibold tabular-nums">{quarterLabel(quarter)}</div>
              <button type="button" className="h-6 w-[26px] rounded-md text-[13px] text-[#4b5364] hover:bg-[#f1f4f8]" onClick={() => setQuarter((q) => addQuarters(q, 1))}>›</button>
            </div>
            {compareQuarter(quarter, currentFiscalQuarter()) !== 0 && (
              <button type="button" onClick={() => setQuarter(currentFiscalQuarter())} className="whitespace-nowrap rounded-lg border border-navy-100 bg-white px-2.5 py-1 text-[11.5px] text-navy-700">이번 분기</button>
            )}
          </div>
          {activeSub.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d5dbe5] bg-white px-[26px] py-[26px] text-center text-[12.5px] text-[#8a91a3]">{quarterLabel(quarter)}에 진행 예정인 세부 목표가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-2">
              {activeSub.map((p) => (
                <SubProjectCard key={p.id} project={p} quarter={quarter} pending={pending} onEdit={() => openEditSub(p)} onStatusChange={(s) => handleStatusChangeSub(p.id, s)} onToggleItem={handleToggleSubItem} />
              ))}
            </div>
          )}
        </section>
      )}

      {(typeFilter === "전체" || typeFilter === "공통") && (
        <section className="flex flex-col gap-[9px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="h-3.5 w-[3px] shrink-0 rounded-sm bg-teal-600" />
            <h2 className="m-0 text-[15px] font-semibold text-[#1b1f2b]">공통 업무</h2>
            <span className="text-[11.5px] text-[#8a91a3]">담당자별 월 계획</span>
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-[#dde2ea] bg-white p-[3px]">
              <button type="button" className="h-6 w-[26px] rounded-md text-[13px] text-[#4b5364] hover:bg-[#f1f4f8]" onClick={() => setMonth((m) => addMonthsToCal(m, -1))}>‹</button>
              <div className="min-w-16 text-center text-[12.5px] font-semibold tabular-nums">{monthLabel(month)}</div>
              <button type="button" className="h-6 w-[26px] rounded-md text-[13px] text-[#4b5364] hover:bg-[#f1f4f8]" onClick={() => setMonth((m) => addMonthsToCal(m, 1))}>›</button>
            </div>
            {compareMonth(month, currentCalendarMonth()) !== 0 && (
              <button type="button" onClick={() => setMonth(currentCalendarMonth())} className="whitespace-nowrap rounded-lg border border-navy-100 bg-white px-2.5 py-1 text-[11.5px] text-navy-700">이번 달</button>
            )}
          </div>
          {commonOwnerGroups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d5dbe5] bg-white px-[26px] py-[26px] text-center text-[12.5px] text-[#8a91a3]">{monthLabel(month)}에 계획된 공통 업무가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-2">
              {commonOwnerGroups.map((g) => (
                <CommonOwnerCard
                  key={g.ownerId}
                  ownerName={g.ownerName}
                  items={g.items}
                  month={month}
                  pending={pending}
                  onEditTask={openEditCommonById}
                  onToggleItem={handleToggleCommonItem}
                  onCarryForward={handleCarryForward}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-[9px]">
        <button type="button" onClick={() => setDoneOpen((v) => !v)} className="flex items-center gap-2.5 self-start border-0 bg-transparent p-0 text-[#6f778a]">
          <span className="text-[10px]">{doneOpen ? "▾" : "▸"}</span>
          <span className="text-[13px] font-semibold text-[#4b5364]">완료 업무</span>
          <span className="text-[11.5px] text-[#8a91a3]">{doneRows.length}건</span>
        </button>
        {doneOpen && (
          <div className="flex flex-col gap-1.5">
            {doneRows.length === 0 && <div className="text-[12.5px] text-[#8a91a3]">완료된 업무가 없습니다.</div>}
            {doneRows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-[#e6eaf0] bg-white px-[14px] py-[10px]">
                <span
                  className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold"
                  style={{ color: DESIGN_KIND_TAG[r.kind].color, background: DESIGN_KIND_TAG[r.kind].bg, border: `1px solid ${DESIGN_KIND_TAG[r.kind].border}` }}
                >
                  {r.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[#1b1f2b]">{r.name}</span>
                <span className="text-[11.5px] text-[#6f778a]">{r.ownerName}</span>
                <span className="ml-auto whitespace-nowrap rounded-full border border-green-200 bg-green-50 px-[9px] py-0.5 text-[11.5px] text-green-700">완료</span>
                <span className="whitespace-nowrap text-[11.5px] text-[#8a91a3]">{r.note}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {dialog?.type === "pick" && <TypePickStep onClose={closeDialog} onPick={pickType} />}

      {dialog?.type === "regular" && (
        <RegularProjectForm
          draft={dialog.draft}
          editing={!!dialog.editId}
          project={dialog.editId ? regularProjects.find((p) => p.id === dialog.editId) ?? null : null}
          assigneeOptions={assigneeOptions}
          extraOpen={dialog.extraOpen}
          confirmDelete={dialog.confirmDelete}
          newLogText={dialog.newLogText}
          error={dialog.error}
          pending={pending}
          onChange={(patch) => setDialog((prev) => (prev?.type === "regular" ? { ...prev, draft: { ...prev.draft, ...patch } } : prev))}
          onToggleExtra={() => setDialog((prev) => (prev?.type === "regular" ? { ...prev, extraOpen: !prev.extraOpen } : prev))}
          onNewLogTextChange={(v) => setDialog((prev) => (prev?.type === "regular" ? { ...prev, newLogText: v } : prev))}
          onAddLog={() => void addLog()}
          onClose={requestCloseDialog}
          onSave={() => void saveRegular()}
          onDeleteClick={() => setDialog((prev) => (prev?.type === "regular" ? { ...prev, confirmDelete: true } : prev))}
          onDeleteConfirm={() => void deleteRegular()}
        />
      )}

      {dialog?.type === "sub" && (
        <SubProjectForm
          draft={dialog.draft}
          editing={!!dialog.editId}
          assigneeOptions={assigneeOptions}
          pendingRangeAnchor={dialog.pendingAnchor}
          closedGroups={dialog.closedGroups}
          draftTexts={dialog.draftTexts}
          confirmDelete={dialog.confirmDelete}
          error={dialog.error}
          pending={pending}
          onChange={(patch) => setDialog((prev) => (prev?.type === "sub" ? { ...prev, draft: { ...prev.draft, ...patch } } : prev))}
          onPickQuarter={pickSubQuarter}
          onToggleGroup={toggleSubGroup}
          onDraftTextChange={updateSubDraftText}
          onAddItem={addSubItem}
          onUpdateItemText={updateSubItemText}
          onUpdateItemStatus={updateSubItemStatus}
          onRemoveItem={removeSubItem}
          onReorderItem={reorderSubItem}
          onClose={requestCloseDialog}
          onSave={() => void saveSub()}
          onDeleteClick={() => setDialog((prev) => (prev?.type === "sub" ? { ...prev, confirmDelete: true } : prev))}
          onDeleteConfirm={() => void deleteSub()}
        />
      )}

      {dialog?.type === "common" && (
        <CommonTaskForm
          draft={dialog.draft}
          editing={!!dialog.editId}
          assigneeOptions={assigneeOptions}
          pendingRangeAnchor={dialog.pendingAnchor}
          confirmDelete={dialog.confirmDelete}
          error={dialog.error}
          pending={pending}
          onChange={(patch) => setDialog((prev) => (prev?.type === "common" ? { ...prev, draft: { ...prev.draft, ...patch } } : prev))}
          onPickMonth={pickCommonMonth}
          onClose={requestCloseDialog}
          onSave={() => void saveCommon()}
          onDeleteClick={() => setDialog((prev) => (prev?.type === "common" ? { ...prev, confirmDelete: true } : prev))}
          onDeleteConfirm={() => void deleteCommon()}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-sm shadow-[0_0_0_1px_#e5e7eb,0_6px_18px_rgba(15,23,42,0.08)]">{toast}</div>
      )}
    </ProgressPageShell>
  );
}
