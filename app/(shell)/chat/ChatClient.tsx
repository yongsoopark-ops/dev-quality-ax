"use client";

import { useRef, useState } from "react";
import { executeW3AutomationAction, executeW4AutomationAction, runChatCommandAction, runSelectedTaskCommandAction } from "./actions";
import type { ChatCommandResult } from "@/lib/chat/types";
import { CHAT_TASKS, DEFAULT_CHAT_TASK_ID } from "@/lib/chat/tasks";
import { validateAttachment, readTextFile } from "@/lib/chat/attachments";
import { type MeetingType } from "@/lib/chat/meetingTypes";
import { UserMessage } from "./components/UserMessage";
import { AssistantTextMessage } from "./components/AssistantTextMessage";
import { ChatComposer, type ChatComposerAttachment } from "./components/ChatComposer";
import { ChatTaskSidebar } from "./components/ChatTaskSidebar";
import { MeetingTypeSelector } from "./components/MeetingTypeSelector";
import { PreflightCard, ExecutionCard, W4PreflightCard, W4ExecutionCard } from "./ResultCards";

interface UserMessageData {
  id: string;
  role: "USER";
  text: string;
  /** Step 2 — 이 메시지와 함께 제출된 첨부의 표시용 metadata(파일명)만
   * 보관한다. 실제 File 객체는 message 배열에 넣지 않는다 — 별도 transient
   * state(submittedMeetingFile)로 관리한다. */
  attachmentName?: string;
}

interface AssistantMessageData {
  id: string;
  role: "ASSISTANT";
  result: ChatCommandResult;
}

/** Step 3 — 회의 유형 선택 UI. 어떤 유형을 골랐는지(selected)를 메시지 자체에
 * 들고 있어서, 한 번 답한 뒤에도 그 상태 그대로 대화 이력에 남는다. */
interface MeetingTypeSelectMessageData {
  id: string;
  role: "MEETING_TYPE_SELECT";
  selected: MeetingType | null;
}

type ChatMessage = UserMessageData | AssistantMessageData | MeetingTypeSelectMessageData;

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `m${messageIdCounter}`;
}

/**
 * 하나의 Assistant 응답(ChatCommandResult)을 어떤 컴포넌트로 그릴지만
 * 결정한다 — 기능/데이터는 그대로, 표현만 분기한다. READY 상태 Preflight는
 * ChatClient가 자동으로 실행까지 이어가므로(continueWithAutoExecute) 여기
 * 도달하는 W3_PREFLIGHT/W4_PREFLIGHT는 실제로는 NEEDS_REVIEW/에러 상태뿐이다.
 */
function AssistantMessage({ result }: { result: ChatCommandResult }) {
  switch (result.kind) {
    case "TEXT":
      return <AssistantTextMessage message={result.message} />;
    case "W3_PREFLIGHT":
      return <PreflightCard preflight={result.preflight} />;
    case "W3_EXECUTION":
      return <ExecutionCard execution={result.execution} />;
    case "W4_PREFLIGHT":
      return <W4PreflightCard preflight={result.preflight} />;
    case "W4_EXECUTION":
      return <W4ExecutionCard execution={result.execution} />;
  }
}

/**
 * Chat UX 단순화 Step — 작업(Sidebar) 선택 자체가 command context가 된다.
 * W3/W4를 선택한 뒤에는 URL만 입력하면 되고("W3 자동화 실행" 같은 문구를
 * 다시 입력할 필요 없음), Preflight가 READY면 확인 버튼 없이 바로 실행까지
 * 이어진다. 기존 parseChatCommand()/routeChatCommand()/Preflight 계산/실행
 * Action은 전혀 바꾸지 않았다 — runSelectedTaskCommandAction(actions.ts)이
 * ChatCommand를 직접 구성해 그 기존 함수들에 그대로 넘길 뿐이다. 따라서
 * "W3 자동화 실행 https://..." 같은 예전 문구도(어떤 작업이 선택돼 있든)
 * 여전히 그대로 동작한다(하위 호환, 요청사항 4).
 */
export function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(DEFAULT_CHAT_TASK_ID);
  // 공통 첨부 기반(Step 1) — 실제 File 객체를 Client state로만 들고 있는다.
  // 새로고침하면 사라지는 일시 상태이고, 이번 Step에서는 서버로 보내지 않는다.
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // Step 2 — 회의록 Skill에 "제출"된 File 객체는 message 배열이 아니라
  // 여기(별도 transient state)에만 둔다. Chat message data에는 실제 File을
  // 절대 넣지 않는다는 원칙 때문 — 다음 단계(회의 유형 선택 → 내용 읽기)가
  // 이 state를 그대로 이어받아 쓰면 된다. 새로고침하면 사라지는 건 V1에서는
  // 문제없다(서버/DB에 저장하지 않음).
  const [submittedMeetingFile, setSubmittedMeetingFile] = useState<File | null>(null);
  // Step 3 — 읽은 TXT 원문과 사용자가 고른 회의 유형. 둘 다 다음 Gemini
  // Step이 그대로 이어받을 값이라 여기서만 transient state로 유지한다
  // (서버/DB 저장 없음, 새로고침하면 사라짐 — 지시사항대로 V1에서는 문제없음).
  const [meetingTranscript, setMeetingTranscript] = useState<string | null>(null);
  const [selectedMeetingType, setSelectedMeetingType] = useState<MeetingType | null>(null);
  // Step 3.1 — Composer 내부 Drop(ChatComposer.tsx)과는 별개로, Conversation
  // 영역을 포함한 전체 작업영역(Sidebar 제외)에서도 같은 방식(진입/이탈
  // 카운터로 중첩 이벤트 상쇄)을 독립적으로 적용해 깜빡임 없이 Drop 가능
  // 상태를 보여준다. 실제 첨부는 항상 기존 attachment.onSelect만 거친다.
  const workspaceDragCounterRef = useRef(0);
  const [isDraggingOverWorkspace, setIsDraggingOverWorkspace] = useState(false);

  const selectedTask = CHAT_TASKS.find((t) => t.id === selectedTaskId);

  function appendAssistantMessage(result: ChatCommandResult) {
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "ASSISTANT", result }]);
  }

  function appendMeetingTypeSelector() {
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "MEETING_TYPE_SELECT", selected: null }]);
  }

  /** 회의 유형 버튼 클릭 — 그 메시지 자체에 선택 결과를 남겨(다른 메시지를
   * 지우지 않고) 이력에 그대로 보이게 하고, 다음 Gemini Step이 쓸 state도
   * 함께 채운다. */
  function handleSelectMeetingType(messageId: string, type: MeetingType) {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId && m.role === "MEETING_TYPE_SELECT" ? { ...m, selected: type } : m)),
    );
    setSelectedMeetingType(type);
  }

  function handleSelectTask(taskId: string) {
    if (taskId === selectedTaskId) return;
    setSelectedTaskId(taskId);
    // Skill을 바꾸면 이전 Skill 맥락의 첨부를 그대로 들고 가지 않는다 —
    // 첨부를 지원하지 않는 Skill로 전환했을 때 잘못된 첨부 상태가 남는
    // 것을 막는 가장 단순한 규칙(전환 시 항상 초기화).
    setAttachedFile(null);
    setAttachmentError(null);
    setSubmittedMeetingFile(null);
    setMeetingTranscript(null);
    setSelectedMeetingType(null);
    workspaceDragCounterRef.current = 0;
    setIsDraggingOverWorkspace(false);
    const task = CHAT_TASKS.find((t) => t.id === taskId);
    if (task?.instructionMessage) {
      appendAssistantMessage({ kind: "TEXT", message: task.instructionMessage });
    }
  }

  function handleAttachFile(file: File) {
    if (!selectedTask?.attachmentsEnabled) return;
    const result = validateAttachment(file, {
      acceptedFileTypes: selectedTask.acceptedFileTypes ?? [],
      maxFileSize: selectedTask.maxFileSize ?? 0,
    });
    if (!result.ok) {
      setAttachedFile(null);
      setAttachmentError(result.error ?? "첨부할 수 없는 파일입니다.");
      return;
    }
    setAttachedFile(file);
    setAttachmentError(null);
  }

  function handleRemoveAttachment() {
    setAttachedFile(null);
    setAttachmentError(null);
  }

  const attachment: ChatComposerAttachment | undefined = selectedTask?.attachmentsEnabled
    ? {
        policy: { acceptedFileTypes: selectedTask.acceptedFileTypes ?? [], maxFileSize: selectedTask.maxFileSize ?? 0 },
        file: attachedFile,
        error: attachmentError,
        onSelect: handleAttachFile,
        onRemove: handleRemoveAttachment,
      }
    : undefined;

  // Step 3.1 — Chat 작업영역(헤더+Conversation+Composer, Sidebar 제외) 전체를
  // Drop Zone으로 확장한다. attachment가 없는 Skill(W3/W4)에서는 preventDefault
  // (브라우저 기본 파일-열기 방지)만 하고 실제 첨부 로직은 타지 않는다 —
  // ChatComposer.tsx의 동일 패턴을 그대로 재사용한다.
  function handleWorkspaceDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!attachment) return;
    workspaceDragCounterRef.current += 1;
    setIsDraggingOverWorkspace(true);
  }

  function handleWorkspaceDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function handleWorkspaceDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!attachment) return;
    workspaceDragCounterRef.current = Math.max(0, workspaceDragCounterRef.current - 1);
    if (workspaceDragCounterRef.current === 0) setIsDraggingOverWorkspace(false);
  }

  function handleWorkspaceDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    workspaceDragCounterRef.current = 0;
    setIsDraggingOverWorkspace(false);
    if (!attachment) return;
    // Composer 위에 직접 Drop한 경우는 ChatComposer.tsx의 handleDrop이 먼저
    // 처리하고 stopPropagation으로 여기까지 올라오지 않는다 — 이 핸들러는
    // Composer 밖(헤더/Conversation 영역)에 놓인 경우만 담당한다.
    const file = e.dataTransfer.files?.[0];
    if (file) attachment.onSelect(file);
  }

  /**
   * W3/W4 Preflight가 READY(+W4는 이미 최신 상태가 아닐 때)면 확인 버튼 없이
   * 곧바로 기존 실행 Action을 호출한다(요청사항 6). 안전 검증(Preflight)
   * 자체는 그대로 거치고, "그 결과를 보여준 뒤 다시 눌러야 하는" 단계만
   * 없앤 것 — READY가 아니면(NEEDS_REVIEW/TEMPLATE_CHANGED/ERROR) 지금과
   * 동일하게 그 결과를 그대로 보여주고 자동 실행하지 않는다(요청사항 7).
   */
  async function continueWithAutoExecute(result: ChatCommandResult) {
    if (result.kind === "W3_PREFLIGHT" && result.preflight.status === "READY") {
      const execRes = await executeW3AutomationAction({ spreadsheetUrl: result.preflight.spreadsheetUrl });
      appendAssistantMessage(
        execRes.result ? { kind: "W3_EXECUTION", execution: execRes.result } : { kind: "TEXT", message: execRes.error ?? "실행하지 못했습니다." },
      );
      return;
    }
    if (result.kind === "W4_PREFLIGHT" && result.preflight.status === "READY" && !result.preflight.summary.alreadyUpToDate) {
      const execRes = await executeW4AutomationAction({ spreadsheetUrl: result.preflight.spreadsheetUrl });
      appendAssistantMessage(
        execRes.result ? { kind: "W4_EXECUTION", execution: execRes.result } : { kind: "TEXT", message: execRes.error ?? "실행하지 못했습니다." },
      );
      return;
    }
    appendAssistantMessage(result);
  }

  // Step 2 — 회의록 Skill은 첨부 파일 자체가 입력이라, 텍스트 없이 첨부만
  // 있어도 Send를 허용한다(config의 attachmentCanReplaceText로만 판단,
  // Skill id를 직접 검사하지 않는다). 다른 Skill은 attachedFile이 항상
  // null이거나 이 플래그가 없으므로 기존 "텍스트 필요" 조건 그대로다.
  const canSendAttachmentOnly = Boolean(selectedTask?.attachmentCanReplaceText && attachedFile);

  async function handleSend() {
    const text = input.trim();
    if (isSending) return;
    if (!text && !canSendAttachmentOnly) return;

    const submittedFile = canSendAttachmentOnly ? (attachedFile ?? undefined) : undefined;
    // message에는 표시용 파일명만 넣는다 — 실제 File 객체는 절대 message
    // data에 넣지 않는다(원칙). 그 File 자체는 submittedMeetingFile에만 둔다.
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "USER", text, attachmentName: submittedFile?.name }]);
    setInput("");
    if (submittedFile) {
      setSubmittedMeetingFile(submittedFile);
      // 접수 즉시 Composer의 첨부 상태를 비워 같은 파일이 중복 제출되지 않게 한다.
      setAttachedFile(null);
      setAttachmentError(null);
    }
    setIsSending(true);

    // 회의록 Skill은 아직 서버 파서/자동화 경로를 타지 않는다 — Gemini
    // 호출/회의록 생성은 이 Step의 범위 밖이다(요청사항). 내용은 접수
    // 시점에는 아직 읽지 않았으므로 "확인했습니다"가 아니라 "첨부되었습니다"로
    // 표현하고, 실제 읽기는 그 다음에 한다.
    if (selectedTaskId === "meeting-notes") {
      if (!submittedFile) {
        appendAssistantMessage({ kind: "TEXT", message: "회의 원문 TXT 파일을 업로드해 주세요." });
        setIsSending(false);
        return;
      }

      appendAssistantMessage({ kind: "TEXT", message: "파일이 첨부되었습니다. 다음 단계에서 회의 유형을 선택해 주세요." });

      // Step 3 — 표준 File API로 TXT 원문을 읽는다(서버 전송 없음). 화자
      // 라벨 유무 등 형식은 가정하지 않고, "내용이 실제로 있는가"만 본다.
      const readResult = await readTextFile(submittedFile);
      if (!readResult.ok) {
        appendAssistantMessage({ kind: "TEXT", message: readResult.error });
        setIsSending(false);
        return;
      }

      setMeetingTranscript(readResult.text);
      appendAssistantMessage({ kind: "TEXT", message: "회의 유형을 선택해 주세요." });
      appendMeetingTypeSelector();
      setIsSending(false);
      return;
    }

    // selectedTask 기반 routing(요청사항 3) — W3/W4가 선택돼 있으면 문구
    // 없이 URL만 온 입력도 그 작업의 자동화 명령으로 해석한다. 그 외
    // (일반 채팅)는 기존 자유 입력 파서를 그대로 쓴다.
    const res =
      selectedTaskId === "w3-automation"
        ? await runSelectedTaskCommandAction({ task: "W3", text })
        : selectedTaskId === "w4-automation"
          ? await runSelectedTaskCommandAction({ task: "W4", text })
          : await runChatCommandAction({ message: text });

    const result: ChatCommandResult = res.result ?? {
      kind: "TEXT",
      message: res.error ?? "요청을 처리하지 못했습니다.",
    };
    await continueWithAutoExecute(result);
    setIsSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden sm:flex-row"
      // Step 3.1 — 실제 Drop Zone(첨부 처리)은 아래 작업영역 wrapper와
      // ChatComposer뿐이다. 이 최상위 레벨은 Sidebar 등 그 바깥에 실수로
      // 파일을 놓쳐도 브라우저가 파일을 열어버리며 페이지를 이탈하지 않게
      // 막는 마지막 안전망일 뿐, 첨부는 절대 여기서 처리하지 않는다.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <ChatTaskSidebar selectedTaskId={selectedTaskId} onSelect={handleSelectTask} />

      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-colors ${
          isDraggingOverWorkspace ? "bg-navy-50/60 ring-2 ring-inset ring-navy-300" : ""
        }`}
        onDragEnter={handleWorkspaceDragEnter}
        onDragOver={handleWorkspaceDragOver}
        onDragLeave={handleWorkspaceDragLeave}
        onDrop={handleWorkspaceDrop}
      >
        <div className="shrink-0 border-b border-navy-100 px-6 py-5 sm:px-8">
          <h1 className="text-lg font-semibold text-navy-950">Chat</h1>
          <p className="mt-1 max-w-[640px] text-sm text-navy-950/60">
            개발품질 업무 요청과 자동화를 실행하는 통합 작업 공간입니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
            {messages.length === 0 ? (
              <div className="flex min-h-[300px] flex-1 items-center justify-center">
                <p className="text-sm text-navy-950/40">무엇을 도와드릴까요?</p>
              </div>
            ) : (
              messages.map((m) => {
                if (m.role === "USER") return <UserMessage key={m.id} text={m.text} attachmentName={m.attachmentName} />;
                if (m.role === "MEETING_TYPE_SELECT") {
                  return (
                    <MeetingTypeSelector
                      key={m.id}
                      selected={m.selected}
                      onSelect={(type) => handleSelectMeetingType(m.id, type)}
                    />
                  );
                }
                return <AssistantMessage key={m.id} result={m.result} />;
              })
            )}
            {isSending && <AssistantTextMessage message="분석 중..." />}
          </div>
        </div>

        <div className="shrink-0 border-t border-navy-100 px-4 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <ChatComposer
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              disabled={(!input.trim() && !canSendAttachmentOnly) || isSending}
              sending={isSending}
              placeholder={selectedTask?.composerPlaceholder}
              attachment={attachment}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
