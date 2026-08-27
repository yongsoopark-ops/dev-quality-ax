"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProjectCategoryOption, ScheduleCurrentUser, ScheduleUser, TaskWithRelations } from "@/lib/schedule/types";
import { CalendarView } from "./CalendarView";
import { TaskDetailPanel } from "./TaskDetailPanel";

type Selection =
  | { mode: "create"; defaultStartDate?: string; defaultDueDate?: string }
  | { mode: "edit"; task: TaskWithRelations }
  | null;

function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface InitialFocus {
  taskId: string;
  commentId?: string;
}

export function ScheduleClient({
  tasks,
  users,
  projectCategories,
  currentUser,
  initialFocus,
}: {
  tasks: TaskWithRelations[];
  users: ScheduleUser[];
  projectCategories: ProjectCategoryOption[];
  currentUser: ScheduleCurrentUser;
  /** Bell Notification Deep Link(요청사항 9) — page.tsx가 이미 taskId 존재를
   * 확인해 내려준 값이다. 여기서는 "Task Modal + Update Modal을 미리 열어 둔
   * 초기 selection"으로 한 번만 소비한다. */
  initialFocus?: InitialFocus;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selection, setSelection] = useState<Selection>(() => {
    if (!initialFocus) return null;
    const task = tasks.find((t) => t.id === initialFocus.taskId);
    return task ? { mode: "edit", task } : null;
  });
  // Deep Link로 자동 연 것인지 여부 — 이후 사용자가 Calendar에서 직접 같은/다른
  // 업무를 클릭해 새로 여는 Modal에는 Update Modal 자동 오픈/포커스가 다시
  // 적용되면 안 된다(요청사항: 정상적인 기존 동작은 그대로 유지). onClose에서
  // 한 번 소비되면 null로 지운다.
  const [pendingFocus, setPendingFocus] = useState(() => (selection ? initialFocus : undefined));

  // Deep Link를 한 번 적용한 뒤에는 URL의 ?task=&comment= 쿼리만 제거한다 —
  // 나머지 쿼리(있다면)는 그대로 보존한다. 뒤로가기/새로고침 시 계속 같은
  // Modal이 다시 열리는 것을 막는다.
  useEffect(() => {
    if (!initialFocus) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("task");
    next.delete("comment");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modal(생성/수정)이 열려 있는 동안에는 Calendar의 날짜/일정 클릭이 selection을
  // 절대 바꾸지 않는다 — 그렇지 않으면 입력 중인 Modal이 다른 날짜/다른 Task
  // 기준의 새 Modal로 조용히 대체돼 버린다(입력값 유실). 닫힌 뒤에만 다시 열린다.
  function handleSelectSlot(range: { start: Date; end: Date }) {
    if (selection) return;
    // react-big-calendar의 all-day 선택 end는 배타적이라(다음 날 00:00), 마감일
    // 표시용으로는 하루 앞당겨서 보여준다 — mapTaskToEvent의 반대 변환.
    const inclusiveEnd = new Date(range.end);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
    const due = inclusiveEnd.getTime() >= range.start.getTime() ? inclusiveEnd : range.start;
    setSelection({ mode: "create", defaultStartDate: toDateOnly(range.start), defaultDueDate: toDateOnly(due) });
  }

  function handleSelectTask(task: TaskWithRelations) {
    if (selection) return;
    setSelection({ mode: "edit", task });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 rounded-xl border border-navy-100 bg-white p-3">
        <CalendarView tasks={tasks} users={users} onSelectTask={handleSelectTask} onSelectSlot={handleSelectSlot} />
      </div>

      {selection && (
        <TaskDetailPanel
          key={selection.mode === "edit" ? selection.task.id : `new-${selection.defaultStartDate ?? ""}-${selection.defaultDueDate ?? ""}`}
          mode={selection.mode}
          task={selection.mode === "edit" ? selection.task : null}
          defaultStartDate={selection.mode === "create" ? selection.defaultStartDate : undefined}
          defaultDueDate={selection.mode === "create" ? selection.defaultDueDate : undefined}
          users={users}
          projectCategories={projectCategories}
          currentUser={currentUser}
          initialShowUpdateModal={
            selection.mode === "edit" && pendingFocus?.taskId === selection.task.id ? true : undefined
          }
          initialFocusCommentId={
            selection.mode === "edit" && pendingFocus?.taskId === selection.task.id ? pendingFocus.commentId : undefined
          }
          onClose={() => {
            setSelection(null);
            setPendingFocus(undefined);
          }}
        />
      )}
    </div>
  );
}
