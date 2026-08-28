import type { ReactNode } from "react";

export interface MetricItem {
  label: string;
  value: ReactNode;
  tone?: "default" | "positive" | "warning";
}

const VALUE_TONE_CLASS: Record<NonNullable<MetricItem["tone"]>, string> = {
  default: "text-navy-950",
  positive: "text-emerald-700",
  warning: "text-amber-700",
};

/**
 * 결과 카드 안의 단일 수치 정보(예: "PW2 검사 항목 12건")를 한 줄씩 세로
 * 나열하는 대신 2~4열 Grid로 배치한다(요청사항 4). 공간이 좁아지면(모바일)
 * 자동으로 1~2열로 줄어든다 — 별도 breakpoint 계산 없이 Tailwind grid-cols
 * 반응형 클래스만 쓴다.
 */
export function MetricGrid({ items }: { items: MetricItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-navy-50/60 px-3 py-2">
          <p className="text-xs font-medium text-navy-950/50">{item.label}</p>
          <p className={`mt-0.5 text-sm font-medium ${VALUE_TONE_CLASS[item.tone ?? "default"]}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}
