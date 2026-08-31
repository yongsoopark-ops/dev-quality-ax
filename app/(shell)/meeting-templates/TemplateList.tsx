"use client";

import { MEETING_TEMPLATE_TYPE_LABELS } from "@/lib/meetingTemplates/constants";
import type { MeetingTemplateInfo } from "@/lib/meetingTemplates/actions";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 요청사항: 목록에서 최소 이름/회의 유형/사용 중 여부/최근 수정을 확인할 수
 * 있어야 한다. 클릭하면 Editor로 진입한다(수정). */
export function TemplateList({
  templates,
  loadError,
  onSelect,
  onCreateNew,
}: {
  templates: MeetingTemplateInfo[];
  loadError: string | null;
  onSelect: (template: MeetingTemplateInfo) => void;
  onCreateNew: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-navy-950/60">{templates.length}개의 Template</p>
        <button
          type="button"
          onClick={onCreateNew}
          className="rounded-md bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-navy-800"
        >
          + 새 양식 생성
        </button>
      </div>

      {loadError && <p className="text-xs text-red-600">{loadError}</p>}

      {templates.length === 0 ? (
        <p className="rounded-md border border-navy-100 bg-navy-50/60 p-6 text-center text-sm text-navy-950/50">
          아직 등록된 Template이 없습니다. &quot;새 양식 생성&quot;으로 시작하세요.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-navy-100">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-navy-100 bg-navy-50/60 text-xs text-navy-950/50">
              <tr>
                <th className="px-3 py-2 font-medium">Template 이름</th>
                <th className="px-3 py-2 font-medium">회의 유형</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">최근 수정</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => onSelect(t)}
                  className="cursor-pointer border-b border-navy-100 last:border-b-0 hover:bg-navy-50/60"
                >
                  <td className="px-3 py-2 font-medium text-navy-950">{t.name}</td>
                  <td className="px-3 py-2 text-navy-950/70">{MEETING_TEMPLATE_TYPE_LABELS[t.meetingType]}</td>
                  <td className="px-3 py-2">
                    {t.isActive ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        사용 중
                      </span>
                    ) : (
                      <span className="text-[11px] text-navy-950/30">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-navy-950/50">
                    {formatDateTime(t.updatedAt)}
                    {t.updatedByName ? ` · ${t.updatedByName}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
