"use client";

import { useState } from "react";
import { runChatCommandAction } from "./actions";
import type { ChatCommandResult } from "@/lib/chat/types";
import { UserMessage } from "./components/UserMessage";
import { AssistantTextMessage } from "./components/AssistantTextMessage";
import { ChatComposer } from "./components/ChatComposer";
import { PreflightCard, ExecutionCard, W4PreflightCard, W4ExecutionCard } from "./ResultCards";

interface UserMessageData {
  id: string;
  role: "USER";
  text: string;
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
 * 결정한다 — 기능/데이터는 그대로, 표현만 분기한다.
 */
function AssistantMessage({
  result,
  onExecuted,
}: {
  result: ChatCommandResult;
  onExecuted: (result: ChatCommandResult) => void;
}) {
  switch (result.kind) {
    case "TEXT":
      return <AssistantTextMessage message={result.message} />;
    case "W3_PREFLIGHT":
      return <PreflightCard preflight={result.preflight} onExecuted={onExecuted} />;
    case "W3_EXECUTION":
      return <ExecutionCard execution={result.execution} />;
    case "W4_PREFLIGHT":
      return <W4PreflightCard preflight={result.preflight} onExecuted={onExecuted} />;
    case "W4_EXECUTION":
      return <W4ExecutionCard execution={result.execution} />;
  }
}

/**
 * 전역 성능 Step(Chat UI 재설계) — ChatGPT처럼 가운데 정렬된 Conversation
 * Column(max-w-3xl) 구조로 바꿨다. 기능(runChatCommandAction 호출, Enter로
 * 전송, W3/W4 실행 handler)은 기존과 완전히 동일하다 — 레이아웃/표현만
 * 바뀌었다.
 *
 * 바깥을 flex row(`flex h-dvh`)로 두고 Conversation 영역은 `flex-1
 * min-w-0`만 준다 — 나중에 Chat 전용 2차 Sidebar(Task List 등)가 형제
 * 요소로 추가돼도 이 영역이 자동으로 줄어들 뿐, 지금 구조를 바꿀 필요가
 * 없다(요청사항 1/10). 그 안에서 실제 대화 내용은 다시 `mx-auto max-w-3xl`로
 * 가운데 정렬한다.
 */
export function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  function appendAssistantMessage(result: ChatCommandResult) {
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "ASSISTANT", result }]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    setMessages((prev) => [...prev, { id: nextMessageId(), role: "USER", text }]);
    setInput("");
    setIsSending(true);

    const res = await runChatCommandAction({ message: text });
    const result: ChatCommandResult = res.result ?? {
      kind: "TEXT",
      message: res.error ?? "요청을 처리하지 못했습니다.",
    };
    appendAssistantMessage(result);
    setIsSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
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
                <UserMessage key={m.id} text={m.text} />
              ) : (
                <AssistantMessage key={m.id} result={m.result} onExecuted={appendAssistantMessage} />
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
            disabled={!input.trim() || isSending}
            sending={isSending}
          />
        </div>
      </div>
    </div>
  );
}
