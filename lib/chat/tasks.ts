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
  /**
   * 공통 파일 첨부 기반(Step 1) — 이 Skill이 Composer에 첨부 버튼을 노출할지.
   * 없거나 false면 첨부 UI 자체가 뜨지 않는다(W3/W4는 URL 전용이라 비활성).
   * UI 쪽은 이 필드만 보고 분기하며 Skill id를 직접 검사하지 않는다.
   */
  attachmentsEnabled?: boolean;
  /** 허용 확장자(소문자, 점 포함). attachmentsEnabled일 때만 의미가 있다. */
  acceptedFileTypes?: string[];
  /** 허용 최대 파일 크기(byte). attachmentsEnabled일 때만 의미가 있다. */
  maxFileSize?: number;
  /**
   * Step 2 — 이 Skill은 첨부 파일 자체가 입력이라, 텍스트 없이 첨부만으로도
   * Send를 허용할지. attachmentsEnabled가 false면 의미 없다. 기본값은
   * false(첨부가 있어도 여전히 텍스트가 있어야 Send 가능) — W3/W4/일반
   * 채팅의 기존 Send 조건을 그대로 지키기 위한 명시적 opt-in이다.
   */
  attachmentCanReplaceText?: boolean;
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
    // Step 2: 실제 회의록 생성(AI 연동)은 아직 없지만, 입력 흐름(TXT 업로드
    // → 접수 확인)은 연결됐다 — 그래서 안내가 "준비 중"이 아니라 실제로
    // 무엇을 해야 하는지를 알려준다. Sidebar의 "Coming soon" 뱃지는 최종
    // 생성 기능이 아직 없다는 뜻으로 그대로 둔다(상태 자체는 안 바꿈).
    instructionMessage: "회의 원문 TXT 파일을 업로드해 주세요.",
    // 첨부 기반(Step 1: V1 TXT 1개, 5MB)은 그대로 유지.
    attachmentsEnabled: true,
    acceptedFileTypes: [".txt"],
    maxFileSize: 5 * 1024 * 1024,
    attachmentCanReplaceText: true,
  },
];

export const DEFAULT_CHAT_TASK_ID = "general-chat";
