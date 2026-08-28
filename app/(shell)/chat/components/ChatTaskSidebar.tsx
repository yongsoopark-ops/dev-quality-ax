import { CHAT_TASKS } from "@/lib/chat/tasks";
import { ChatTaskButton } from "./ChatTaskButton";

/**
 * Chat 전용 2차 Sidebar — 메인 Sidebar(components/Sidebar.tsx)는 전혀
 * 건드리지 않고 Chat Route 내부에서만 구성한다(요청사항 1). 고정폭
 * 세로 목록(desktop)과 가로 스크롤 칩 목록(narrow viewport) 두 형태를
 * 같은 CHAT_TASKS 데이터로 렌더링한다 — 별도 열기/닫기 상태 없이 CSS
 * breakpoint만으로 전환해 가장 단순하게 유지한다(요청사항 11/12).
 */
export function ChatTaskSidebar({
  selectedTaskId,
  onSelect,
}: {
  selectedTaskId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {/* Desktop: 왼쪽 고정폭 세로 목록, 스크롤 가능 */}
      <nav
        aria-label="AI 작업"
        className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-navy-100 bg-white sm:flex"
      >
        <div className="shrink-0 border-b border-navy-100 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-950/50">AI 작업</p>
        </div>
        <div className="flex-1 space-y-0.5 p-2">
          {CHAT_TASKS.map((task) => (
            <ChatTaskButton key={task.id} task={task} selected={task.id === selectedTaskId} onSelect={onSelect} variant="list" />
          ))}
        </div>
      </nav>

      {/* Narrow viewport: 위쪽 가로 스크롤 칩 — Conversation 자체는 가로 스크롤되지 않는다. */}
      <nav aria-label="AI 작업" className="flex shrink-0 gap-2 overflow-x-auto border-b border-navy-100 bg-white p-2 sm:hidden">
        {CHAT_TASKS.map((task) => (
          <ChatTaskButton key={task.id} task={task} selected={task.id === selectedTaskId} onSelect={onSelect} variant="chip" />
        ))}
      </nav>
    </>
  );
}
