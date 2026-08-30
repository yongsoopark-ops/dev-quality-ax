"use client";

import { useState } from "react";
import { executeW3AutomationAction, executeW4AutomationAction, runChatCommandAction, runSelectedTaskCommandAction } from "./actions";
import type { ChatCommandResult } from "@/lib/chat/types";
import { CHAT_TASKS, DEFAULT_CHAT_TASK_ID } from "@/lib/chat/tasks";
import { validateAttachment } from "@/lib/chat/attachments";
import { UserMessage } from "./components/UserMessage";
import { AssistantTextMessage } from "./components/AssistantTextMessage";
import { ChatComposer, type ChatComposerAttachment } from "./components/ChatComposer";
import { ChatTaskSidebar } from "./components/ChatTaskSidebar";
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

type ChatMessage = UserMessageData | AssistantMessageData;

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

  const selectedTask = CHAT_TASKS.find((t) => t.id === selectedTaskId);

  function appendAssistantMessage(result: ChatCommandResult) {
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "ASSISTANT", result }]);
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

    // 회의록 Skill은 아직 서버 파서/자동화 경로를 타지 않는다 — 파일 접수
    // 확인까지만 이 Step의 범위다(요청사항: AI 생성/서버 전송 없음). 내용은
    // 아직 읽지 않았으므로 "확인했습니다"가 아니라 "첨부되었습니다"로 표현한다.
    if (selectedTaskId === "meeting-notes") {
      appendAssistantMessage({
        kind: "TEXT",
        message: submittedFile
          ? "파일이 첨부되었습니다. 다음 단계에서 회의 유형을 선택해 주세요."
          : "회의 원문 TXT 파일을 업로드해 주세요.",
      });
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
    <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden sm:flex-row">
      <ChatTaskSidebar selectedTaskId={selectedTaskId} onSelect={handleSelectTask} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
              messages.map((m) =>
                m.role === "USER" ? (
                  <UserMessage key={m.id} text={m.text} attachmentName={m.attachmentName} />
                ) : (
                  <AssistantMessage key={m.id} result={m.result} />
                ),
              )
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
