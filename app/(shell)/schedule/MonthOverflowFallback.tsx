"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, startOfMonth, startOfWeek } from "date-fns";
import { eventsOnDay } from "@/lib/schedule/monthOverflow";
import type { CalendarTaskEvent } from "@/lib/schedule/calendarMapper";
import type { TaskWithRelations } from "@/lib/schedule/types";
import type { View } from "react-big-calendar";

/**
 * Step(Final Fix — Month 더보기 강제 보장 / Final UI Fix — 더보기 전용 영역
 * 확보) — react-big-calendar가 "이 주에 몇 개 event가 들어가는지" 계산하는
 * 내부 로직은 순수 CSS로 바꿀 방법이 없음을 실측으로 확인했다(.rbc-event
 * min-height를 20~45px로 바꿔봐도 표시 개수가 전혀 안 변함, 라이브러리
 * 내부 patch 없이는 "몇 개를 보여줄지" 결정 자체를 바꿀 수 없다). 그래서
 * 라이브러리를 건드리지 않고 그 렌더 "결과"만 매번 다시 스캔해서, 라이브러리가
 * 이미 "+N 더보기"를 만든 날짜는 그대로 두고, 아예 만들지 않았는데 실제로는
 * 숨겨진 일정이 있는 날짜에만 우리 자체 "+N 더보기" 배지를 표시한다.
 *
 * 배지의 좌표 기준은 CalendarView.tsx의 CSS(.rbc-month-row[data-more-slot="1"]
 * .rbc-addons-dnd-row-body에 padding-bottom + overflow: hidden으로 "더보기
 * 전용 줄"을 실제 layout으로 예약)와 반드시 짝을 맞춘다 — 그 CSS가 일정
 * Bar 픽셀이 절대 들어올 수 없다고 보장하는 바로 그 여백에 배지를 꽂아야
 * native show-more와 마찬가지로 일정 Bar와 절대 겹치지 않는다(이전
 * 버전은 row 전체의 bottom에 그냥 겹쳐 그리는 방식이라 여전히 살아있는
 * 일정 Bar 위에 얹히는 문제가 있었다).
 *
 * data-more-slot 속성은 이 파일이 매 스캔마다 직접 붙이고 뗀다 — 모든
 * 주에 무조건 미리 예약해두면(실측 확인) 원래 여유가 딱 맞던 주까지
 * 불필요하게 더 좁아지는 부작용이 있어서, "이 주는 실제로 +N이
 * 필요하다"(라이브러리 자체 show-more가 있거나, 우리가 봐도 실제 Bar가
 * 이 주의 진짜 바닥선을 넘는다)고 판정된 주에만 켠다. 이 판정에 쓰는
 * "진짜 바닥선"(dndBody 자기 박스의 getBoundingClientRect().bottom)은
 * padding-bottom을 얼마나 주든 바뀌지 않는다(flex:1 아이템 자기 높이는
 * 부모가 배분한 만큼으로 고정, padding은 그 안쪽 content 영역만 줄인다)
 * — 그래서 이전 스캔에서 이미 이 속성을 붙였든 안 붙였든 항상 같은
 * 기준으로 안정적으로 판정할 수 있다. MORE_SLOT_HEIGHT 상수 값을 바꾸면
 * CalendarView.tsx의 padding-bottom/absolute height도 반드시 같이
 * 바꿔야 한다.
 *
 * 일정 데이터·Month drag/drop 로직은 전혀 건드리지 않는다(순수 표시
 * 레이어 위에 얹는 오버레이 — 단, 겹침 자체는 CalendarView.tsx의 CSS가
 * 실제 layout에서 막아준다).
 */

interface OverflowBadge {
  key: string;
  top: number;
  left: number;
  width: number;
  hiddenCount: number;
  dayEvents: CalendarTaskEvent[];
}

// CalendarView.tsx의 padding-bottom/absolute height와 반드시 같은 값 —
// 그 CSS가 실제로 예약하는 "더보기 전용 줄" 높이다.
const MORE_SLOT_HEIGHT = 16;

function scanOverflow(container: HTMLElement, events: CalendarTaskEvent[], viewDate: Date): OverflowBadge[] {
  const containerRect = container.getBoundingClientRect();
  const gridStart = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 });
  const monthRows = [...container.querySelectorAll(".rbc-month-row")];
  const badges: OverflowBadge[] = [];

  monthRows.forEach((row, rowIndex) => {
    const dateCells = [...row.querySelectorAll(".rbc-date-cell")];
    const dndBody = row.querySelector(".rbc-addons-dnd-row-body");
    if (!dndBody) return;
    const levels = [...dndBody.children];
    // dndBody 자기 박스의 bottom(getBoundingClientRect)은 padding-bottom을
    // 얼마나 주든 바뀌지 않는다 — flex:1 아이템 자기 높이는 부모(row)가
    // 배분한 만큼으로 고정되고, padding은 그 안쪽 content 영역만 줄인다.
    // 그래서 이 값은 data-more-slot을 아직 안 붙였든 이미 붙어 있든
    // 항상 안정적인 "이 주의 진짜 바닥선" 역할을 한다.
    const rowFloor = dndBody.getBoundingClientRect().bottom;

    // 이 주에 "더보기 전용 줄"이 실제로 필요한지 먼저 판정한다 — (a)
    // 라이브러리가 이미 자기 판단으로 show-more를 만들었거나, (b) 우리가
    // 봐도 실제 일정 Bar가 이 주의 진짜 바닥선을 넘는다(원래도 clipping이
    // 있었다는 뜻). 둘 다 아니면 이 주는 원래 여유가 있었다는 뜻이라
    // 전용 줄을 새로 만들 필요가 없다 — 불필요하게 멀쩡한 Bar까지 줄이는
        // 부작용을 막는다(실측 확인: 모든 주에 무조건 예약해두면 원래 여유가
    // 빠듯한 주는 이미 딱 맞게 보이던 Bar까지 더 줄어들었다).
    const hasNativeShowMore = !!row.querySelector(".rbc-show-more");
    let rawOverflow = false;
    if (!hasNativeShowMore) {
      rawOverflow = levels.some((level) =>
        [...level.children].some((segment) => {
          const eventEl = segment.querySelector(".rbc-event");
          return !!eventEl && eventEl.getBoundingClientRect().bottom > rowFloor + 0.5;
        }),
      );
    }
    const needsSlot = hasNativeShowMore || rawOverflow;
    if (needsSlot) row.setAttribute("data-more-slot", "1");
    else row.removeAttribute("data-more-slot");

    // 이 선을 넘는 Bar는 실제로 잘려서 안 보인다 — needsSlot이 true일 때만
    // CSS가 padding-bottom을 붙이므로(위 CalendarView.tsx 참고), 그때만
    // 바닥선에서 MORE_SLOT_HEIGHT만큼 끌어올린다.
    const clipLine = needsSlot ? rowFloor - MORE_SLOT_HEIGHT : rowFloor;

    dateCells.forEach((cell, dayIndex) => {
      // 라이브러리가 이미 "+N 더보기"를 만든 날짜는 손대지 않는다 — 우리
      // fallback과 절대 동시에 뜨지 않게 한다.
      if (cell.querySelector(".rbc-show-more")) return;

      let visibleCount = 0;
      let hasClipped = false;
      for (const level of levels) {
        const segment = level.children[dayIndex] as HTMLElement | undefined;
        if (!segment) continue;
        const eventEl = segment.querySelector(".rbc-event");
        if (!eventEl) continue;
        const eventRect = eventEl.getBoundingClientRect();
        if (eventRect.bottom > clipLine + 0.5) hasClipped = true;
        else visibleCount++;
      }
      // 잘린 Bar가 하나도 없으면(전부 온전히 보이면) 이 날짜는 fallback이
      // 필요 없다 — DOM을 매 스캔마다 훑는 이 오버레이가 "정상 상태"에서는
      // 아무것도 그리지 않는다는 것을 보장한다.
      if (!hasClipped) return;

      const cellDate = addDays(gridStart, rowIndex * 7 + dayIndex);
      const dayEvents = eventsOnDay(events, cellDate);
      const hiddenCount = dayEvents.length - visibleCount;
      if (hiddenCount <= 0) return;

      const cellRect = cell.getBoundingClientRect();
      badges.push({
        key: `${rowIndex}-${dayIndex}`,
        // CSS가 예약해 둔, 일정 Bar가 절대 못 들어오는 그 줄에 정확히
        // 맞춘다 — native show-more row와 완전히 같은 slot(CalendarView.tsx의
        // `.rbc-addons-dnd-row-body > .rbc-row:has(.rbc-show-more)` 규칙 참고).
        top: clipLine - containerRect.top,
        left: cellRect.left - containerRect.left,
        width: cellRect.width,
        hiddenCount,
        dayEvents,
      });
    });
  });

  return badges;
}

export function MonthOverflowFallback({
  containerRef,
  events,
  view,
  date,
  onSelectTask,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  events: CalendarTaskEvent[];
  view: View;
  date: Date;
  onSelectTask: (task: TaskWithRelations) => void;
}) {
  const [badges, setBadges] = useState<OverflowBadge[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // month 뷰가 아닐 때는 그냥 구독을 걸지 않는다(스캔도, observer도 없음).
    // badges/openKey는 렌더링 쪽에서 view==="month" 여부로 같이 가드하므로
    // 여기서 굳이 setState로 비워줄 필요가 없다 — effect 본문에서 무조건
    // 동기 setState를 호출하면 불필요한 cascading render가 생긴다는
    // react-hooks/set-state-in-effect 룰을 그대로 따른다.
    if (view !== "month") return;
    const container = containerRef.current;
    if (!container) return;

    let scheduled = false;
    function scan() {
      scheduled = false;
      const el = containerRef.current;
      if (!el) return;
      setBadges(scanOverflow(el, events, date));
    }
    function scheduleScan() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(scan);
    }

    scheduleScan();
    const resizeObserver = new ResizeObserver(scheduleScan);
    resizeObserver.observe(container);
    // react-big-calendar가 drag/resize, view 전환, popup 열고 닫기 등으로
    // 스스로 DOM을 다시 그릴 때마다(우리 React state와 무관하게) 다시
    // 스캔해야 하므로 MutationObserver로 그 변경 자체를 감지한다.
    const mutationObserver = new MutationObserver(scheduleScan);
    mutationObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [containerRef, events, view, date]);

  useEffect(() => {
    if (!openKey) return;
    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setOpenKey(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openKey]);

  // month 뷰를 벗어나면 badges/openKey가 이전 값 그대로 남아있어도(스캔을
  // 새로 안 돌렸을 뿐) 여기서 렌더 자체를 막아 화면에는 절대 나타나지
  // 않는다 — view === "month"로 돌아오면 effect가 다시 스캔해 최신화한다.
  if (view !== "month" || badges.length === 0) return null;

  const openBadge = badges.find((b) => b.key === openKey) ?? null;

  return (
    <>
      {badges.map((badge) => (
        <button
          key={badge.key}
          type="button"
          // CalendarView.tsx의 `.rbc-addons-dnd-row-body` CSS(padding-bottom
          // + overflow:hidden)가 이 top/height 영역엔 일정 Bar 픽셀이 아예
          // 들어올 수 없다고 실제 layout에서 보장한다 — 그래서 이 배지는
          // "일정 위에 덮어씌우는" 게 아니라 원래부터 비어 있는 전용 줄에
          // 얹히는 것뿐이다. z-index(30)는 혹시 모를 다른 겹침(예: 배경
          // 셀 강조 등)에 대한 방어용으로만 남겨둔다.
          onClick={() => setOpenKey((k) => (k === badge.key ? null : badge.key))}
          style={{ position: "absolute", top: badge.top, left: badge.left, width: badge.width, height: MORE_SLOT_HEIGHT, zIndex: 30 }}
          className="truncate rounded-sm bg-white/95 px-1.5 text-left text-[11px] font-medium text-navy-700 hover:bg-navy-50 hover:underline"
        >
          +{badge.hiddenCount} 더보기
        </button>
      ))}

      {openBadge && (
        <div
          ref={popupRef}
          style={{ position: "absolute", top: openBadge.top + MORE_SLOT_HEIGHT, left: openBadge.left, zIndex: 40 }}
          className="max-h-64 w-56 overflow-y-auto rounded-lg border border-navy-100 bg-white p-1.5 shadow-lg"
        >
          {openBadge.dayEvents.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => {
                onSelectTask(event.task);
                setOpenKey(null);
              }}
              className="block w-full truncate rounded px-2 py-1 text-left text-xs text-navy-950/80 hover:bg-navy-50"
              title={event.title}
            >
              {event.title}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
