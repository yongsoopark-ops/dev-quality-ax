"use client";

import { useState } from "react";
import type { ProgressItemStatus, ProgressStatus } from "@/app/generated/prisma/enums";
import {
  PROGRESS_ITEM_STATUS_LABEL,
  PROGRESS_REPEAT_DAY_OPTIONS,
  PROGRESS_STATUS_LABEL,
  PROGRESS_TYPE_PICK_OPTIONS,
  repeatDayLabel,
} from "@/lib/progress/constants";
import { addQuarters, compareMonth, compareQuarter, monthLabel, quarterLabel, type CalendarMonth, type FiscalQuarter } from "@/lib/progress/date";
import type { ProgressAssigneeOption, ProgressRegularProjectRow } from "@/lib/progress/types";
import type { RegularProjectFormInput, SubProjectFormInput, SubProjectItemInput, CommonTaskFormInput } from "./actions";
import { SegmentedDateInput, SegmentedMonthInput } from "./DateSegments";
import { PROGRESS_UI_SCALE } from "./ProgressPageShell";

/**
 * 진행 현황 — 업무 등록/수정 Drawer. ZIP §8의 3단계(유형 선택 → 유형별
 * 폼)를 그대로 따른다. 중앙 모달(변수명은 drawer지만 실제로는 Side Panel이
 * 아니라 중앙 모달 — ZIP 리포트 §8 그대로)이며, 반투명 배경 클릭으로 닫힌다.
 *
 * 확대 배율은 별도로 걸지 않는다 — `position: fixed`는 위치 계산의
 * containing block만 viewport로 바꿀 뿐, 렌더링 스케일(zoom)은 DOM
 * 트리를 따라 그대로 상속된다. 이 Drawer가 (React Portal 없이) 이미
 * zoom이 걸린 ProgressPageShell 안에 중첩 렌더링되므로 여기 또 zoom을
 * 걸면 1.5×1.5=2.25배로 곱배가 된다(실측으로 확인 — 걸었다가 모달 폭이
 * 840px이 아니라 1260px로 나와서 알아냄). ProgressPageShell 바깥(예:
 * Portal)으로 옮기게 되면 그때는 여기에도 PROGRESS_UI_SCALE을 다시
 * 걸어야 한다.
 *
 * 헤더/본문/푸터 3분할 — 세부 목표가 많은 서브 프로젝트 폼처럼 본문이
 * 길어지면 예전엔 모달 박스 전체(`max-h-[92vh] overflow-y-auto`)가
 * 늘어나 뷰포트를 넘쳤고, 그 늘어난 부분이 안 보여서 저장 버튼에 손을
 * 댈 수 없었다. 이제 모달 박스는 `flex-col + overflow-hidden`로 고정하고
 * 헤더·푸터는 `shrink-0`, 본문만 `flex-1 overflow-y-auto`로 스크롤을
 * 떠맡는다.
 *
 * `calc((100vh - 72px) / PROGRESS_UI_SCALE)` — `vh`도 다른 px 값과
 * 마찬가지로 이 배율이 걸린 subtree 안에서는 실제 렌더 크기가
 * "값 × PROGRESS_UI_SCALE"이 된다(실측: `50vh`가 진짜 뷰포트의 50%가
 * 아니라 60%로 렌더됨 — 1.2배 그대로 곱해짐). `calc` 전체를
 * PROGRESS_UI_SCALE로 나눠주면 그 곱셈이 상쇄돼 "실제 뷰포트 - 72
 * 실제 px"이 정확히 나온다(1440×900 뷰포트로 실측 확인: 828px 정확히
 * 일치) — max-width 때와 같은 "목표값 ÷ 배율" 패턴을 여기도 그대로
 * 적용한 것이다.
 */
export function DrawerShell({
  header,
  footer,
  children,
  width = 480,
  onClose,
}: {
  header: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,23,42,0.45)]" onClick={onClose}>
      <div
        className="flex flex-col overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_#e2e8f0,0_16px_40px_rgba(15,23,42,0.16)]"
        style={{ width: `min(${width}px, 100%)`, maxHeight: `calc((100vh - 72px) / ${PROGRESS_UI_SCALE})` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-navy-100 px-5 py-4">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-4">{children}</div>
        </div>
        {footer && <div className="shrink-0 border-t border-navy-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function TypePickStep({ onClose, onPick }: { onClose: () => void; onPick: (key: "regular" | "sub" | "common") => void }) {
  return (
    <DrawerShell
      width={520}
      onClose={onClose}
      header={
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-navy-950">업무 등록</div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-navy-950">×</button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {PROGRESS_TYPE_PICK_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onPick(opt.key)}
            className="rounded-lg border border-navy-100 px-4 py-3 text-left hover:border-navy-300 hover:bg-navy-50"
          >
            <div className="text-[14px] font-semibold text-navy-950">{opt.label}</div>
            <div className="mt-0.5 text-[13px] text-neutral-500">{opt.description}</div>
          </button>
        ))}
      </div>
    </DrawerShell>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[13px] text-neutral-600">{children}</div>;
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded border border-navy-100 px-2.5 py-1.5 text-[13px] ${props.className ?? ""}`} />;
}

function OwnerSelect({ value, options, onChange }: { value: string; options: ProgressAssigneeOption[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-navy-100 px-2.5 py-1.5 text-[13px]">
      {options.map((o) => (
        <option key={o.userId} value={o.userId}>{o.name}</option>
      ))}
    </select>
  );
}

function StatusSelectInput({ value, onChange }: { value: ProgressStatus; onChange: (v: ProgressStatus) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ProgressStatus)} className="w-full rounded border border-navy-100 px-2.5 py-1.5 text-[13px]">
      {(Object.keys(PROGRESS_STATUS_LABEL) as ProgressStatus[]).map((s) => (
        <option key={s} value={s}>{PROGRESS_STATUS_LABEL[s]}</option>
      ))}
    </select>
  );
}

function DeleteFooterButton({ confirmDelete, onFirstClick, onConfirm }: { confirmDelete: boolean; onFirstClick: () => void; onConfirm: () => void }) {
  return (
    <button
      type="button"
      onClick={confirmDelete ? onConfirm : onFirstClick}
      className={`mr-auto rounded border px-3 py-1.5 text-sm ${confirmDelete ? "border-red-400 bg-red-50 text-red-700" : "border-red-300 text-red-700"}`}
    >
      {confirmDelete ? "정말 삭제할까요? 한 번 더 클릭" : "삭제"}
    </button>
  );
}

// ── 정규 프로젝트 폼 ────────────────────────────────────────────────────

export interface RegularDraft extends RegularProjectFormInput {}

export function RegularProjectForm({
  draft,
  editing,
  project,
  assigneeOptions,
  extraOpen,
  confirmDelete,
  newLogText,
  error,
  pending,
  onChange,
  onToggleExtra,
  onNewLogTextChange,
  onAddLog,
  onClose,
  onSave,
  onDeleteClick,
  onDeleteConfirm,
}: {
  draft: RegularDraft;
  editing: boolean;
  project: ProgressRegularProjectRow | null;
  assigneeOptions: ProgressAssigneeOption[];
  extraOpen: boolean;
  confirmDelete: boolean;
  newLogText: string;
  error: string;
  pending: boolean;
  onChange: (patch: Partial<RegularDraft>) => void;
  onToggleExtra: () => void;
  onNewLogTextChange: (v: string) => void;
  onAddLog: () => void;
  onClose: () => void;
  onSave: () => void;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
}) {
  return (
    <DrawerShell
      width={560}
      onClose={onClose}
      header={
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-navy-950">{editing ? "정규 프로젝트 수정" : "정규 프로젝트 등록"}</div>
            <div className="text-[12px] text-neutral-500">일정과 개선 차수, 상태를 관리합니다 (PW 단계는 현황판 레일에서 변경)</div>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-navy-950">×</button>
        </div>
      }
      footer={
        <div className="flex items-center gap-2">
          {editing && <DeleteFooterButton confirmDelete={confirmDelete} onFirstClick={onDeleteClick} onConfirm={onDeleteConfirm} />}
          <button type="button" onClick={onClose} className="ml-auto rounded border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70">닫기</button>
          <button type="button" onClick={onSave} disabled={pending} className="rounded bg-navy-900 px-3 py-1.5 text-sm text-white">
            {editing ? "수정 저장" : "등록"}
          </button>
        </div>
      }
    >
      <div>
        <FieldLabel>프로젝트명</FieldLabel>
        <TextInput placeholder="예) 차량용 무선충전 거치대 3세대" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>담당자</FieldLabel>
          <OwnerSelect value={draft.ownerId} options={assigneeOptions} onChange={(v) => onChange({ ownerId: v })} />
        </div>
        <div>
          <FieldLabel>현재 상태</FieldLabel>
          <StatusSelectInput value={draft.status} onChange={(v) => onChange({ status: v })} />
        </div>
      </div>

      <div>
        <FieldLabel>일정</FieldLabel>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[12px] text-neutral-500">
            Kick Off
            <SegmentedDateInput className="mt-1" value={draft.kickoffDate} onChange={(v) => onChange({ kickoffDate: v })} />
          </label>
          <label className="text-[12px] text-neutral-500">
            목표 출시
            <SegmentedDateInput className="mt-1" value={draft.targetReleaseDate} onChange={(v) => onChange({ targetReleaseDate: v })} />
          </label>
          <label className="text-[12px] text-neutral-500">
            실제 출시
            <SegmentedDateInput className="mt-1" value={draft.actualReleaseDate} onChange={(v) => onChange({ actualReleaseDate: v })} />
          </label>
        </div>
      </div>

      <div>
        <button type="button" onClick={onToggleExtra} className="text-[13px] text-navy-950/60 hover:text-navy-950">
          {extraOpen ? "▾" : "▸"} 부가 정보 (산출물 · 샘플 확보)
        </button>
        {extraOpen && (
          <div className="mt-2 flex flex-col gap-2 rounded-lg border border-navy-100 p-3">
            <label className="text-[12px] text-neutral-500">
              산출물 링크
              <TextInput className="mt-1" placeholder="https://" value={draft.artifactUrl} onChange={(e) => onChange({ artifactUrl: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12px] text-neutral-500">
                샘플 확보 (PW3)
                <SegmentedDateInput className="mt-1" value={draft.samplePw3Date} onChange={(v) => onChange({ samplePw3Date: v })} />
              </label>
              <label className="text-[12px] text-neutral-500">
                샘플 확보 (PW4)
                <SegmentedDateInput className="mt-1" value={draft.samplePw4Date} onChange={(v) => onChange({ samplePw4Date: v })} />
              </label>
            </div>
          </div>
        )}
      </div>

      {editing && project && (
        <div>
          <FieldLabel>업데이트 로그</FieldLabel>
          <div className="flex flex-col gap-2">
            {project.updateLogs.map((log) => (
              <div key={log.id} className="rounded border border-navy-100 px-2.5 py-2 text-[13px]">
                <div className="mb-0.5 flex items-center gap-2 text-[12px] text-neutral-400">
                  <span>{log.createdAt}</span>
                  <span>{log.authorName}</span>
                </div>
                <div className="text-navy-950">{log.content}</div>
              </div>
            ))}
            <div className="flex gap-2">
              <TextInput placeholder="업데이트 내용을 입력하세요" value={newLogText} onChange={(e) => onNewLogTextChange(e.target.value)} />
              <button type="button" onClick={onAddLog} disabled={pending} className="shrink-0 rounded border border-navy-100 px-3 py-1.5 text-[13px] text-navy-950/70 hover:bg-navy-50">
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="m-0 text-[13px] text-red-600">{error}</p>}
    </DrawerShell>
  );
}

// ── 서브 프로젝트 폼 ────────────────────────────────────────────────────

export interface SubDraft {
  name: string;
  ownerId: string;
  status: ProgressStatus;
  quarterStart: FiscalQuarter;
  quarterEnd: FiscalQuarter;
  sheetUrl: string;
  items: SubProjectItemInput[];
}

function QuarterRangeGrid({ start, end, onPick }: { start: FiscalQuarter; end: FiscalQuarter | null; onPick: (fq: FiscalQuarter) => void }) {
  const [year, setYear] = useState(start.year);
  return (
    <div className="rounded-lg border border-navy-100 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-navy-50" onClick={() => setYear((y) => y - 1)}>‹</button>
        <span className="text-sm font-medium text-navy-950">{year}년</span>
        <button type="button" className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-navy-50" onClick={() => setYear((y) => y + 1)}>›</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([1, 2, 3, 4] as const).map((q) => {
          const cell: FiscalQuarter = { year, q };
          const isStart = start.year === year && start.q === q;
          const isEnd = end && end.year === year && end.q === q;
          const isSelected = isStart || isEnd;
          const isBetween = !isSelected && !!end && compareQuarter(cell, start) >= 0 && compareQuarter(cell, end) <= 0;
          return (
            <button
              key={q}
              type="button"
              onClick={() => onPick(cell)}
              className="rounded-md px-3 py-2 text-[13px]"
              style={
                isSelected
                  ? { border: "1px solid #6d28d9", background: "#6d28d9", color: "#fff" }
                  : isBetween
                    ? { border: "1px solid #ddd6fe", background: "#f5f3ff", color: "#6d28d9" }
                    : { border: "1px solid #e5e5e5", background: "#fff", color: "#101d38" }
              }
            >
              {year} Q{q}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function itemsByQuarterKey(items: SubProjectItemInput[]) {
  const map = new Map<string, SubProjectItemInput[]>();
  for (const it of items) {
    const key = `${it.quarterYear}-${it.quarterNum}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return map;
}

export function SubProjectForm({
  draft,
  editing,
  assigneeOptions,
  pendingRangeAnchor,
  closedGroups,
  draftTexts,
  confirmDelete,
  error,
  pending,
  onChange,
  onPickQuarter,
  onToggleGroup,
  onDraftTextChange,
  onAddItem,
  onUpdateItemText,
  onUpdateItemStatus,
  onRemoveItem,
  onMoveItem,
  onClose,
  onSave,
  onDeleteClick,
  onDeleteConfirm,
}: {
  draft: SubDraft;
  editing: boolean;
  assigneeOptions: ProgressAssigneeOption[];
  pendingRangeAnchor: FiscalQuarter | null;
  closedGroups: Set<string>;
  draftTexts: Record<string, string>;
  confirmDelete: boolean;
  error: string;
  pending: boolean;
  onChange: (patch: Partial<SubDraft>) => void;
  onPickQuarter: (fq: FiscalQuarter) => void;
  onToggleGroup: (key: string) => void;
  onDraftTextChange: (key: string, v: string) => void;
  onAddItem: (year: number, q: number) => void;
  onUpdateItemText: (index: number, text: string) => void;
  onUpdateItemStatus: (index: number, status: ProgressItemStatus) => void;
  onRemoveItem: (index: number) => void;
  /** 세부 목표 드래그 이동 — 같은 분기 안 재정렬뿐 아니라 다른 분기 영역으로
   * 넘기는 이동도 이 한 함수로 처리한다(요청: "분기 영역을 넘나들며 이동").
   * toIndex를 생략하면(분기 영역 자체에 drop, 비어 있는 분기 포함) 그 분기의
   * 맨 끝으로 옮기고, toIndex가 있으면(다른 항목 위에 drop) 그 항목의 분기로
   * 옮기면서 그 위치에 끼워 넣는다. */
  onMoveItem: (fromIndex: number, targetYear: number, targetQ: number, toIndex?: number) => void;
  onClose: () => void;
  onSave: () => void;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
}) {
  const groups = itemsByQuarterKey(draft.items);
  const quarterKeys: { year: number; q: number }[] = [];
  {
    let cur = draft.quarterStart;
    while (compareQuarter(cur, draft.quarterEnd) <= 0) {
      quarterKeys.push({ year: cur.year, q: cur.q });
      cur = addQuarters(cur, 1);
    }
  }
  let dragIndex: number | null = null;

  return (
    <DrawerShell
      width={620}
      onClose={onClose}
      header={
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-navy-950">{editing ? "서브 프로젝트 수정" : "서브 프로젝트 등록"}</div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-navy-950">×</button>
        </div>
      }
      footer={
        <div className="flex items-center gap-2">
          {editing && <DeleteFooterButton confirmDelete={confirmDelete} onFirstClick={onDeleteClick} onConfirm={onDeleteConfirm} />}
          <button type="button" onClick={onClose} className="ml-auto rounded border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70">닫기</button>
          <button type="button" onClick={onSave} disabled={pending} className="rounded bg-navy-900 px-3 py-1.5 text-sm text-white">
            {editing ? "수정 저장" : "등록"}
          </button>
        </div>
      }
    >
      <div>
        <FieldLabel>프로젝트명</FieldLabel>
        <TextInput placeholder="예) 무선충전 발열 측정 지그 표준화" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>담당자</FieldLabel>
          <OwnerSelect value={draft.ownerId} options={assigneeOptions} onChange={(v) => onChange({ ownerId: v })} />
        </div>
        <div>
          <FieldLabel>상태</FieldLabel>
          <StatusSelectInput value={draft.status} onChange={(v) => onChange({ status: v })} />
        </div>
      </div>

      <div>
        <FieldLabel>산출물 URL</FieldLabel>
        <TextInput placeholder="https://" value={draft.sheetUrl} onChange={(e) => onChange({ sheetUrl: e.target.value })} />
      </div>

      <div>
        <FieldLabel>
          대상 분기 —{" "}
          {pendingRangeAnchor ? "종료 분기를 선택하세요" : "시작 분기를 선택하세요"} ({quarterLabel(draft.quarterStart)} – {quarterLabel(draft.quarterEnd)})
        </FieldLabel>
        <QuarterRangeGrid start={draft.quarterStart} end={draft.quarterEnd} onPick={onPickQuarter} />
      </div>

      <div>
        <FieldLabel>세부 목표</FieldLabel>
        <div className="flex flex-col gap-2">
          {quarterKeys.map(({ year, q }) => {
            const key = `${year}-${q}`;
            const groupItems = groups.get(key) ?? [];
            const closed = closedGroups.has(key);
            return (
              <div key={key} className="rounded-lg border border-navy-100">
                <button type="button" onClick={() => onToggleGroup(key)} className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] font-medium text-navy-950">
                  <span>{year} Q{q}</span>
                  <span>{closed ? "▸" : "▾"}</span>
                </button>
                {!closed && (
                  <div
                    className="flex flex-col gap-1 border-t border-navy-100 p-2"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      // 그룹 컨테이너 자체(빈 분기 포함, 또는 항목 사이 여백)에
                      // 놓으면 그 분기 맨 끝으로 옮긴다 — 아래 항목별 onDrop이
                      // stopPropagation으로 먼저 처리하므로, 여기까지 오는 건
                      // "항목이 아닌 빈 영역에 놓은 경우"뿐이다.
                      if (dragIndex !== null) onMoveItem(dragIndex, year, q);
                      dragIndex = null;
                    }}
                  >
                    {draft.items.map((it, idx) =>
                      it.quarterYear === year && it.quarterNum === q ? (
                        <div
                          key={idx}
                          draggable
                          onDragStart={() => { dragIndex = idx; }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.stopPropagation();
                            if (dragIndex !== null && dragIndex !== idx) onMoveItem(dragIndex, year, q, idx);
                            dragIndex = null;
                          }}
                          className="flex items-center gap-2 rounded px-1 py-1 hover:bg-neutral-50"
                        >
                          <span className="cursor-grab text-neutral-300">⠿</span>
                          <input
                            value={it.text}
                            onChange={(e) => onUpdateItemText(idx, e.target.value)}
                            className="flex-1 rounded border border-navy-100 px-2 py-1 text-[13px]"
                          />
                          <select
                            value={it.status}
                            onChange={(e) => onUpdateItemStatus(idx, e.target.value as ProgressItemStatus)}
                            className="rounded border border-navy-100 px-1.5 py-1 text-[12px]"
                          >
                            {(Object.keys(PROGRESS_ITEM_STATUS_LABEL) as ProgressItemStatus[]).map((s) => (
                              <option key={s} value={s}>{PROGRESS_ITEM_STATUS_LABEL[s]}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => onRemoveItem(idx)} className="text-neutral-400 hover:text-red-600">×</button>
                        </div>
                      ) : null,
                    )}
                    <input
                      placeholder="+ 입력 후 Enter로 추가"
                      value={draftTexts[key] ?? ""}
                      onChange={(e) => onDraftTextChange(key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (draftTexts[key] ?? "").trim()) {
                          e.preventDefault();
                          onAddItem(year, q);
                        }
                      }}
                      className="rounded border border-dashed border-neutral-300 px-2 py-1 text-[13px] text-neutral-500"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && <p className="m-0 text-[13px] text-red-600">{error}</p>}
    </DrawerShell>
  );
}

// ── 공통 업무 폼 ────────────────────────────────────────────────────────

export interface CommonDraft {
  name: string;
  ownerId: string;
  repeat: boolean;
  repeatDay: string;
  monthStart: CalendarMonth;
  monthEnd: CalendarMonth;
}

function MonthRangeGrid({ start, end, onPick }: { start: CalendarMonth; end: CalendarMonth | null; onPick: (m: CalendarMonth) => void }) {
  const [year, setYear] = useState(start.year);
  return (
    <div className="rounded-lg border border-navy-100 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-navy-50" onClick={() => setYear((y) => y - 1)}>‹</button>
        <span className="text-sm font-medium text-navy-950">{year}년</span>
        <button type="button" className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-navy-50" onClick={() => setYear((y) => y + 1)}>›</button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
          const cell: CalendarMonth = { year, month };
          const isStart = start.year === year && start.month === month;
          const isEnd = end && end.year === year && end.month === month;
          const isSelected = isStart || isEnd;
          const isBetween = !isSelected && !!end && compareMonth(cell, start) >= 0 && compareMonth(cell, end) <= 0;
          return (
            <button
              key={month}
              type="button"
              onClick={() => onPick(cell)}
              className="rounded-md px-2 py-1.5 text-[12px]"
              style={
                isSelected
                  ? { border: "1px solid #0f766e", background: "#0f766e", color: "#fff" }
                  : isBetween
                    ? { border: "1px solid #99f6e4", background: "#f0fdfa", color: "#0f766e" }
                    : { border: "1px solid #e5e5e5", background: "#fff", color: "#101d38" }
              }
            >
              {month}월
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CommonTaskForm({
  draft,
  editing,
  assigneeOptions,
  pendingRangeAnchor,
  confirmDelete,
  error,
  pending,
  onChange,
  onPickMonth,
  onClose,
  onSave,
  onDeleteClick,
  onDeleteConfirm,
}: {
  draft: CommonDraft;
  editing: boolean;
  assigneeOptions: ProgressAssigneeOption[];
  pendingRangeAnchor: CalendarMonth | null;
  confirmDelete: boolean;
  error: string;
  pending: boolean;
  onChange: (patch: Partial<CommonDraft>) => void;
  onPickMonth: (m: CalendarMonth) => void;
  onClose: () => void;
  onSave: () => void;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  return (
    <DrawerShell
      width={480}
      onClose={onClose}
      header={
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-navy-950">{editing ? "공통 업무 수정" : "공통 업무 등록"}</div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-navy-950">×</button>
        </div>
      }
      footer={
        <div className="flex items-center gap-2">
          {editing && <DeleteFooterButton confirmDelete={confirmDelete} onFirstClick={onDeleteClick} onConfirm={onDeleteConfirm} />}
          <button type="button" onClick={onClose} className="ml-auto rounded border border-navy-100 px-3 py-1.5 text-sm text-navy-950/70">닫기</button>
          <button type="button" onClick={onSave} disabled={pending} className="rounded bg-navy-900 px-3 py-1.5 text-sm text-white">
            {editing ? "수정 저장" : "등록"}
          </button>
        </div>
      }
    >
      <div>
        <FieldLabel>업무명</FieldLabel>
        <TextInput placeholder="예) 보호필름 경도·투과율 측정" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>

      <div>
        <FieldLabel>담당자</FieldLabel>
        <OwnerSelect value={draft.ownerId} options={assigneeOptions} onChange={(v) => onChange({ ownerId: v })} />
      </div>

      <div>
        <FieldLabel>대상 월</FieldLabel>
        <div className="flex items-center gap-2">
          <SegmentedMonthInput
            value={`${draft.monthStart.year}-${String(draft.monthStart.month).padStart(2, "0")}`}
            onChange={(v) => {
              const m = /^(\d{4})-(\d{2})$/.exec(v);
              if (!m) return;
              const start = { year: Number(m[1]), month: Number(m[2]) };
              const end = compareMonth(start, draft.monthEnd) > 0 ? start : draft.monthEnd;
              onChange({ monthStart: start, monthEnd: end });
            }}
          />
          <span className="text-[12px] text-neutral-400">–</span>
          <SegmentedMonthInput
            value={`${draft.monthEnd.year}-${String(draft.monthEnd.month).padStart(2, "0")}`}
            onChange={(v) => {
              const m = /^(\d{4})-(\d{2})$/.exec(v);
              if (!m) return;
              const end = { year: Number(m[1]), month: Number(m[2]) };
              onChange({ monthEnd: compareMonth(end, draft.monthStart) < 0 ? draft.monthStart : end });
            }}
          />
          <button
            type="button"
            title="달력에서 선택"
            onClick={() => setCalendarOpen((v) => !v)}
            className="ml-auto rounded border border-navy-100 px-2 py-1.5 text-[13px] text-neutral-500 hover:bg-navy-50"
          >
            📅
          </button>
        </div>
        {calendarOpen && (
          <div className="mt-2">
            <div className="mb-1 text-[12px] text-neutral-500">
              {pendingRangeAnchor ? "종료 월을 선택하세요" : "시작 월을 선택하세요"} ({monthLabel(draft.monthStart)} – {monthLabel(draft.monthEnd)})
            </div>
            <MonthRangeGrid start={draft.monthStart} end={draft.monthEnd} onPick={onPickMonth} />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-navy-100 px-3 py-2 text-[13px]">
        <input type="checkbox" checked={draft.repeat} onChange={(e) => onChange({ repeat: e.target.checked })} />
        매월 반복 업무로 자동 등록
      </label>
      {draft.repeat && (
        <label className="text-[13px] text-neutral-600">
          매월
          <select value={draft.repeatDay} onChange={(e) => onChange({ repeatDay: e.target.value })} className="ml-2 rounded border border-navy-100 px-2 py-1 text-[13px]">
            {PROGRESS_REPEAT_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>{repeatDayLabel(d)}</option>
            ))}
          </select>
          <div className="mt-1 text-[12px] text-neutral-400">기준일이 지나면 현황판에 강조 표시됩니다</div>
        </label>
      )}

      <p className="m-0 text-[12px] text-neutral-400">대상 월 구간의 각 월에 이 업무가 표시됩니다. 월별 완료 여부는 현황판에서 직접 체크합니다.</p>

      {error && <p className="m-0 text-[13px] text-red-600">{error}</p>}
    </DrawerShell>
  );
}

export type { CommonTaskFormInput, SubProjectFormInput, SubProjectItemInput };
