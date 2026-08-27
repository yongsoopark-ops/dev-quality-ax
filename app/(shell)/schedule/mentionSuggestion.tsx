"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionOptions } from "@tiptap/suggestion";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { MENTION_ALL_ID } from "@/lib/schedule/mention";
import type { ScheduleUser } from "@/lib/schedule/types";

/** 자동완성 목록에 보여줄 후보 1건 — @All은 User가 아니라 이 모양의 합성 항목이다. */
interface MentionItem {
  id: string;
  label: string;
  sublabel?: string;
}

/** Mention Node에 실제로 저장될 값 — Tiptap Mention 확장의 attrs 타입(MentionNodeAttrs)을
 * 그대로 쓴다. AI로 이름을 추론/매칭하지 않고, 여기 전달된 id/label을 그대로
 * Tiptap Mention Node의 attrs로 신뢰한다(요청사항 13). */
type MentionSelection = MentionNodeAttrs;

function buildItems(users: ScheduleUser[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase();
  const matchesAll = q === "" || "전체".includes(q) || "all".includes(q);

  const userItems = users
    .map((u): MentionItem => ({ id: u.id, label: u.name ?? u.email, sublabel: u.email }))
    .filter((item) => q === "" || item.label.toLowerCase().includes(q) || item.sublabel!.toLowerCase().includes(q));

  const items: MentionItem[] = [];
  if (matchesAll) items.push({ id: MENTION_ALL_ID, label: "전체" });
  items.push(...userItems);
  return items.slice(0, 8);
}

const MentionList = forwardRef<
  { onKeyDown: (props: SuggestionKeyDownProps) => boolean },
  { items: MentionItem[]; command: (item: MentionSelection) => void }
>(function MentionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  function select(index: number) {
    const item = items[index];
    if (!item) return;
    command({ id: item.id, label: item.label });
  }

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        select(selected);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-56 rounded-md border border-navy-100 bg-white px-3 py-2 text-xs text-navy-950/40 shadow-lg">
        일치하는 사용자가 없습니다.
      </div>
    );
  }

  return (
    <div className="max-h-56 w-56 overflow-y-auto rounded-md border border-navy-100 bg-white py-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          // click 시 Editor의 focus/selection이 먼저 풀리지 않도록 mousedown에서
          // preventDefault 후 처리한다(Composer의 다른 버튼들과 동일한 패턴).
          onMouseDown={(e) => {
            e.preventDefault();
            select(i);
          }}
          className={`flex w-full flex-col px-3 py-1.5 text-left text-xs ${i === selected ? "bg-navy-50" : "hover:bg-navy-50"}`}
        >
          <span className="font-medium text-navy-950">
            {item.id === MENTION_ALL_ID ? "전체 (All)" : item.label}
          </span>
          {item.sublabel && <span className="text-navy-950/40">{item.sublabel}</span>}
        </button>
      ))}
    </div>
  );
});

/**
 * "@" 입력 시 뜨는 자동완성 목록 — ACTIVE User 목록(요청사항 11, page.tsx가 이미
 * status="ACTIVE"로 필터링해 내려준 값)만 후보로 노출하고, "전체"/"all"이 쿼리에
 * 맞으면 @All 항목도 함께 보여준다. 이름 매칭은 순수 문자열 포함 비교뿐이며
 * AI 호출은 전혀 없다(요청사항 13).
 *
 * 위치 계산은 @tiptap/suggestion이 내장 제공하는 `props.mount()`(Floating UI 기반
 * 자동 앵커링/스크롤 추적/외부 클릭 dismiss)를 그대로 쓴다 — tippy.js 같은 추가
 * 라이브러리를 새로 설치하지 않는다.
 */
export function buildMentionSuggestion(users: ScheduleUser[]): Partial<SuggestionOptions<MentionItem, MentionSelection>> {
  return {
    items: ({ query }) => buildItems(users, query),
    render: () => {
      let component: ReactRenderer<{ onKeyDown: (props: SuggestionKeyDownProps) => boolean }>;
      let unmount: (() => void) | undefined;

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });
          // props.mount()은 위치(top/left/right/bottom)만 계산해 줄 뿐 z-index는
          // 정하지 않는다 — Task 상세 Modal(z-50)/Update Modal(z-60)이 각각 별도
          // stacking context를 만들기 때문에, DOM 순서상 나중에 body에 붙어도
          // z-index:auto인 채로는 두 Modal 뒤에 가려진다. Update Modal보다 높은
          // 값을 명시해 항상 그 위에 뜨도록 한다.
          component.element.style.zIndex = "70";
          unmount = props.mount(component.element);
        },
        onUpdate: (props) => {
          component.updateProps({ items: props.items, command: props.command });
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            unmount?.();
            return true;
          }
          return component.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          unmount?.();
          component.destroy();
        },
      };
    },
  };
}
