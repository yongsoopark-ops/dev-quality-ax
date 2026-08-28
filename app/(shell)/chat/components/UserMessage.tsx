/**
 * 사용자 메시지 말풍선 — 기존 UX 의미(우측 정렬, navy 배경, 흰 글자) 그대로
 * 유지한다. break-all 대신 break-words를 써서 일반 문장은 단어 단위로,
 * 끊어지지 않는 긴 URL/파일명은 필요할 때만 강제로 줄바꿈한다(요청사항 2).
 */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-navy-900 px-4 py-2.5 text-sm leading-relaxed text-white sm:max-w-[70%]">
        {text}
      </p>
    </div>
  );
}
