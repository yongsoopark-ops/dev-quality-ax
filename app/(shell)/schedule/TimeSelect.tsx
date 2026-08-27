"use client";

/**
 * 24시간제 전용 시간 선택 — 브라우저/OS 로케일에 따라 <input type="time">이
 * AM/PM 형태로 보일 수 있는 것을 완전히 배제하기 위해 시(00~23)/분 Select
 * 2개로 직접 구현한다. 값은 항상 "HH:mm" 문자열이며, 기존 datetime 결합
 * 로직(actions.ts)과 그대로 호환된다.
 */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

export function TimeSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [hour, minute] = value ? value.split(":") : ["", ""];

  function setHour(h: string) {
    onChange(`${h}:${minute || "00"}`);
  }
  function setMinute(m: string) {
    onChange(`${hour || "00"}:${m}`);
  }

  return (
    <div className="flex items-center gap-1">
      <select className={className} value={hour} onChange={(e) => setHour(e.target.value)}>
        <option value="" disabled>
          시
        </option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-navy-950/50">:</span>
      <select className={className} value={minute} onChange={(e) => setMinute(e.target.value)}>
        <option value="" disabled>
          분
        </option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
