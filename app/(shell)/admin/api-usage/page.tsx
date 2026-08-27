import { prisma } from "@/lib/prisma";

const PROVIDER_CLASS: Record<string, string> = {
  GOOGLE: "bg-blue-50 text-blue-700 border-blue-200",
  OPENAI: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ANTHROPIC: "bg-amber-50 text-amber-700 border-amber-200",
  OTHER: "bg-navy-100/60 text-navy-950/60 border-navy-100",
};

const STATUS_CLASS: Record<string, string> = {
  SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

function formatDateTime(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatCost(value: number | null) {
  if (value === null) return "가격 정보 없음";
  return `$${value.toFixed(6)}`;
}

export default async function AdminApiUsagePage() {
  const records = await prisma.aIUsage.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: true },
    take: 200,
  });

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-navy-950">API 사용량</h1>
      <p className="mt-1 text-sm text-navy-950/60">
        Google / OpenAI / Anthropic AI API 호출의 Token·비용 기록입니다. Usage가
        정확히 기록되고 있는지 확인하기 위한 최소 조회 화면입니다. 이 화면 자체는
        외부 AI API를 호출하지 않습니다.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-navy-100">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-navy-100/40 text-xs text-navy-950/60">
            <tr>
              <th className="px-4 py-2 font-medium">일시</th>
              <th className="px-4 py-2 font-medium">사용자</th>
              <th className="px-4 py-2 font-medium">업무 유형</th>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">Input</th>
              <th className="px-4 py-2 text-right font-medium">Output</th>
              <th className="px-4 py-2 text-right font-medium">Cache Read</th>
              <th className="px-4 py-2 text-right font-medium">Cache Write</th>
              <th className="px-4 py-2 text-right font-medium">비용(USD)</th>
              <th className="px-4 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-navy-950/40">
                  기록된 API 사용량이 없습니다.
                </td>
              </tr>
            )}
            {records.map((record) => (
              <tr key={record.id} className="border-t border-navy-100">
                <td className="px-4 py-2 text-navy-950/70">
                  {formatDateTime(record.createdAt)}
                </td>
                <td className="px-4 py-2 text-navy-950/70">
                  {record.user.name ?? record.user.email}
                </td>
                <td className="px-4 py-2 text-navy-950/70">{record.taskType}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${PROVIDER_CLASS[record.provider]}`}
                  >
                    {record.provider}
                  </span>
                </td>
                <td className="px-4 py-2 text-navy-950/70">{record.model}</td>
                <td className="px-4 py-2 text-right text-navy-950/70">
                  {formatTokens(record.inputTokens)}
                </td>
                <td className="px-4 py-2 text-right text-navy-950/70">
                  {formatTokens(record.outputTokens)}
                </td>
                <td className="px-4 py-2 text-right text-navy-950/70">
                  {formatTokens(record.cacheReadTokens)}
                </td>
                <td className="px-4 py-2 text-right text-navy-950/70">
                  {formatTokens(record.cacheWriteTokens)}
                </td>
                <td className="px-4 py-2 text-right text-navy-950/70">
                  {formatCost(record.calculatedCostUsd)}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[record.status]}`}
                  >
                    {record.status}
                  </span>
                  {record.errorCode && (
                    <span className="ml-1 text-[11px] text-navy-950/40">
                      ({record.errorCode})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
