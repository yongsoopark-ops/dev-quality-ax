/**
 * 사용자 메시지 말풍선 — 기존 UX 의미(우측 정렬, navy 배경, 흰 글자) 그대로
 * 유지한다. break-all 대신 break-words를 써서 일반 문장은 단어 단위로,
 * 끊어지지 않는 긴 URL/파일명은 필요할 때만 강제로 줄바꿈한다(요청사항 2).
 *
 * Step 2(회의록 입력 흐름) — 텍스트 없이 첨부 파일만 제출한 경우도 이
 * 컴포넌트 하나로 표현한다. `attachmentName`이 있으면 말풍선 안에 작은
 * 파일 chip을 붙이고, text가 비어 있으면 chip만 보여준다.
 */
export function UserMessage({ text, attachmentName }: { text: string; attachmentName?: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1.5 rounded-2xl bg-navy-900 px-4 py-2.5 text-sm leading-relaxed text-white sm:max-w-[70%]">
        {attachmentName && (
          <p className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1 text-xs">
            <span aria-hidden>📎</span>
            <span className="min-w-0 truncate">{attachmentName}</span>
          </p>
        )}
        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
      </div>
    </div>
  );
}
