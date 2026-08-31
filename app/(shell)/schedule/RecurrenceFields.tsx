"use client";

import {
  MONTHLY_WEEK_ORDINAL_LABELS,
  MONTHLY_WEEK_ORDINAL_OPTIONS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  type Weekday,
} from "@/lib/schedule/recurrence";
import type { TaskFormInput } from "@/lib/schedule/types";
import { DateTextInput } from "./DateTextInput";

const inputClass = "w-full rounded-md border border-navy-100 px-3 py-1.5 text-sm";
const labelClass = "text-xs font-medium text-navy-950/60";

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
        active ? "border-navy-900 bg-navy-900 text-white" : "border-navy-100 text-navy-950/60 hover:bg-navy-50"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Step 5B-1(반복 일정) — 업무 구분과 무관하게(MEETING/일반 모두) 공용으로 쓰는
 * 반복 설정 UI. 실제 값 소유/검증은 TaskDetailPanel의 input state가 그대로
 * 갖고 있고, 여기는 순수 표현 + onChange 위임만 한다(다른 FormRow와 동일한
 * 패턴). recurrenceType이 "NONE"(기본값)이면 아래 상세 옵션은 아예 렌더하지
 * 않는다 — 기존 1회성 일정 흐름에는 어떤 영향도 없다.
 */
export function RecurrenceFields({
  input,
  onChange,
}: {
  input: TaskFormInput;
  onChange: <K extends keyof TaskFormInput>(key: K, value: TaskFormInput[K]) => void;
}) {
  function toggleWeekday(w: Weekday) {
    onChange(
      "recurrenceWeekdays",
      input.recurrenceWeekdays.includes(w) ? input.recurrenceWeekdays.filter((x) => x !== w) : [...input.recurrenceWeekdays, w],
    );
  }

  return (
    <div className="space-y-2">
      <label className={labelClass}>반복</label>
      <div className="flex gap-1.5">
        <SegButton active={input.recurrenceType === "NONE"} onClick={() => onChange("recurrenceType", "NONE")}>
          반복 없음
        </SegButton>
        <SegButton active={input.recurrenceType === "WEEKLY"} onClick={() => onChange("recurrenceType", "WEEKLY")}>
          매주
        </SegButton>
        <SegButton active={input.recurrenceType === "MONTHLY"} onClick={() => onChange("recurrenceType", "MONTHLY")}>
          매월
        </SegButton>
      </div>

      {input.recurrenceType !== "NONE" && (
        <div className="space-y-3 rounded-md border border-navy-100 bg-white p-3">
          {input.recurrenceType === "WEEKLY" && (
            <div className="space-y-1">
              <label className={labelClass}>반복 요일</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_ORDER.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => toggleWeekday(w)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium ${
                      input.recurrenceWeekdays.includes(w)
                        ? "border-navy-900 bg-navy-900 text-white"
                        : "border-navy-100 text-navy-950/60 hover:bg-navy-50"
                    }`}
                  >
                    {WEEKDAY_LABELS[w]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {input.recurrenceType === "MONTHLY" && (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <SegButton
                  active={input.recurrenceMonthlyRuleType === "DAY_OF_MONTH"}
                  onClick={() => onChange("recurrenceMonthlyRuleType", "DAY_OF_MONTH")}
                >
                  매월 특정 날짜
                </SegButton>
                <SegButton
                  active={input.recurrenceMonthlyRuleType === "NTH_WEEKDAY"}
                  onClick={() => onChange("recurrenceMonthlyRuleType", "NTH_WEEKDAY")}
                >
                  N번째 요일
                </SegButton>
              </div>

              {input.recurrenceMonthlyRuleType === "DAY_OF_MONTH" && (
                <div className="space-y-1">
                  <label className={labelClass}>매월</label>
                  <select className={inputClass} value={input.recurrenceMonthDay} onChange={(e) => onChange("recurrenceMonthDay", e.target.value)}>
                    <option value="">날짜 선택</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}일
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {input.recurrenceMonthlyRuleType === "NTH_WEEKDAY" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className={labelClass}>몇째 주</label>
                    <select
                      className={inputClass}
                      value={input.recurrenceMonthlyWeekOrdinal}
                      onChange={(e) => onChange("recurrenceMonthlyWeekOrdinal", e.target.value)}
                    >
                      <option value="">선택</option>
                      {MONTHLY_WEEK_ORDINAL_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {MONTHLY_WEEK_ORDINAL_LABELS[o]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>요일</label>
                    <select
                      className={inputClass}
                      value={input.recurrenceMonthlyWeekday}
                      onChange={(e) => onChange("recurrenceMonthlyWeekday", e.target.value as Weekday)}
                    >
                      <option value="">선택</option>
                      {WEEKDAY_ORDER.map((w) => (
                        <option key={w} value={w}>
                          {WEEKDAY_LABELS[w]}요일
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label className={labelClass}>반복 종료일 (선택)</label>
            <DateTextInput className={inputClass} value={input.recurrenceEndDate} onChange={(v) => onChange("recurrenceEndDate", v)} />
            <p className="text-[11px] text-navy-950/40">비워두면 종료일 없이 계속 반복됩니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
