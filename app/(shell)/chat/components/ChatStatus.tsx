export type ChatStatusKind = "SUCCESS" | "WARNING" | "ERROR" | "INFO";

/** Chat Result Card 상단에 붙는 상태 뱃지 — 기존 AX 저채도 색 언어(admin/schedule의
 * emerald/amber/red pill과 동일한 톤)를 그대로 재사용한다. 새 색을 추가하지 않는다. */
const STATUS_CLASS: Record<ChatStatusKind, string> = {
  SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WARNING: "bg-amber-50 text-amber-700 border-amber-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
  INFO: "bg-navy-100/60 text-navy-950/70 border-navy-100",
};

export function ChatStatus({ status, label }: { status: ChatStatusKind; label: string }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}>
      {label}
    </span>
  );
}
