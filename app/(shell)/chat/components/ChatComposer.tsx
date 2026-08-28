"use client";

/**
 * 하단 입력 영역 — ChatGPT 스타일의 rounded Composer로 정리한다(요청사항 7).
 * send 동작/disabled 조건은 ChatClient가 그대로 갖고 있고, 여기는 순수
 * 표현만 담당한다. 향후 파일 첨부 버튼을 넣을 자리를 좌측에 미리 비워 둔다
 * (지금은 렌더링하지 않는다 — 기능 추가 금지 원칙).
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onKeyDown,
  disabled,
  sending,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  sending: boolean;
}) {
  return (
    <div className="flex items-end gap-2 rounded-2xl border border-navy-100 bg-white p-2.5 shadow-sm">
      {/* 향후 파일 첨부 버튼 자리 — 이번 Step에서는 기능을 추가하지 않는다. */}
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="업무 요청을 입력하세요"
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
  );
}
