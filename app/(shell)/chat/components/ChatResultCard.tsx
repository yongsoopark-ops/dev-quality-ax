import type { ReactNode } from "react";
import { ChatStatus, type ChatStatusKind } from "./ChatStatus";

/**
 * 구조화된 자동화 결과(Preflight/실행 결과 등) 공용 카드 셸. 일반 Assistant
 * 텍스트 메시지(AssistantTextMessage)와 시각적으로 뚜렷이 구분되도록 border +
 * 옅은 그림자를 쓴다 — 그 외의 장식은 최소화한다. Conversation Column
 * 대부분 폭(w-full)을 쓰고, 내부 정보는 MetricGrid/목록으로 배치해
 * 세로로만 길어지지 않게 한다.
 */
export function ChatResultCard({
  title,
  status,
  statusLabel,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  status: ChatStatusKind;
  statusLabel: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full space-y-4 rounded-xl border border-navy-100 bg-white p-4 text-sm shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-navy-950">{title}</p>
          {subtitle}
        </div>
        <ChatStatus status={status} label={statusLabel} />
      </div>

      <div className="space-y-4">{children}</div>

      {footer && <div className="border-t border-navy-100 pt-3">{footer}</div>}
    </div>
  );
}
