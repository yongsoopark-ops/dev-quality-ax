const TONE_CLASS = {
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
} as const;

/**
 * 단일 문장짜리 오류/경고(예: "Spreadsheet에 접근할 수 없습니다.", STALE
 * 안내)용 최소 배너. ChatResultCard(제목+상태+Grid)를 억지로 씌우지 않고
 * 폭/여백/typography만 기존보다 넓고 읽기 좋게 다듬는다(요청사항 5).
 */
export function ChatMessageBanner({ tone, message }: { tone: keyof typeof TONE_CLASS; message: string }) {
  return (
    <div className={`w-full rounded-xl border px-4 py-3 text-sm leading-relaxed ${TONE_CLASS[tone]}`}>{message}</div>
  );
}
