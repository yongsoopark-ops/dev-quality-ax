import type { ChatTaskDefinition } from "@/lib/chat/tasks";

/**
 * 작업 리스트의 항목 하나. Desktop 세로 목록/모바일 가로 칩 두 군데에서
 * variant만 바꿔 재사용한다(요청사항 11 — 별도 컴포넌트 두 벌을 만들지 않음).
 * Coming Soon 작업도 disabled 처리하지 않고 그대로 클릭 가능하게 둔다 —
 * 선택하면 "준비 중입니다" 안내만 나오고 실제로는 아무 것도 실행되지
 * 않으므로 안전하다(요청사항 7). 대신 뱃지로 상태를 명확히 표시한다.
 */
export function ChatTaskButton({
  task,
  selected,
  onSelect,
  variant = "list",
}: {
  task: ChatTaskDefinition;
  selected: boolean;
  onSelect: (id: string) => void;
  variant?: "list" | "chip";
}) {
  const isComingSoon = task.status === "coming-soon";

  if (variant === "chip") {
    return (
      <button
        type="button"
        onClick={() => onSelect(task.id)}
        aria-current={selected ? "true" : undefined}
        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 focus-visible:ring-offset-1 ${
          selected
            ? "border-navy-900 bg-navy-900 text-white"
            : "border-navy-100 bg-white text-navy-950/70 hover:bg-navy-50"
        }`}
      >
        {task.icon && <span aria-hidden>{task.icon}</span>}
        {task.title}
        {isComingSoon && <span className="text-[10px] opacity-70">·준비중</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 focus-visible:ring-offset-1 ${
        selected ? "bg-navy-50 text-navy-950" : "text-navy-950/75 hover:bg-navy-50/60"
      }`}
    >
      {task.icon && (
        <span aria-hidden className="mt-0.5 shrink-0">
          {task.icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{task.title}</span>
          {isComingSoon && (
            <span className="shrink-0 rounded-full bg-navy-100/60 px-1.5 py-0.5 text-[10px] font-medium text-navy-950/50">
              Coming soon
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-navy-950/45">{task.description}</span>
      </span>
    </button>
  );
}
