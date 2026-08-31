"use client";

import { useRef, useState } from "react";
import type { ChatAttachmentPolicy } from "@/lib/chat/attachments";

export interface ChatComposerAttachment {
  policy: ChatAttachmentPolicy;
  file: File | null;
  error: string | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
}

/**
 * 하단 입력 영역 — ChatGPT 스타일의 rounded Composer(요청사항 7). send
 * 동작/disabled 조건은 ChatClient가 그대로 갖고 있고, 여기는 순수 표현만
 * 담당한다.
 *
 * 공통 파일 첨부 기반(Step 1) — `attachment`가 없으면(W3/W4처럼 URL 전용
 * Skill) 첨부 버튼 자체를 렌더링하지 않는다. 있으면 첨부 버튼 + 선택된
 * 파일명 chip + 오류 문구까지 이 컴포넌트가 그린다. 실제 검증(형식/크기)은
 * lib/chat/attachments.ts가 하고, 여기는 선택된 File을 그대로 위로
 * 올려보낼 뿐이다(내용을 읽거나 변환하지 않는다).
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onKeyDown,
  disabled,
  sending,
  placeholder,
  attachment,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  sending: boolean;
  /** 선택된 작업에 따라 달라지는 안내 문구(요청사항 11). 없으면 기본값을 쓴다. */
  placeholder?: string;
  attachment?: ChatComposerAttachment;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Step 3(Drag & Drop) — dragenter/dragleave는 자식 요소를 넘나들 때마다도
  // 반복 발생해 진입/이탈 카운트를 세지 않으면 중간에 깜빡인다. 카운터로
  // "지금 실제로 Composer 위에 있는지"만 판단한다.
  const dragCounterRef = useRef(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 선택해도 change가 다시 발생하도록 즉시 비워 둔다
    // (요청사항: 제거 후 동일 파일 재선택 가능).
    e.target.value = "";
    if (file) attachment?.onSelect(file);
  }

  // 첨부 미지원 Skill(W3/W4 등)에서도 dragOver/drop 기본 동작(브라우저가 파일을
  // 열어버리는 것)만은 항상 막는다 — 실제로 파일을 받는 것은 attachment가
  // 있을 때뿐이다.
  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!attachment) return;
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!attachment) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingOver(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    if (!attachment) return;
    // 이미 첨부가 있어도 새로 Drop한 파일로 교체한다(요청사항) — onSelect가
    // 검증 후 그대로 덮어쓴다(버튼으로 다시 고르는 것과 동일 경로).
    const file = e.dataTransfer.files?.[0];
    if (file) attachment.onSelect(file);
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`rounded-2xl border p-2.5 shadow-sm transition-colors ${
        isDraggingOver ? "border-navy-400 bg-navy-50" : "border-navy-100 bg-white"
      }`}
    >
      {attachment?.file && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs text-navy-950/80">
          <span aria-hidden>📎</span>
          <span className="min-w-0 flex-1 truncate">{attachment.file.name}</span>
          <button
            type="button"
            onClick={attachment.onRemove}
            aria-label="첨부 파일 제거"
            className="shrink-0 rounded-full px-1.5 py-0.5 text-navy-950/50 hover:bg-navy-100 hover:text-navy-950"
          >
            ✕
          </button>
        </div>
      )}
      {attachment?.error && <p className="mb-2 text-xs text-red-600">{attachment.error}</p>}

      <div className="flex items-end gap-2">
        {attachment && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={attachment.policy.acceptedFileTypes.join(",")}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="파일 첨부"
              className="mb-0.5 shrink-0 self-center rounded-full border border-navy-100 px-2.5 py-2 text-sm text-navy-950/60 hover:bg-navy-50"
            >
              📎
            </button>
          </>
        )}
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "업무 요청을 입력하세요"}
          className="max-h-40 flex-1 resize-none self-center rounded-lg px-2.5 py-2 text-sm leading-relaxed text-navy-950 placeholder:text-navy-950/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled}
          className="shrink-0 rounded-full bg-navy-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {sending ? "전송 중..." : "Send"}
        </button>
      </div>
    </div>
  );
}
