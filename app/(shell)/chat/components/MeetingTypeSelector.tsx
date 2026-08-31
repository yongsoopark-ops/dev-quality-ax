import { MEETING_TYPE_OPTIONS, type MeetingType } from "@/lib/chat/meetingTypes";

/**
 * 회의 유형 선택 UX(Step 3) — 별도 카드/모달 없이 Assistant 메시지 흐름
 * 안에 버튼 목록만 놓는다("간단한 선택 UX" 요청). 한 번 선택하면(`selected`
 * 가 채워지면) 버튼을 비활성화하고 고른 항목만 강조해 그대로 대화 이력에
 * 남긴다 — 다른 메시지들처럼 지우거나 되돌리지 않는다.
 */
export function MeetingTypeSelector({
  selected,
  onSelect,
}: {
  selected: MeetingType | null;
  onSelect: (type: MeetingType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {MEETING_TYPE_OPTIONS.map((option) => {
        const isChosen = selected === option.id;
        const isAnswered = selected !== null;
        return (
          <button
            key={option.id}
            type="button"
            disabled={isAnswered}
            aria-pressed={isChosen}
            onClick={() => onSelect(option.id)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 focus-visible:ring-offset-1 ${
              isChosen
                ? "border-navy-900 bg-navy-900 text-white"
                : isAnswered
                  ? "border-navy-100 text-navy-950/30"
                  : "border-navy-100 text-navy-950/70 hover:bg-navy-50"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
