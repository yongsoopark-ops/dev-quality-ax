"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TaskCategory, TaskStatus } from "@/app/generated/prisma/enums";
import {
  HALF_DAY_PERIOD_LABELS,
  HALF_DAY_PERIOD_OPTIONS,
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_OPTIONS,
  TASK_CATEGORY_TINTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_TINTS,
  getUserInitials,
  getUserTint,
} from "@/lib/schedule/constants";
import type {
  ProjectCategoryOption,
  ScheduleCurrentUser,
  ScheduleUser,
  TaskCommentInfo,
  TaskFormInput,
  TaskScheduleRevisionInfo,
  TaskWithRelations,
} from "@/lib/schedule/types";
import {
  addTaskScheduleRevisionAction,
  createProjectCategoryAction,
  createTaskAction,
  deleteTaskAction,
  deleteTaskScheduleRevisionAction,
  getTaskCommentsAction,
  getTaskDetailAction,
  removeProjectCategoryAction,
  updateTaskAction,
  updateTaskScheduleRevisionAction,
} from "./actions";
import { DateTextInput } from "./DateTextInput";
import { TimeSelect } from "./TimeSelect";

/** 전역 성능 Step(JS Bundle 축소) — UpdateModal은 Tiptap(RichTextEditor)을 정적
 * import하는데, 이 Modal은 "업데이트" 버튼을 눌러야만 실제로 열린다. 여기서
 * 정적 import 대신 next/dynamic으로 불러오면 Tiptap 번들이 /schedule 최초
 * 로드에 포함되지 않고 Modal을 여는 시점에만 별도 chunk로 내려온다. 기능/동작은
 * 완전히 동일하다 — 코드 분할 방식만 바뀐다. */
const UpdateModal = dynamic(() => import("./UpdateModal").then((m) => m.UpdateModal), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="rounded-xl bg-white px-6 py-4 text-sm text-navy-950/60 shadow-lg">불러오는 중...</div>
    </div>
  ),
});

/** ISO(UTC) 문자열을 로컬 "YYYY-MM-DD"/"HH:mm"로 각각 나눈다 — 미팅 날짜/시작
 * 시간 두 입력으로 쪼갠 것뿐, 저장 시(actions.ts) 다시 하나로 합친다. */
function toLocalDateString(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeString(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "일정 변경 이력"에 쓰는 "2026.08.27 10:30" 형태 표시용(저장 형식과는 무관). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildInitialInput(task: TaskWithRelations | null, defaults?: { startDate?: string; dueDate?: string }): TaskFormInput {
  if (!task) {
    return {
      title: "",
      category: TaskCategory.COMMON,
      startDate: defaults?.startDate ?? "",
      dueDate: defaults?.dueDate ?? defaults?.startDate ?? "",
      status: TaskStatus.TODO,
      memo: "",
      goalName: "",
      halfDayPeriod: "",
      projectName: "",
      categoryId: "",
      department: "",
      attendeeIds: [],
      meetingDate: defaults?.startDate ?? "",
      meetingStartTime: "",
      location: "",
    };
  }
  return {
    title: task.title,
    category: task.category,
    // 기본 시작일/마감일은 항상 "최초 일정"(Task 원본)을 보여준다 — 공식 일정
    // 변경(+ 일정 변경)이 있으면 아래 이력이 실제 유효 일정을 대신하고, 이 값은
    // 그대로 읽기 전용 이력 앵커로만 남는다.
    startDate: task.originalStartDate.slice(0, 10),
    dueDate: task.originalDueDate.slice(0, 10),
    status: task.status,
    memo: task.memo ?? "",
    goalName: task.goalName ?? "",
    halfDayPeriod: task.halfDayPeriod ?? "",
    projectName: task.projectDetail?.projectName ?? "",
    categoryId: task.projectDetail?.categoryId ?? "",
    department: task.meetingDetail?.department ?? "",
    attendeeIds: task.meetingDetail?.attendeeIds ?? [],
    meetingDate: toLocalDateString(task.meetingDetail?.time ?? null) || task.dueDate.slice(0, 10),
    meetingStartTime: toLocalTimeString(task.meetingDetail?.time ?? null),
    location: task.meetingDetail?.location ?? "",
  };
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

const inputClass = "w-full rounded-md border border-navy-100 px-3 py-1.5 text-sm";
const labelClass = "text-xs font-medium text-navy-950/60";

function canModify(currentUser: ScheduleCurrentUser, authorId: string): boolean {
  return currentUser.id === authorId || currentUser.role === "ADMIN";
}

/**
 * Monday.com류의 "좌측 Label / 우측 Input" 밀도를 참고한 공용 Row(요청사항
 * 12~13) — Field 순서/business logic은 그대로 두고 배치만 통일한다. 좌측
 * Label 너비를 고정해 Row가 늘어나도 항상 정렬이 맞는다.
 */
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-start gap-3">
      <label className={`${labelClass} pt-1.5`}>{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** 업무 구분 select — native select를 그대로 쓰되(요청사항 14: dropdown 유지,
 * DB enum/값 변경 금지) 선택된 Category의 저채도 색을 select 자체에 입혀
 * "작은 color icon + 한국어 이름"처럼 보이게 한다(왼쪽 점 + 색 텍스트). */
function CategorySelect({
  value,
  onChange,
}: {
  value: TaskFormInput["category"];
  onChange: (value: TaskFormInput["category"]) => void;
}) {
  const tint = TASK_CATEGORY_TINTS[value];
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
        style={{ backgroundColor: tint.border }}
      />
      <select
        className={`${inputClass} pl-6 font-medium`}
        style={{ backgroundColor: tint.bg, color: tint.text, borderColor: tint.border }}
        value={value}
        onChange={(e) => onChange(e.target.value as TaskFormInput["category"])}
      >
        {TASK_CATEGORY_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {TASK_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 상태 입력 — 일반 Select 대신 카드형 segmented 선택(요청사항 15). 값 자체는
 * 기존 TaskStatus 그대로이고, 저채도 색만 입힌다. */
function StatusSegmented({
  value,
  onChange,
}: {
  value: TaskFormInput["status"];
  onChange: (value: TaskFormInput["status"]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TASK_STATUS_OPTIONS.map((s) => {
        const tint = TASK_STATUS_TINTS[s];
        const selected = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className="rounded-md border px-3 py-1.5 text-xs font-medium"
            style={{
              backgroundColor: tint.bg,
              color: tint.text,
              borderColor: selected ? tint.border : "transparent",
              boxShadow: selected ? `inset 0 0 0 1px ${tint.border}` : undefined,
              opacity: selected ? 1 : 0.6,
            }}
          >
            {TASK_STATUS_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

/** 담당자는 현재 정책대로 Session User 자동 지정이라 여기서는 항상 읽기
 * 전용으로만 보여준다(요청사항 13) — 재지정 UI를 새로 만들지 않는다. */
function AssigneeReadOnlyRow({ assignees, allUsers }: { assignees: ScheduleUser[]; allUsers: ScheduleUser[] }) {
  if (assignees.length === 0) {
    return <p className="pt-1.5 text-xs text-navy-950/40">담당자 없음</p>;
  }
  return (
    <div className="flex flex-wrap gap-2 pt-0.5">
      {assignees.map((u) => {
        const globalIndex = allUsers.findIndex((au) => au.id === u.id);
        const tint = getUserTint(Math.max(globalIndex, 0));
        return (
          <span key={u.id} className="flex items-center gap-1.5 rounded-full border border-navy-100 py-0.5 pl-0.5 pr-2.5 text-xs">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-full text-[10px] font-semibold"
              style={{ backgroundColor: tint.avatarBg, color: tint.avatarText }}
            >
              {getUserInitials(u.name, u.email)}
            </span>
            <span className="text-navy-950/80">{u.name ?? u.email}</span>
          </span>
        );
      })}
    </div>
  );
}

function ProjectCategoryPicker({
  categoryId,
  onChange,
  categories,
  onCategoriesChange,
}: {
  categoryId: string;
  onChange: (id: string) => void;
  categories: ProjectCategoryOption[];
  onCategoriesChange: (categories: ProjectCategoryOption[]) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const activeCategories = categories.filter((c) => c.active);

  async function handleAdd() {
    if (!newName.trim()) return;
    setBusy(true);
    setLocalError(null);
    const res = await createProjectCategoryAction(newName.trim());
    setBusy(false);
    if (res.error || !res.category) {
      setLocalError(res.error ?? "카테고리를 추가하지 못했습니다.");
      return;
    }
    const next = categories.some((c) => c.id === res.category!.id)
      ? categories.map((c) => (c.id === res.category!.id ? res.category! : c))
      : [...categories, res.category];
    onCategoriesChange(next);
    onChange(res.category.id);
    setNewName("");
  }

  async function handleRemove(id: string) {
    setBusy(true);
    setLocalError(null);
    const res = await removeProjectCategoryAction(id);
    setBusy(false);
    if (res.error) {
      setLocalError(res.error);
      return;
    }
    if (res.deactivated) {
      onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, active: false } : c)));
      if (categoryId === id) onChange("");
    } else {
      onCategoriesChange(categories.filter((c) => c.id !== id));
      if (categoryId === id) onChange("");
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className={labelClass}>프로젝트 카테고리</label>
        <button type="button" onClick={() => setManaging((v) => !v)} className="text-xs text-navy-950/50 hover:text-navy-950">
          카테고리 관리
        </button>
      </div>
      <select className={inputClass} value={categoryId} onChange={(e) => onChange(e.target.value)}>
        <option value="">선택 안 함</option>
        {activeCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {managing && (
        <div className="mt-2 space-y-2 rounded-md border border-navy-100 p-2">
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="새 카테고리명"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={busy || !newName.trim()}
              className="shrink-0 rounded-md bg-navy-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              추가
            </button>
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-xs">
                <span className={c.active ? "text-navy-950" : "text-navy-950/40 line-through"}>
                  {c.name} {!c.active && "(비활성)"}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(c.id)}
                  disabled={busy}
                  className="text-red-600 hover:underline disabled:opacity-50"
                >
                  삭제
                </button>
              </li>
            ))}
            {categories.length === 0 && <li className="text-navy-950/40">등록된 카테고리가 없습니다.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RevisionDraft {
  startDate: string;
  dueDate: string;
  reasonText: string;
}

/** 저장 완료된 Revision 1건 — 평소엔 읽기 전용 표시, "수정" 클릭 시 이 블록
 * 안에서만 편집 상태로 바뀐다("+ 일정 변경" Draft와는 별개의 흐름). Compact한
 * bordered block 형태를 유지한다(요청사항 19: 너무 큰 영역을 차지하지 않도록). */
function SavedRevisionBlock({
  revision,
  displayNo,
  isLatest,
  currentUser,
  onUpdated,
  onDeleted,
}: {
  revision: TaskScheduleRevisionInfo;
  displayNo: number;
  isLatest: boolean;
  currentUser: ScheduleCurrentUser;
  onUpdated: (updated: TaskScheduleRevisionInfo) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RevisionDraft>({
    startDate: revision.startDate.slice(0, 10),
    dueDate: revision.dueDate.slice(0, 10),
    reasonText: revision.reasonText ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = canModify(currentUser, revision.createdBy);

  function startEdit() {
    setDraft({
      startDate: revision.startDate.slice(0, 10),
      dueDate: revision.dueDate.slice(0, 10),
      reasonText: revision.reasonText ?? "",
    });
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await updateTaskScheduleRevisionAction(revision.id, draft.startDate, draft.dueDate, draft.reasonText);
      if (res.error || !res.revision) {
        setError(res.error ?? "수정하지 못했습니다.");
        return;
      }
      onUpdated(res.revision);
      setEditing(false);
    } catch {
      setError("수정하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`${displayNo}차 변경을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteTaskScheduleRevisionAction(revision.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      onDeleted(revision.id);
    } catch {
      setError("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-2.5">
        <p className="text-xs font-medium text-navy-950">
          {displayNo}차 변경 수정{isLatest && <span className="ml-1 text-blue-600">(최신)</span>}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className={labelClass}>변경 시작일</label>
            <DateTextInput
              className={inputClass}
              value={draft.startDate}
              onChange={(v) => setDraft((p) => ({ ...p, startDate: v }))}
              required
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>변경 마감일</label>
            <DateTextInput
              className={inputClass}
              value={draft.dueDate}
              onChange={(v) => setDraft((p) => ({ ...p, dueDate: v }))}
              required
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>변경 사유</label>
          <textarea
            className={inputClass}
            rows={2}
            value={draft.reasonText}
            onChange={(e) => setDraft((p) => ({ ...p, reasonText: e.target.value }))}
            required
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-navy-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "수정 저장"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="rounded-md border border-navy-100 px-3 py-1 text-xs text-navy-950/70 disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 rounded-md border border-navy-100 bg-navy-50/60 p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-navy-950">
          {displayNo}차 변경
          {isLatest && (
            <span className="ml-1.5 rounded bg-navy-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">최신</span>
          )}
        </p>
        {editable && (
          <div className="flex items-center gap-2 text-[11px]">
            <button type="button" onClick={startEdit} className="text-navy-950/50 hover:text-navy-950">
              수정
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="text-red-600 hover:underline disabled:opacity-50">
              {deleting ? "삭제 중..." : "삭제"}
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-navy-950/70">
        {revision.startDate.slice(0, 10)} ~ {revision.dueDate.slice(0, 10)}
      </p>
      {revision.reasonText && <p className="text-xs text-navy-950/70">사유: {revision.reasonText}</p>}
      <p className="text-[11px] text-navy-950/40">
        {revision.createdByName ?? "알 수 없음"} · {formatDateTime(revision.createdAt)}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** "+ 일정 변경" 클릭으로 만들어지는, 아직 저장되지 않은 초안 블록. "변경 적용"을
 * 눌러야만 실제 Revision이 생긴다 — 그 전까지는 DB에 아무 흔적도 남기지 않는다. */
function DraftRevisionBlock({
  displayNo,
  draft,
  onChange,
  onApply,
  onCancel,
}: {
  displayNo: number;
  draft: RevisionDraft;
  onChange: (draft: RevisionDraft) => void;
  onApply: () => Promise<string | null | undefined>;
  onCancel: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    if (!draft.startDate || !draft.dueDate) {
      setError("변경 시작일/마감일을 입력해 주세요.");
      return;
    }
    if (!draft.reasonText.trim()) {
      setError("변경 사유를 입력해 주세요.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const err = await onApply();
      if (err) setError(err);
    } catch {
      // Server Action이 결과값 대신 예외로 실패하는 경우(세션 만료 등)도 버튼이
      // "적용 중..."에 멈춰있지 않고 반드시 오류를 보여준다.
      setError("일정 변경을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-navy-300 bg-navy-50/80 p-2.5">
      <p className="text-xs font-medium text-navy-950">{displayNo}차 변경 (초안)</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={labelClass}>변경 시작일</label>
          <DateTextInput className={inputClass} value={draft.startDate} onChange={(v) => onChange({ ...draft, startDate: v })} required />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>변경 마감일</label>
          <DateTextInput className={inputClass} value={draft.dueDate} onChange={(v) => onChange({ ...draft, dueDate: v })} required />
        </div>
      </div>
      <div className="space-y-1">
        <label className={labelClass}>변경 사유</label>
        <textarea
          className={inputClass}
          rows={2}
          placeholder="일정 변경 사유(협의 내용 등)를 입력하세요"
          value={draft.reasonText}
          onChange={(e) => onChange({ ...draft, reasonText: e.target.value })}
          required
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          className="rounded-md bg-navy-900 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {applying ? "적용 중..." : "변경 적용"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          className="rounded-md border border-navy-100 px-3 py-1 text-xs text-navy-950/70 disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}

export function TaskDetailPanel({
  mode,
  task,
  users,
  projectCategories,
  currentUser,
  onClose,
  defaultStartDate,
  defaultDueDate,
  initialShowUpdateModal,
  initialFocusCommentId,
}: {
  mode: "create" | "edit";
  task: TaskWithRelations | null;
  users: ScheduleUser[];
  projectCategories: ProjectCategoryOption[];
  currentUser: ScheduleCurrentUser;
  onClose: () => void;
  defaultStartDate?: string;
  defaultDueDate?: string;
  /** Notification Deep Link(요청사항 9)로 열렸을 때 Update Modal을 자동으로 연다. */
  initialShowUpdateModal?: boolean;
  /** Deep Link로 들어온 focus 대상 Comment/Reply id — UpdateModal로 그대로 전달한다. */
  initialFocusCommentId?: string;
}) {
  const [input, setInput] = useState<TaskFormInput>(() =>
    buildInitialInput(task, { startDate: defaultStartDate, dueDate: defaultDueDate }),
  );
  const [categories, setCategories] = useState<ProjectCategoryOption[]>(projectCategories);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 성능 개선: page.tsx는 더 이상 scheduleRevisions/조건부 상세(memo/halfDayPeriod/
  // meetingDetail/projectDetail.categoryId)/최초 일정을 eager load하지 않는다 —
  // Task Modal이 열릴 때(edit 모드) getTaskDetailAction으로 이 Task 1건만 따로
  // 조회해 input/savedRevisions에 병합한다. 그 전까지 보이는 값(최초 일정=유효
  // 일정 임시값, savedRevisions=[] 등)은 안전한 임시값이고, 실제 저장(저장 버튼)은
  // detailStatus가 "ready"가 아닌 동안 막아 뒤늦게 도착한 진짜 값을 덮어쓰기
  // 전에 저장되는 것을 원천 차단한다(요청사항: 회귀 없이 Lazy Load). 조회
  // 자체가 실패(세션 만료 등)했을 때도 "ready"로 착각해 저장 버튼이 풀리면
  // 안 되므로 loading/ready와 별개로 error 상태를 명시적으로 구분한다 — 성공
  // 콜백에서만 "ready"가 된다.
  const [detailStatus, setDetailStatus] = useState<"loading" | "ready" | "error">(mode === "edit" ? "loading" : "ready");

  // 저장 완료된 공식 일정 변경 이력. "+ 일정 변경"으로 만든 Draft(아직 미저장)와는
  // 분리된 별개 상태다 — Draft는 "변경 적용"을 눌러야만 여기로 옮겨온다.
  const [savedRevisions, setSavedRevisions] = useState<TaskScheduleRevisionInfo[]>(task?.scheduleRevisions ?? []);
  const [draftRevision, setDraftRevision] = useState<RevisionDraft | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !task) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getTaskDetailAction(task.id);
        if (cancelled) return;
        if (res.detail) {
          const d = res.detail;
          setInput((prev) => ({
            ...prev,
            startDate: d.originalStartDate.slice(0, 10),
            dueDate: d.originalDueDate.slice(0, 10),
            memo: d.memo ?? "",
            halfDayPeriod: d.halfDayPeriod ?? "",
            categoryId: d.projectDetail?.categoryId ?? "",
            department: d.meetingDetail?.department ?? "",
            attendeeIds: d.meetingDetail?.attendeeIds ?? [],
            meetingDate: toLocalDateString(d.meetingDetail?.time ?? null) || prev.meetingDate,
            meetingStartTime: toLocalTimeString(d.meetingDetail?.time ?? null),
            location: d.meetingDetail?.location ?? "",
          }));
          setSavedRevisions(d.scheduleRevisions);
          setDetailStatus("ready");
        } else {
          setError(res.error ?? "업무 상세 정보를 불러오지 못했습니다.");
          setDetailStatus("error");
        }
      } catch {
        if (cancelled) return;
        setError("업무 상세 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setDetailStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update/Reply는 Task 상세와 분리된 UpdateModal에서 전부 처리한다 — 여기서는
  // "💬 업데이트 N" 카운트를 위해 목록만 들고 있는다. 성능 개선: page.tsx가 더
  // 이상 Comment/Reply 본문을 eager load하지 않으므로, Update Modal을 실제로
  // 열기 전까지는 빈 배열이고 배지 숫자는 task.commentCount(가벼운 _count)를
  // 대신 쓴다 — Update Modal을 한 번이라도 열어 목록을 실제로 받으면 그 이후는
  // comments 기준으로 계산한다(수정/삭제 즉시 반영을 그대로 유지하기 위함).
  const [comments, setComments] = useState<TaskCommentInfo[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(initialShowUpdateModal ?? false);
  const commentTotalCount = commentsLoaded
    ? comments.reduce((sum, c) => sum + 1 + c.replies.length, 0)
    : (task?.commentCount ?? 0);

  useEffect(() => {
    if (!showUpdateModal || commentsLoaded || commentsLoading || !task) return;
    let cancelled = false;
    (async () => {
      setCommentsLoading(true);
      setCommentsError(null);
      try {
        const res = await getTaskCommentsAction(task.id);
        if (cancelled) return;
        if (res.comments) {
          setComments(res.comments);
          setCommentsLoaded(true);
        } else {
          setCommentsError(res.error ?? "업데이트를 불러오지 못했습니다.");
        }
      } catch {
        if (!cancelled) setCommentsError("업데이트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUpdateModal]);

  function set<K extends keyof TaskFormInput>(key: K, value: TaskFormInput[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  function startDraftRevision() {
    setDraftRevision({
      // "현재 유효 일정"(input이 아니라 task의 effective 값)을 그대로 복사해
      // 시작한다 — 빈 값에서 매번 다시 타이핑하지 않도록. 사유는 필수라 빈 채로 둔다.
      startDate: (task ? task.startDate : input.startDate).slice(0, 10),
      dueDate: (task ? task.dueDate : input.dueDate).slice(0, 10),
      reasonText: "",
    });
  }

  async function handleApplyRevision(): Promise<string | null> {
    if (!task || !draftRevision) return null;
    const res = await addTaskScheduleRevisionAction(
      task.id,
      draftRevision.startDate,
      draftRevision.dueDate,
      draftRevision.reasonText,
    );
    if (res.error || !res.revision) {
      return res.error ?? "일정 변경을 적용하지 못했습니다.";
    }
    setSavedRevisions((prev) => [...prev, res.revision!]);
    setDraftRevision(null);
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = mode === "create" ? await createTaskAction(input) : await updateTaskAction(task!.id, input);
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
    } catch {
      // Server Action이 결과값 대신 예외로 실패하는 경우(세션 만료 등)도 저장
      // 버튼이 "저장 중..."에 영원히 멈춰있지 않도록 반드시 처리한다.
      setError("저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    try {
      const res = await deleteTaskAction(task.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
    } catch {
      setError("삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  const isMeeting = input.category === TaskCategory.MEETING;
  // MEETING은 일반 시작일/마감일 UI 자체가 없어 애초에 제외, HALF_DAY는 하루짜리
  // 일정 특성상 공식 Revision 관리 대상에서 제외한다(요청사항 26 — 기존 저장된
  // HALF_DAY Revision이 있었다면 그대로 두고 이 Step에서 새로 만들지만 못하게
  // 막는 것인데, 실제 확인 결과 HALF_DAY Revision은 존재하지 않는다).
  const isRevisionEligible = !isMeeting && input.category !== TaskCategory.HALF_DAY;

  // 담당자는 항상 읽기 전용 표시다(요청사항 13) — edit는 실제 TaskAssignee를,
  // create는 "저장하면 자동 지정될 사람"(Session User 본인)을 미리 보여준다.
  const assignees =
    mode === "edit" && task
      ? users.filter((u) => task.assigneeIds.includes(u.id))
      : users.filter((u) => u.id === currentUser.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // onMouseDown으로 즉시 닫으면, 같은 클릭의 mouseup/click이 이미 사라진
        // Backdrop을 그대로 통과해 뒤에 있던 Calendar 날짜/일정에 그대로 꽂혀
        // "닫히자마자 새 Modal이 다시 열리는" 통과 클릭 버그가 생긴다. onClick은
        // mousedown~mouseup 내내 이 Backdrop이 실제 클릭 대상으로 남아 있을 때만
        // 발생해 그 통과를 원천 차단한다 — 입력값은 저장하지 않고 닫기만 한다.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-xl border border-navy-100 bg-white text-sm shadow-lg"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-navy-100 px-5 py-3">
          <p className="font-semibold text-navy-950">{mode === "create" ? "새 일정 등록" : "업무 수정"}</p>
          <div className="flex items-center gap-3">
            {mode === "edit" && task && (
              <button
                type="button"
                onClick={() => setShowUpdateModal(true)}
                className="flex items-center gap-1 rounded-full border border-navy-100 px-2.5 py-1 text-xs font-medium text-navy-950/70 hover:bg-navy-50"
              >
                <span aria-hidden>💬</span> 업데이트 {commentTotalCount}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="닫기" className="text-navy-950/40 hover:text-navy-950">
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <FormRow label="업무 구분">
            <CategorySelect value={input.category} onChange={(v) => set("category", v)} />
          </FormRow>

          <FormRow label="업무명">
            <input className={inputClass} value={input.title} onChange={(e) => set("title", e.target.value)} required />
          </FormRow>

          <FormRow label="상태">
            <StatusSegmented value={input.status} onChange={(v) => set("status", v)} />
          </FormRow>

          <FormRow label="담당자">
            <AssigneeReadOnlyRow assignees={assignees} allUsers={users} />
          </FormRow>

          {input.category === TaskCategory.PROJECT && (
            <div className="space-y-3 rounded-md border border-navy-100 bg-navy-50/60 p-3">
              <div className="space-y-1">
                <label className={labelClass}>프로젝트명</label>
                <input
                  className={inputClass}
                  value={input.projectName}
                  onChange={(e) => set("projectName", e.target.value)}
                  required
                />
              </div>
              <ProjectCategoryPicker
                categoryId={input.categoryId}
                onChange={(id) => set("categoryId", id)}
                categories={categories}
                onCategoriesChange={setCategories}
              />
            </div>
          )}

          {input.category === TaskCategory.PERSONAL_GOAL && (
            <div className="space-y-1 rounded-md border border-navy-100 bg-navy-50/60 p-3">
              <label className={labelClass}>목표명</label>
              <input className={inputClass} value={input.goalName} onChange={(e) => set("goalName", e.target.value)} required />
            </div>
          )}

          {isMeeting && (
            <div className="space-y-3 rounded-md border border-navy-100 bg-navy-50/60 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={labelClass}>미팅 날짜</label>
                  <DateTextInput className={inputClass} value={input.meetingDate} onChange={(v) => set("meetingDate", v)} required />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>시작 시간</label>
                  <TimeSelect className={inputClass} value={input.meetingStartTime} onChange={(v) => set("meetingStartTime", v)} />
                </div>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>참석 부서</label>
                <input className={inputClass} value={input.department} onChange={(e) => set("department", e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>참석자</label>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-navy-100 bg-white p-2">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={input.attendeeIds.includes(u.id)}
                        onChange={() => set("attendeeIds", toggleId(input.attendeeIds, u.id))}
                      />
                      {u.name ?? u.email}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>장소</label>
                <input className={inputClass} value={input.location} onChange={(e) => set("location", e.target.value)} />
              </div>
            </div>
          )}

          {input.category === TaskCategory.HALF_DAY && (
            <FormRow label="오전/오후">
              <div className="flex gap-1.5">
                {HALF_DAY_PERIOD_OPTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => set("halfDayPeriod", p)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                      input.halfDayPeriod === p
                        ? "border-navy-900 bg-navy-900 text-white"
                        : "border-navy-100 text-navy-950/60 hover:bg-navy-50"
                    }`}
                  >
                    {HALF_DAY_PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </FormRow>
          )}

          {!isMeeting && (
            <FormRow label="일정">
              <div className="flex items-center gap-2">
                <DateTextInput
                  className={inputClass}
                  value={input.startDate}
                  onChange={(v) => set("startDate", v)}
                  disabled={savedRevisions.length > 0}
                  required
                />
                <span className="shrink-0 text-navy-950/30">→</span>
                <DateTextInput
                  className={inputClass}
                  value={input.dueDate}
                  onChange={(v) => set("dueDate", v)}
                  disabled={savedRevisions.length > 0}
                  required
                />
              </div>
              {savedRevisions.length > 0 && (
                <p className="mt-1 text-[11px] text-navy-950/40">
                  최초 일정입니다(수정 불가) — 실제 유효 일정은 아래 일정 변경 이력의 최신 항목을 따릅니다.
                </p>
              )}

              {isRevisionEligible && mode === "edit" && (
                <div className="mt-2">
                  {draftRevision ? (
                    <DraftRevisionBlock
                      // 표시용 미리보기일 뿐이다(요청사항 15) — 실제 revisionNo는
                      // "변경 적용" 시 서버가 Task.lastRevisionNo 기준으로 다시 확정한다.
                      displayNo={Math.max(0, ...savedRevisions.map((r) => r.revisionNo)) + 1}
                      draft={draftRevision}
                      onChange={setDraftRevision}
                      onApply={handleApplyRevision}
                      onCancel={() => setDraftRevision(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={startDraftRevision}
                      className="rounded-md border border-navy-100 px-3 py-1.5 text-xs text-navy-950/70 hover:bg-navy-50"
                    >
                      + 일정 변경
                    </button>
                  )}
                </div>
              )}
            </FormRow>
          )}

          {/* Task.memo(단순 textarea)는 Comment/Update 시스템으로 대체됐다. 실사용
              Legacy 값이 있으면 지우거나 새 시스템으로 옮기지 않고 읽기 전용으로만
              계속 보여준다 — 새 내용은 전부 TaskComment에 쌓인다. */}
          {input.memo && (
            <FormRow label="기존 메모">
              <p className="whitespace-pre-wrap rounded-md border border-navy-100 bg-navy-50/60 p-2.5 text-sm text-navy-950/80">
                {input.memo}
              </p>
            </FormRow>
          )}

          {mode === "edit" && isRevisionEligible && (
            <FormRow label="변경 이력">
              <div className="space-y-2 rounded-md border border-navy-100 p-2.5">
                <div className="text-xs">
                  <p className="font-medium text-navy-950">최초 일정</p>
                  <p className="text-navy-950/70">
                    {input.startDate} ~ {input.dueDate}
                  </p>
                </div>
                {savedRevisions.map((rev, i) => (
                  // displayNo는 배열 순서(i+1)가 아니라 실제 revisionNo를 그대로
                  // 쓴다 — 중간 차수를 삭제해도 "1차, 3차"처럼 실제 번호가 유지돼야
                  // 하고 "1차, 2차"로 당겨 재번호하면 안 된다(요청사항 24).
                  <SavedRevisionBlock
                    key={rev.id}
                    revision={rev}
                    displayNo={rev.revisionNo}
                    isLatest={i === savedRevisions.length - 1}
                    currentUser={currentUser}
                    onUpdated={(updated) => setSavedRevisions((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
                    onDeleted={(id) => setSavedRevisions((prev) => prev.filter((r) => r.id !== id))}
                  />
                ))}
              </div>
            </FormRow>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-navy-100 px-5 py-3">
          {mode === "edit" ? (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-navy-100 px-3.5 py-1.5 text-xs font-medium text-navy-950/70 hover:bg-navy-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  // detailStatus가 "ready"가 아닌 동안은 originalStartDate/DueDate·
                  // categoryId·meetingDetail·savedRevisions가 아직 임시값이거나(로딩
                  // 중) 애초에 못 받아온 상태(조회 실패)다 — 두 경우 모두 지금
                  // 저장하면 뒤늦게 도착할(또는 영영 못 받은) 진짜 값을 임시값으로
                  // 덮어써 버릴 수 있어 저장을 막는다(요청사항: Lazy Load 회귀 방지).
                  disabled={saving || detailStatus !== "ready"}
                  title={detailStatus === "loading" ? "상세 정보를 불러오는 중입니다" : undefined}
                  className="rounded-md bg-navy-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {saving ? "저장 중..." : detailStatus === "loading" ? "불러오는 중..." : "저장"}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-navy-100 px-3.5 py-1.5 text-xs font-medium text-navy-950/70 hover:bg-navy-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-navy-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? "등록 중..." : "일정 등록"}
              </button>
            </>
          )}
        </div>
      </form>

      {mode === "edit" && task && showUpdateModal && (
        <UpdateModal
          taskTitle={input.title}
          comments={comments}
          onCommentsChange={setComments}
          taskId={task.id}
          currentUser={currentUser}
          users={users}
          focusCommentId={initialFocusCommentId}
          loading={commentsLoading}
          loadError={commentsError}
          onClose={() => setShowUpdateModal(false)}
        />
      )}
    </div>
  );
}
