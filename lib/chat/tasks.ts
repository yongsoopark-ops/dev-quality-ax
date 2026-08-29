/**
 * Chat 2차 Sidebar(작업 리스트) 공통 config. 새 Skill을 추가할 때 이 배열에
 * 항목 하나만 늘리면 되도록, UI 쪽(ChatTaskSidebar/ChatTaskButton)에는 작업
 * 이름을 하드코딩하지 않는다.
 *
 * 이번 Step에서는 "선택 시 안내 문구를 보여준다" 이상의 실행 로직을
 * 새로 만들지 않는다 — instructionMessage는 순수 안내용 TEXT 메시지일
 * 뿐, command parser(lib/chat/parseCommand.ts)는 이 파일을 전혀 참조하지
 * 않는다. 사용자가 실제로 자동화를 실행하려면 지금과 동일하게 "W3
 * 자동화"/"W4 자동화" 문구 + URL을 직접 입력해야 한다(요청사항 6).
 *
 * 향후 Skill Architecture(요청사항 10)를 위한 최소 확장 지점만 남겨둔다:
 * inputHint(입력 형식 안내)까지는 지금 필드로 표현 가능하고, 실제 실행
 * handler가 필요한 Skill(회의록 자동 작성 등)은 나중에 이 정의에
 * `status: "available"`로 바꾸고 실행 경로를 연결하면 된다 — 지금부터
 * 별도 plugin/handler 등록 프레임워크를 만들지는 않는다.
 */
export type ChatTaskCategory = "GENERAL" | "AUTOMATION" | "FUTURE";
export type ChatTaskStatus = "available" | "coming-soon";

export interface ChatTaskDefinition {
  id: string;
  title: string;
  description: string;
  category: ChatTaskCategory;
  status: ChatTaskStatus;
  /** 텍스트 아이콘(이모지) — 별도 아이콘 라이브러리를 추가하지 않는다(성능 원칙). */
  icon?: string;
  /** 작업을 선택한 직후 Conversation에 한 번 보여줄 안내 메시지. 없으면 아무 것도 추가하지 않는다. */
  instructionMessage?: string;
  /** 이 작업이 선택된 동안 Composer에 표시할 placeholder. 없으면 기본 placeholder를 쓴다. */
  composerPlaceholder?: string;
}

export const CHAT_TASKS: ChatTaskDefinition[] = [
  {
    id: "general-chat",
    title: "일반 채팅",
    description: "자유 요청",
    category: "GENERAL",
    status: "available",
    icon: "💬",
  },
  {
    id: "w3-automation",
    title: "W3 자동화",
    description: "PW2 → PW3",
    category: "AUTOMATION",
    status: "available",
    icon: "📄",
    instructionMessage: "자동화할 Google Spreadsheet URL을 입력해 주세요.",
    composerPlaceholder: "Google Spreadsheet URL을 입력하세요",
  },
  {
    id: "w4-automation",
    title: "W4 자동화",
    description: "PW3 → PW4",
    category: "AUTOMATION",
    status: "available",
    icon: "📄",
    instructionMessage: "자동화할 Google Spreadsheet URL을 입력해 주세요.",
    composerPlaceholder: "Google Spreadsheet URL을 입력하세요",
  },
  {
    id: "meeting-notes",
    title: "회의록 자동 작성",
    description: "회의 내용 정리",
    category: "FUTURE",
    status: "coming-soon",
    icon: "📝",
    instructionMessage: "회의록 자동 작성 기능은 준비 중입니다.",
  },
];

export const DEFAULT_CHAT_TASK_ID = "general-chat";
