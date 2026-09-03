"use client";

import {
  MONTHLY_WEEK_ORDINAL_LABELS,
  MONTHLY_WEEK_ORDINAL_OPTIONS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  describeRecurrenceRule,
  type RecurrenceRule,
  type Weekday,
} from "@/lib/schedule/recurrence";
import type { TaskFormInput } from "@/lib/schedule/types";
import { DateTextInput } from "./DateTextInput";

const inputClass = "w-full rounded-md border border-navy-100 px-3 py-1.5 text-sm";
const labelClass = "text-xs font-medium text-navy-950/60";
const numberInputClass = "w-16 rounded-md border border-navy-100 px-2 py-1.5 text-sm";

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

const RECURRENCE_TYPE_LABELS: Record<"DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY", string> = {
  DAILY: "매일",
  WEEKLY: "매주",
  MONTHLY: "매월",
  YEARLY: "매년",
};

const INTERVAL_SUFFIX: Record<"DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY", string> = {
  DAILY: "일마다",
  WEEKLY: "주마다",
  MONTHLY: "개월마다",
  YEARLY: "년마다",
};

/**
 * Step(반복 일정 UX 개선) — 다우오피스 UX를 참고하되(동일 복제 아님) 일정
 * 등록 Modal 안의 compact sub-panel로 구현한다(별도 대형 modal 없음). "반복
 * 없음/반복 설정"을 먼저 고르고, 반복 설정을 켜면 "매일/매주/매월/매년" 탭 +
 * 그 유형에 필요한 옵션만 표시한다(요청사항 16: 선택한 유형에 필요한 옵션만,
 * 불필요한 옵션은 숨김). 실제 값 소유/검증은 TaskDetailPanel의 input state가
 * 그대로 갖고 있고, 여기는 순수 표현 + onChange 위임만 한다.
 *
 * anchorDateStr(카테고리에 따라 startDate 또는 meetingDate) — "시작일"
 * 읽기전용 표시(요청사항 14, 별도 재입력 없음)와 YEARLY 요약("매년 M월 D일")
 * 계산에만 쓰인다.
 */
export function RecurrenceFields({
  input,
  anchorDateStr,
  onChange,
}: {
  input: TaskFormInput;
  anchorDateStr: string;
  onChange: <K extends keyof TaskFormInput>(key: K, value: TaskFormInput[K]) => void;
}) {
  const enabled = input.recurrenceType !== "NONE";
  const activeType = input.recurrenceType === "NONE" ? "WEEKLY" : input.recurrenceType;

  function toggleWeekday(w: Weekday) {
    onChange(
      "recurrenceWeekdays",
      input.recurrenceWeekdays.includes(w) ? input.recurrenceWeekdays.filter((x) => x !== w) : [...input.recurrenceWeekdays, w],
    );
  }

  const rule: RecurrenceRule = {
    type: input.recurrenceType,
    interval: Number(input.recurrenceInterval) || 1,
    weekdays: input.recurrenceWeekdays,
    monthlyRuleType: input.recurrenceType === "MONTHLY" ? input.recurrenceMonthlyRuleType : null,
    monthDay: input.recurrenceMonthDay ? Number(input.recurrenceMonthDay) : null,
    monthlyWeekOrdinal: input.recurrenceMonthlyWeekOrdinal ? Number(input.recurrenceMonthlyWeekOrdinal) : null,
    monthlyWeekday: input.recurrenceMonthlyWeekday,
    endDate: input.recurrenceEndType === "DATE" ? input.recurrenceEndDate || null : null,
    count: input.recurrenceEndType === "COUNT" ? Number(input.recurrenceCount) || null : null,
  };
  const anchorDate = anchorDateStr ? new Date(`${anchorDateStr}T00:00:00`) : new Date();
  const summary = describeRecurrenceRule(rule, anchorDate);

  return (
    <div className="space-y-2">
      <label className={labelClass}>반복</label>
      <div className="flex gap-1.5">
        <SegButton active={!enabled} onClick={() => onChange("recurrenceType", "NONE")}>
          반복 없음
        </SegButton>
        <SegButton active={enabled} onClick={() => enabled || onChange("recurrenceType", "WEEKLY")}>
          반복 설정
        </SegButton>
      </div>

      {enabled && (
        <div className="space-y-3 rounded-md border border-navy-100 bg-white p-3">
          <div className="flex gap-1.5">
            {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const).map((t) => (
              <SegButton key={t} active={activeType === t} onClick={() => onChange("recurrenceType", t)}>
                {RECURRENCE_TYPE_LABELS[t]}
              </SegButton>
            ))}
          </div>

          {/* Step(요청사항 8~11) — interval은 DAILY/WEEKLY/MONTHLY/YEARLY 공용
              필드다("격주를 별도 type으로 만들지 말고 기존 interval 재사용"과
              같은 원칙을 4종 전부에 적용). */}
          <div className="flex items-center gap-1.5">
            <span className={labelClass}>{RECURRENCE_TYPE_LABELS[activeType]}</span>
            <input
              type="number"
              min={1}
              step={1}
              className={numberInputClass}
              value={input.recurrenceInterval}
              onChange={(e) => onChange("recurrenceInterval", e.target.value)}
            />
            <span className="text-xs text-navy-950/60">{INTERVAL_SUFFIX[activeType]}</span>
          </div>

          {activeType === "WEEKLY" && (
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

          {activeType === "MONTHLY" && (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <SegButton
                  active={input.recurrenceMonthlyRuleType === "DAY_OF_MONTH"}
                  onClick={() => onChange("recurrenceMonthlyRuleType", "DAY_OF_MONTH")}
                >
                  같은 날짜
                </SegButton>
                <SegButton
                  active={input.recurrenceMonthlyRuleType === "NTH_WEEKDAY"}
                  onClick={() => onChange("recurrenceMonthlyRuleType", "NTH_WEEKDAY")}
                >
                  N번째 요일
                </SegButton>
              </div>

              {input.recurrenceMonthlyRuleType === "DAY_OF_MONTH" && (
                <select className={inputClass} value={input.recurrenceMonthDay} onChange={(e) => onChange("recurrenceMonthDay", e.target.value)}>
                  <option value="">날짜 선택</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}일
                    </option>
                  ))}
                </select>
              )}

              {input.recurrenceMonthlyRuleType === "NTH_WEEKDAY" && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={inputClass}
                    value={input.recurrenceMonthlyWeekOrdinal}
                    onChange={(e) => onChange("recurrenceMonthlyWeekOrdinal", e.target.value)}
                  >
                    <option value="">몇째</option>
                    {MONTHLY_WEEK_ORDINAL_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {MONTHLY_WEEK_ORDINAL_LABELS[o]}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputClass}
                    value={input.recurrenceMonthlyWeekday}
                    onChange={(e) => onChange("recurrenceMonthlyWeekday", e.target.value as Weekday)}
                  >
                    {WEEKDAY_ORDER.map((w) => (
                      <option key={w} value={w}>
                        {WEEKDAY_LABELS[w]}요일
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {activeType === "YEARLY" && (
            <p className="text-xs text-navy-950/60">
              매년 {anchorDate.getMonth() + 1}월 {anchorDate.getDate()}일(현재 일정 시작일 기준)에 반복됩니다.
            </p>
          )}

          {/* Step(요청사항 14) — 시작일은 항상 현재 일정의 시작일 그대로,
              별도 재입력을 받지 않는다. */}
          <div className="flex items-center gap-1.5">
            <label className={labelClass}>시작일</label>
            <span className="text-xs text-navy-950/70">{anchorDateStr || "-"}</span>
          </div>

          {/* Step(요청사항 12) — 종료 조건 3가지, 기본값 무한 반복. */}
          <div className="space-y-1">
            <label className={labelClass}>종료 조건</label>
            <div className="flex gap-1.5">
              <SegButton active={input.recurrenceEndType === "NONE"} onClick={() => onChange("recurrenceEndType", "NONE")}>
                무한 반복
              </SegButton>
              <SegButton active={input.recurrenceEndType === "DATE"} onClick={() => onChange("recurrenceEndType", "DATE")}>
                종료일 지정
              </SegButton>
              <SegButton active={input.recurrenceEndType === "COUNT"} onClick={() => onChange("recurrenceEndType", "COUNT")}>
                N회 반복
              </SegButton>
            </div>
            {input.recurrenceEndType === "DATE" && (
              <DateTextInput className={inputClass} value={input.recurrenceEndDate} onChange={(v) => onChange("recurrenceEndDate", v)} />
            )}
            {input.recurrenceEndType === "COUNT" && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className={numberInputClass}
                  value={input.recurrenceCount}
                  onChange={(e) => onChange("recurrenceCount", e.target.value)}
                />
                <span className="text-xs text-navy-950/60">회 반복</span>
              </div>
            )}
          </div>

          {/* Step(요청사항 15) — 저장 전 확인용 한 줄 요약. */}
          <p className="border-t border-navy-100 pt-2 text-xs font-medium text-navy-900">{summary}</p>
        </div>
      )}
    </div>
  );
}
