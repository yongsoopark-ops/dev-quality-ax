"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePrefetchOnIntent } from "@/hooks/usePrefetchOnIntent";
import {
  HALF_DAY_PERIOD_LABELS,
  HALF_DAY_PERIOD_OPTIONS,
  TASK_CATEGORY_KEY as TaskCategory,
  TASK_STATUS_KEY as TaskStatus,
  getUserInitials,
  getUserTint,
  tintFromColor,
} from "@/lib/schedule/constants";
import { computeMeetingOccurrenceStatus } from "@/lib/schedule/meetingStatus";
import { computeFirstOccurrenceOnOrAfter, type RecurrenceRule } from "@/lib/schedule/recurrence";
import type {
  AssigneeMode,
  ProjectCategoryGroupOption,
  ProjectCategoryOption,
  ScheduleCurrentUser,
  ScheduleOptionInfo,
  ScheduleUser,
  TaskCommentInfo,
  TaskFormInput,
  TaskScheduleRevisionInfo,
  TaskWithRelations,
} from "@/lib/schedule/types";
import {
  addTaskScheduleRevisionAction,
  createTaskAction,
  deleteTaskAction,
  deleteTaskScheduleRevisionAction,
  getTaskCommentsAction,
  getTaskDetailAction,
  updateTaskAction,
  updateTaskScheduleRevisionAction,
} from "./actions";
import { DateTextInput } from "./DateTextInput";
import { ProjectCategorySelect } from "./ProjectCategorySelect";
import { RecurrenceFields } from "./RecurrenceFields";
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

/** Date 객체(연/월/일만 쓴다) → "YYYY-MM-DD" — toLocalDateString(ISO 문자열용)과
 * 같은 로컬 규칙이지만 입력이 이미 Date인 경우(반복 미팅 anchor 자동 계산 결과)
 * 를 위한 버전이다. */
function dateToLocalDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "일정 변경 이력"에 쓰는 "2026.08.27 10:30" 형태 표시용(저장 형식과는 무관). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildInitialInput(
  task: TaskWithRelations | null,
  currentUserId: string,
  defaults?: { startDate?: string; dueDate?: string },
): TaskFormInput {
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
      meetingEndTime: "",
      location: "",
      // Step(담당자 UX 개선, 요청사항 2) — 신규 등록은 항상 "내 일정"이 기본값,
      // 로그인 사용자를 자동 담당으로 미리 채운다.
      assigneeMode: "ME",
      assigneeIds: [currentUserId],
      recurrenceType: "NONE",
      recurrenceInterval: "1",
      recurrenceWeekdays: [],
      recurrenceMonthlyRuleType: "DAY_OF_MONTH",
      recurrenceMonthDay: "",
      recurrenceMonthlyWeekOrdinal: "",
      recurrenceMonthlyWeekday: "MON",
      recurrenceEndType: "NONE",
      recurrenceEndDate: "",
      recurrenceCount: "",
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
    meetingEndTime: toLocalTimeString(task.meetingDetail?.endTime ?? null),
    location: task.meetingDetail?.location ?? "",
    // Step(담당자 UX 개선, 요청사항 4) — 기존 Task는 저장된 담당자 정보를
    // 그대로 복원한다. "내 일정"으로 자동 덮어쓰지 않는다 — isCommonAssignee가
    // true면 무조건 "공통"(담당자가 우연히 나 자신 1명이어도 "직접 지정"으로
    // 표시해 저장된 의미를 그대로 보존한다).
    assigneeMode: task.isCommonAssignee ? "COMMON" : "CUSTOM",
    assigneeIds: task.assigneeIds,
    recurrenceType: task.recurrence.type,
    recurrenceInterval: String(task.recurrence.interval || 1),
    recurrenceWeekdays: task.recurrence.weekdays,
    recurrenceMonthlyRuleType: task.recurrence.monthlyRuleType ?? "DAY_OF_MONTH",
    recurrenceMonthDay: task.recurrence.monthDay != null ? String(task.recurrence.monthDay) : "",
    recurrenceMonthlyWeekOrdinal: task.recurrence.monthlyWeekOrdinal != null ? String(task.recurrence.monthlyWeekOrdinal) : "",
    recurrenceMonthlyWeekday: task.recurrence.monthlyWeekday ?? "MON",
    recurrenceEndType: task.recurrence.count != null ? "COUNT" : task.recurrence.endDate ? "DATE" : "NONE",
    recurrenceEndDate: task.recurrence.endDate ? task.recurrence.endDate.slice(0, 10) : "",
    recurrenceCount: task.recurrence.count != null ? String(task.recurrence.count) : "",
  };
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

const inputClass = "w-full rounded-md border border-navy-100 px-3 py-1.5 text-sm";
const labelClass = "text-xs font-medium text-navy-950/60";

/** Step 5B-7(미팅 상태 입력 UX) — 이 3개는 MEETING에서 사용자가 직접 고르지
 * 않는다(시간으로 자동 결정). 보류 등 나머지 옵션은 계속 클릭 가능하다. */
const AUTO_MANAGED_MEETING_STATUS_IDS = new Set<string>([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE]);

/** Step 5B-7(반복 미팅 anchor 자동 계산) — 이 필드들이 바뀌면 "반복 규칙을
 * 실제로 건드렸다"고 간주한다(recurrenceTouched). */
const RECURRENCE_FIELD_KEYS = new Set<keyof TaskFormInput>([
  "recurrenceType",
  "recurrenceInterval",
  "recurrenceWeekdays",
  "recurrenceMonthlyRuleType",
  "recurrenceMonthDay",
  "recurrenceMonthlyWeekOrdinal",
  "recurrenceMonthlyWeekday",
  "recurrenceEndType",
  "recurrenceEndDate",
  "recurrenceCount",
]);

function canModify(currentUser: ScheduleCurrentUser, authorId: string): boolean {
  return currentUser.id === authorId || currentUser.role === "ADMIN";
}

/** Outside-click 닫힘 버그 보완 — 업무명 등 input/textarea 텍스트를 마우스로
 * 드래그 선택하다 포인터가 팝업(Backdrop) 밖으로 나가면, mousedown은
 * input에서 시작했지만 mouseup은 Backdrop 위에서 끝나 브라우저가 그 둘의
 * 최소 공통 조상인 Backdrop에 click을 발생시킨다 — 아래 Backdrop의
 * `e.target === e.currentTarget` 검사만으로는 이걸 "바깥 클릭"과 구분하지
 * 못해 팝업이 닫혔다. 이 함수로 "그 클릭의 mousedown이 텍스트 편집 영역
 * 안에서 시작됐는지"만 판별해 그런 경우에만 닫기를 무시한다 — 특정 필드를
 * 하드코딩하지 않고 input/textarea/contenteditable 전부에 공통 적용된다. */
function isTextEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
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

/** Step(일정 관리 + 회의록 UI Polish) — 입력 순서 재배치(요청사항 3)에 맞춰
 * "무슨 일 → 어떤 프로젝트 → 언제 → 상태 → 누가 → 반복 → 기타"의 각 구간을
 * 시각적으로 나누는 얇은 구분선 + 소제목. 필드 순서/저장 로직은 전혀
 * 건드리지 않고 그룹 헤더만 추가한다. */
function SectionLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-wide text-navy-950/40 ${first ? "" : "border-t border-navy-100 pt-3.5"}`}>
      {children}
    </p>
  );
}

/** 업무 구분 select — native select를 그대로 쓰되(요청사항 14: dropdown 유지)
 * 선택된 Category의 저채도 색을 select 자체에 입혀 "작은 color icon + 한국어
 * 이름"처럼 보이게 한다(왼쪽 점 + 색 텍스트).
 *
 * Step 5B-4(사용자 정의 업무구분) — options는 이제 DB에서 온 동적 목록이다.
 * 비활성 옵션은 "새 일정 등록" dropdown에서는 숨기되(요청사항), 지금 이 Task가
 * 이미 그 옵션을 쓰고 있으면(수정 화면을 여는 순간의 value) 목록에서 빼지
 * 않는다 — 그러지 않으면 비활성화된 업무구분으로 저장된 기존 Task를 열었을 때
 * select가 아무것도 선택되지 않은 것처럼 보이고, 저장하지 않고 다른 필드만
 * 바꿔도 업무구분이 조용히 다른 값으로 바뀌는 사고가 날 수 있다. */
function CategorySelect({
  value,
  onChange,
  options,
}: {
  value: TaskFormInput["category"];
  onChange: (value: TaskFormInput["category"]) => void;
  options: ScheduleOptionInfo[];
}) {
  const current = options.find((o) => o.id === value);
  const tint = tintFromColor(current?.color ?? "#94a3b8");
  const visibleOptions = options.filter((o) => o.active || o.id === value);
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
        onChange={(e) => onChange(e.target.value)}
      >
        {visibleOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {!c.active ? " (비활성)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 상태 입력 — 일반 Select 대신 카드형 segmented 선택(요청사항 15). 값 자체는
 * TaskStatusOption.id이고, 그 옵션의 색만 입힌다. CategorySelect와 동일하게
 * 비활성 옵션도 "현재 선택된 값"이면 목록에 남긴다. */
function StatusSegmented({
  value,
  onChange,
  options,
  lockedIds,
}: {
  value: TaskFormInput["status"];
  onChange: (value: TaskFormInput["status"]) => void;
  options: ScheduleOptionInfo[];
  /** Step 5B-7(미팅 상태 입력 UX) — MEETING은 예정/진행중/완료가 시간으로
   * 자동 결정되므로 이 3개는 클릭해도 아무 일도 일어나지 않는다(정보 표시
   * 전용) — 그 외(보류 등 예외) 옵션은 그대로 클릭 가능하다. */
  lockedIds?: Set<string>;
}) {
  const visibleOptions = options.filter((o) => o.active || o.id === value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleOptions.map((s) => {
        const tint = tintFromColor(s.color);
        const selected = value === s.id;
        const locked = lockedIds?.has(s.id) ?? false;
        return (
          <button
            key={s.id}
            type="button"
            disabled={locked}
            onClick={() => onChange(s.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${locked ? "cursor-default" : ""}`}
            style={{
              backgroundColor: tint.bg,
              color: tint.text,
              borderColor: selected ? tint.border : "transparent",
              boxShadow: selected ? `inset 0 0 0 1px ${tint.border}` : undefined,
              opacity: selected ? 1 : 0.6,
            }}
          >
            {s.label}
            {!s.active ? " (비활성)" : ""}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Step(담당자 UX 개선, 요청사항 2·3) — "내 일정/공통/직접 지정" segmented
 * 선택. 신규는 항상 "내 일정"이 기본값(buildInitialInput)이고, 기존 Task는
 * 저장된 값 그대로 복원된다(isCommonAssignee ? COMMON : CUSTOM) — 이 컴포넌트
 * 자체는 순수 표현 + onChange 위임만 한다(다른 FormRow와 동일한 패턴).
 */
function AssigneeModeSelector({
  mode,
  assigneeIds,
  currentUser,
  users,
  onModeChange,
  onAssigneeIdsChange,
}: {
  mode: AssigneeMode;
  assigneeIds: string[];
  currentUser: ScheduleCurrentUser;
  users: ScheduleUser[];
  onModeChange: (mode: AssigneeMode) => void;
  onAssigneeIdsChange: (ids: string[]) => void;
}) {
  const me = users.find((u) => u.id === currentUser.id);
  const MODE_LABELS: Record<AssigneeMode, string> = { ME: "내 일정", COMMON: "공통", CUSTOM: "직접 지정" };

  return (
    <div className="space-y-2 pt-0.5">
      <div className="flex gap-1.5">
        {(["ME", "COMMON", "CUSTOM"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              mode === m ? "border-navy-900 bg-navy-900 text-white" : "border-navy-100 text-navy-950/60 hover:bg-navy-50"
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === "ME" && <p className="text-xs text-navy-950/60">{me?.name ?? me?.email ?? "나"}(으)로 자동 등록됩니다.</p>}

      {mode === "COMMON" && <p className="text-xs text-navy-950/40">특정 담당자 없이 공통 업무로 등록됩니다.</p>}

      {mode === "CUSTOM" && (
        <div className="flex flex-wrap gap-1.5">
          {users.map((u, i) => {
            const tint = getUserTint(i);
            const selected = assigneeIds.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onAssigneeIdsChange(toggleId(assigneeIds, u.id))}
                className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs ${
                  selected ? "border-navy-900" : "border-navy-100 hover:bg-navy-50"
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-full text-[10px] font-semibold"
                  style={{ backgroundColor: tint.avatarBg, color: tint.avatarText }}
                >
                  {getUserInitials(u.name, u.email)}
                </span>
                <span className={selected ? "text-navy-950" : "text-navy-950/70"}>{u.name ?? u.email}</span>
              </button>
            );
          })}
          {assigneeIds.length === 0 && <p className="w-full text-[11px] text-red-600">담당자를 1명 이상 선택해 주세요.</p>}
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
  projectCategoryGroups,
  taskCategoryOptions,
  taskStatusOptions,
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
  /** Step 5B-5(2단계 계층화) — ProjectCategorySelect의 대분류 목록. 카테고리
   * 추가/수정은 이제 "일정 설정"(ADMIN)에서만 하므로, 여기서는 두 목록 모두
   * 순수 조회/선택용으로만 쓰인다(로컬에서 직접 수정하지 않는다). */
  projectCategoryGroups: ProjectCategoryGroupOption[];
  /** Step 5B-4(사용자 정의 업무구분/상태) — CategorySelect/StatusSegmented가
   * 쓰는 동적 목록. ScheduleClient가 설정 화면 변경 결과를 반영해 내려준다. */
  taskCategoryOptions: ScheduleOptionInfo[];
  taskStatusOptions: ScheduleOptionInfo[];
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
    buildInitialInput(task, currentUser.id, { startDate: defaultStartDate, dueDate: defaultDueDate }),
  );
  // Step 5B-7(미팅 반복일정 UX) — 반복 규칙(요일/월 규칙)을 사용자가 이 화면
  // 안에서 실제로 건드렸는지 추적한다. 아직 안 건드렸으면(기존 반복 미팅을
  // 열어 제목만 고치는 등) anchor 재계산 기준일을 "지금 로드된 미팅 날짜
  // 그대로"로 둬서 반복 회차가 조용히 밀리지 않게 하고, 한 번이라도 건드리면
  // 그 순간부터는 "오늘" 기준으로 새 규칙에 맞는 첫 회차를 다시 계산한다
  // (아래 computedMeetingAnchorDate 계산 참고).
  const [recurrenceTouched, setRecurrenceTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Outside-click 닫힘 버그 보완 — isTextEditableTarget 주석 참고. state가
  // 아니라 ref인 이유: 이 값은 렌더에 영향을 주지 않고 같은 mousedown→click
  // 사이클 안에서만 읽히면 되므로 리렌더를 유발할 필요가 없다.
  const dragStartedInEditableRef = useRef(false);

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
            meetingEndTime: toLocalTimeString(d.meetingDetail?.endTime ?? null),
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
  // 공통 성능 아키텍처(Heavy Component Preload, 15번) — "업데이트" 버튼에
  // hover/focus 의도가 보이면 UpdateModal(Tiptap 포함) chunk를 미리
  // 내려받는다. Comment/Reply 데이터 자체는 건드리지 않는다 — 그 로직은
  // 기존 그대로(showUpdateModal true일 때의 useEffect)이고, 여기서는 JS
  // chunk 선로딩만 한다.
  const updateModalPreload = usePrefetchOnIntent(() => {
    import("./UpdateModal");
  });
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

  const isMeeting = input.category === TaskCategory.MEETING;

  // Step 5B-7(반복 미팅 anchor 자동 계산) — "미팅 날짜 + 반복 규칙"을 이중으로
  // 입력하지 않는다(요청사항): 반복이 켜져 있으면 날짜 input은 disabled로 잠그고,
  // 이 값을 대신 화면에 보여준다. state에 따로 저장하지 않고(불필요한 useEffect
  // 동기화를 피하려고) 매 렌더 순수 계산으로만 구한다 — recurrenceTouched가
  // false면(이번 세션에서 반복 규칙을 아직 안 건드림) 지금 로드돼 있는
  // meetingDate를 기준일로 써서 "제목만 고쳐 저장"해도 anchor가 조용히
  // 밀리지 않게 하고, 한 번이라도 건드리면 그 순간부터 "오늘"을 기준으로
  // 새 규칙에 맞는 첫 회차를 다시 찾는다.
  const isMeetingRecurring = isMeeting && input.recurrenceType !== "NONE";
  const meetingRecurrenceRule: RecurrenceRule = {
    type: input.recurrenceType,
    interval: 1,
    weekdays: input.recurrenceWeekdays,
    monthlyRuleType: input.recurrenceType === "MONTHLY" ? input.recurrenceMonthlyRuleType : null,
    monthDay:
      input.recurrenceType === "MONTHLY" && input.recurrenceMonthlyRuleType === "DAY_OF_MONTH" && input.recurrenceMonthDay
        ? Number(input.recurrenceMonthDay)
        : null,
    monthlyWeekOrdinal:
      input.recurrenceType === "MONTHLY" && input.recurrenceMonthlyRuleType === "NTH_WEEKDAY" && input.recurrenceMonthlyWeekOrdinal
        ? Number(input.recurrenceMonthlyWeekOrdinal)
        : null,
    monthlyWeekday:
      input.recurrenceType === "MONTHLY" && input.recurrenceMonthlyRuleType === "NTH_WEEKDAY" ? input.recurrenceMonthlyWeekday : null,
    endDate: null,
    count: null,
  };
  const meetingAnchorReferenceDate =
    recurrenceTouched || !input.meetingDate ? new Date() : new Date(`${input.meetingDate}T00:00:00`);
  const computedMeetingAnchorDate = isMeetingRecurring
    ? computeFirstOccurrenceOnOrAfter(meetingRecurrenceRule, meetingAnchorReferenceDate)
    : null;

  // Step 5B-7(미팅 상태 입력 UX) — 저장된 statusOptionId가 예약 3종(예정/진행중/
  // 완료)이면 "자동 관리 대상"이라 사용자가 실제로 지정한 값이 아니다. 이 경우
  // 화면에는 항상 실시간 계산값을 보여준다 — 보류처럼 사람이 직접 고른 예외
  // 상태만 그대로 존중한다(자동 계산이 덮어쓰지 않음).
  const meetingStatusIsException = isMeeting && !AUTO_MANAGED_MEETING_STATUS_IDS.has(input.status);
  const meetingDateForStatusPreview = isMeetingRecurring
    ? computedMeetingAnchorDate
      ? dateToLocalDateString(computedMeetingAnchorDate)
      : ""
    : input.meetingDate;
  const meetingComputedStatus =
    isMeeting && !meetingStatusIsException && meetingDateForStatusPreview && input.meetingStartTime && input.meetingEndTime
      ? computeMeetingOccurrenceStatus(
          new Date(`${meetingDateForStatusPreview}T00:00:00`),
          new Date(`${meetingDateForStatusPreview}T${input.meetingStartTime}`).toISOString(),
          new Date(`${meetingDateForStatusPreview}T${input.meetingEndTime}`).toISOString(),
          new Date(),
        )
      : null;
  const displayedStatus = meetingComputedStatus ?? input.status;

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
      // 반복 미팅은 날짜 input이 disabled라 input.meetingDate 자체는 갱신되지
      // 않는다 — 실제로 저장할 값은 화면에 보여준 자동 계산 anchor다.
      const submitInput: TaskFormInput = computedMeetingAnchorDate
        ? { ...input, meetingDate: dateToLocalDateString(computedMeetingAnchorDate) }
        : input;
      const res = mode === "create" ? await createTaskAction(submitInput) : await updateTaskAction(task!.id, submitInput);
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
    // Step 5B-1(반복 일정) — 계산된 회차는 실제 Row가 아니라 "이 회차만 삭제"가
    // 없다(V1 정책: 반복 일정 전체 삭제만 지원). 삭제 전 명확히 경고해 실수로
    // 전체 반복이 사라지는 것을 막는다. 반복이 아닌 기존 일정은 이 확인창 자체가
    // 뜨지 않아 기존 동작과 완전히 동일하다.
    if (task.recurrence.type !== "NONE" && !window.confirm("이 일정은 반복 일정입니다. 삭제하면 모든 반복 회차가 함께 삭제됩니다. 계속하시겠습니까?")) {
      return;
    }
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

  // MEETING은 일반 시작일/마감일 UI 자체가 없어 애초에 제외, HALF_DAY는 하루짜리
  // 일정 특성상 공식 Revision 관리 대상에서 제외한다(요청사항 26 — 기존 저장된
  // HALF_DAY Revision이 있었다면 그대로 두고 이 Step에서 새로 만들지만 못하게
  // 막는 것인데, 실제 확인 결과 HALF_DAY Revision은 존재하지 않는다).
  const isRevisionEligible = !isMeeting && input.category !== TaskCategory.HALF_DAY;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        // 업무명 등 텍스트를 드래그로 선택하다 포인터가 Backdrop까지 나가면
        // mouseup이 Backdrop 위에서 끝나 아래 onClick이 "바깥 클릭"으로
        // 오인한다 — 이 클릭 사이클의 mousedown이 텍스트 편집 영역에서
        // 시작됐는지만 여기서 기록해 둔다(isTextEditableTarget 주석 참고).
        dragStartedInEditableRef.current = isTextEditableTarget(e.target);
      }}
      onClick={(e) => {
        // onMouseDown으로 즉시 닫으면, 같은 클릭의 mouseup/click이 이미 사라진
        // Backdrop을 그대로 통과해 뒤에 있던 Calendar 날짜/일정에 그대로 꽂혀
        // "닫히자마자 새 Modal이 다시 열리는" 통과 클릭 버그가 생긴다. onClick은
        // mousedown~mouseup 내내 이 Backdrop이 실제 클릭 대상으로 남아 있을 때만
        // 발생해 그 통과를 원천 차단한다 — 입력값은 저장하지 않고 닫기만 한다.
        if (dragStartedInEditableRef.current) {
          dragStartedInEditableRef.current = false;
          return;
        }
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
                onMouseEnter={updateModalPreload.onMouseEnter}
                onFocus={updateModalPreload.onFocus}
                onTouchStart={updateModalPreload.onTouchStart}
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

        {/* Step(일정 관리 + 회의록 UI Polish) — 입력 순서 재배치(요청사항 3):
            "무슨 일(업무명) → 어떤 프로젝트(프로젝트 정보) → 언제(일정) →
            상태 → 누가(담당자) → 반복 → 기타 세부정보" 순서로 바꿨다. 각
            필드의 value/onChange/validation(required 등)은 단 하나도 바꾸지
            않았다 — JSX 배치 순서만 옮겼다. */}
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {/* 1. 업무명 */}
          <FormRow label="업무명">
            <input className={inputClass} value={input.title} onChange={(e) => set("title", e.target.value)} required />
          </FormRow>

          {/* 2. 프로젝트 정보 — 업무 구분 + (PROJECT면 프로젝트명/카테고리,
              PERSONAL_GOAL이면 목표명) */}
          <SectionLabel first>프로젝트 정보</SectionLabel>
          <FormRow label="업무 구분">
            <CategorySelect value={input.category} onChange={(v) => set("category", v)} options={taskCategoryOptions} />
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
              <div className="space-y-1">
                <label className={labelClass}>프로젝트 카테고리</label>
                <ProjectCategorySelect
                  categoryId={input.categoryId}
                  onChange={(id) => set("categoryId", id)}
                  categories={projectCategories}
                  groups={projectCategoryGroups}
                />
              </div>
            </div>
          )}

          {input.category === TaskCategory.PERSONAL_GOAL && (
            <div className="space-y-1 rounded-md border border-navy-100 bg-navy-50/60 p-3">
              <label className={labelClass}>목표명</label>
              <input className={inputClass} value={input.goalName} onChange={(e) => set("goalName", e.target.value)} required />
            </div>
          )}

          {/* 3. 일정 — MEETING이면 미팅 날짜/시간, HALF_DAY면 오전/오후,
              그 외에는 시작/마감일 + "+ 일정 변경"(같은 맥락이라 함께 둔다). */}
          <SectionLabel>일정</SectionLabel>
          {isMeeting && (
            <>
              <FormRow label="미팅 날짜">
                <div className="space-y-1">
                  {isMeetingRecurring && <span className="text-[11px] font-normal text-navy-950/40">반복 규칙으로 자동 계산됨</span>}
                  {isMeetingRecurring ? (
                    // DateTextInput은 8자리 숫자를 직접 타이핑하는 용도로 내부에
                    // digits state를 따로 들고 있어(사용자가 지우는 중에도 자연스러운
                    // 입력 UX를 위해) value prop이 나중에 외부(반복 규칙 변경)에서
                    // 바뀌어도 그 내부 state가 따라가지 않는다 — 실사용 검증에서 실제로
                    // 확인된 문제(요일을 바꿔도 화면 날짜가 그대로 멈춰 있음). 이 필드는
                    // 어차피 disabled라 사용자가 타이핑할 일이 없으므로, 그 digits 로직
                    // 없이 항상 최신 값을 그대로 반영하는 순수 읽기 전용 input으로 대신한다.
                    <input
                      type="text"
                      readOnly
                      disabled
                      className={`${inputClass} cursor-not-allowed bg-navy-100/70 text-navy-950/50`}
                      value={computedMeetingAnchorDate ? dateToLocalDateString(computedMeetingAnchorDate) : ""}
                    />
                  ) : (
                    <DateTextInput className={inputClass} value={input.meetingDate} onChange={(v) => set("meetingDate", v)} required />
                  )}
                  {isMeetingRecurring && !computedMeetingAnchorDate && (
                    <p className="text-[11px] text-red-600">반복 요일/규칙을 선택하면 첫 회차 날짜가 자동으로 채워집니다.</p>
                  )}
                </div>
              </FormRow>
              <FormRow label="미팅 시간">
                <div className="flex items-center gap-2">
                  <TimeSelect className={inputClass} value={input.meetingStartTime} onChange={(v) => set("meetingStartTime", v)} />
                  <span className="shrink-0 text-navy-950/30">~</span>
                  <TimeSelect className={inputClass} value={input.meetingEndTime} onChange={(v) => set("meetingEndTime", v)} />
                </div>
              </FormRow>
            </>
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
            <FormRow label="시작/마감일">
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

          {/* 4. 상태 */}
          <SectionLabel>상태</SectionLabel>
          <FormRow label="상태">
            {isMeeting ? (
              <div className="space-y-1">
                <StatusSegmented
                  value={displayedStatus}
                  onChange={(v) => set("status", v)}
                  options={taskStatusOptions}
                  // 평소엔 예정/진행중/완료를 눌러도 이미 자동으로 보여주는
                  // 값과 같아 의미가 없으니 잠근다 — 다만 "보류"처럼 예외로
                  // 바꾼 뒤에는 다시 자동으로 되돌릴 방법이 있어야 하므로,
                  // 그때는 셋 다 눌러 자동 관리로 복귀할 수 있게 풀어준다.
                  lockedIds={meetingStatusIsException ? undefined : AUTO_MANAGED_MEETING_STATUS_IDS}
                />
                <p className="text-[11px] text-navy-950/40">
                  {meetingStatusIsException
                    ? "예외 상태로 직접 지정돼 자동 계산을 건너뜁니다. 예정/진행중/완료 중 하나를 누르면 자동 관리로 돌아갑니다."
                    : "미팅 시작/종료 시각에 따라 자동 관리됩니다. 직접 개입이 필요하면 보류 등 다른 상태를 선택하세요."}
                </p>
              </div>
            ) : (
              <StatusSegmented value={input.status} onChange={(v) => set("status", v)} options={taskStatusOptions} />
            )}
          </FormRow>

          {/* 5. 담당자 — 내 일정/공통/직접 지정(요청사항 2·3) */}
          <SectionLabel>담당자</SectionLabel>
          <FormRow label="담당">
            <AssigneeModeSelector
              mode={input.assigneeMode}
              assigneeIds={input.assigneeIds}
              currentUser={currentUser}
              users={users}
              onModeChange={(m) => {
                set("assigneeMode", m);
                if (m === "ME") set("assigneeIds", [currentUser.id]);
                else if (m === "COMMON") set("assigneeIds", []);
              }}
              onAssigneeIdsChange={(ids) => set("assigneeIds", ids)}
            />
          </FormRow>

          {/* 6. 반복 */}
          <SectionLabel>반복</SectionLabel>
          {/* Step 5B-1(반복 일정) — 업무 구분(MEETING 포함)과 무관하게 공용으로
              둔다. */}
          <RecurrenceFields
            input={input}
            anchorDateStr={isMeeting ? input.meetingDate : input.startDate}
            onChange={(key, value) => {
              set(key, value);
              // Step 5B-7 — 반복 규칙 자체를 이 세션에서 실제로 건드렸는지
              // 추적한다(위 computedMeetingAnchorDate 계산 주석 참고). isMeeting이
              // 아니어도 플래그를 켜서 나쁠 게 없다 — 그 값은 isMeetingRecurring이
              // false일 때는 애초에 안 쓰인다.
              if (RECURRENCE_FIELD_KEYS.has(key)) setRecurrenceTouched(true);
            }}
          />
          {mode === "edit" && input.recurrenceType !== "NONE" && (
            <p className="text-[11px] text-navy-950/40">
              이 반복 규칙을 수정하면 전체 반복 일정에 적용됩니다. 특정 회차만 따로 수정하는 기능은 아직 지원하지 않습니다.
            </p>
          )}

          {/* 7. 기타 세부정보 — MEETING 부가 정보(참석 부서/참석자/장소),
              기존 메모(읽기 전용), 변경 이력(읽기 전용). */}
          {(isMeeting || input.memo || (mode === "edit" && isRevisionEligible)) && <SectionLabel>기타 세부정보</SectionLabel>}

          {isMeeting && (
            <>
              <FormRow label="참석 부서">
                <input className={inputClass} value={input.department} onChange={(e) => set("department", e.target.value)} />
              </FormRow>
              <FormRow label="참석자">
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
              </FormRow>
              <FormRow label="장소">
                <input className={inputClass} value={input.location} onChange={(e) => set("location", e.target.value)} />
              </FormRow>
            </>
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
