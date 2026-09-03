"use client";

/**
 * 24시간제 전용 시간 선택 — 브라우저/OS 로케일에 따라 <input type="time">이
 * AM/PM 형태로 보일 수 있는 것을 완전히 배제하기 위해 시(00~23)/분 Select
 * 2개로 직접 구현한다. 값은 항상 "HH:mm" 문자열이며, 기존 datetime 결합
 * 로직(actions.ts)과 그대로 호환된다.
 */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
/** Step 5B-8(5분 단위) — 예전엔 15분 단위였다. 이미 저장된 값이 5분 단위가
 * 아닌 경우(과거 데이터)는 아래 minuteOptions에서 현재 값을 목록에 끼워 넣어
 * 보여준다 — CategorySelect/StatusSegmented의 "현재 선택된 값은 비활성이어도
 * 목록에 남긴다" 규칙과 같은 이유다(그러지 않으면 select가 빈 값처럼 보이고,
 * 저장하지 않고 다른 필드만 바꿔도 시간이 조용히 다른 값으로 바뀔 수 있다). */
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

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
  const minuteOptions = minute && !MINUTES.includes(minute) ? [...MINUTES, minute].sort() : MINUTES;

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
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
