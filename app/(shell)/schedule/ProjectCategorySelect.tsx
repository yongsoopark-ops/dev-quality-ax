"use client";

import { useEffect, useRef, useState } from "react";
import { tintFromColor } from "@/lib/schedule/constants";
import type { ProjectCategoryGroupOption, ProjectCategoryOption } from "@/lib/schedule/types";

/**
 * Step 5B-5(프로젝트 카테고리 2단계 계층화) — 수십 개짜리 flat dropdown 대신
 * "대분류 → 중분류" 2단계 선택 + 검색 가능한 popover(요청사항 6: "화면 전체를
 * 덮는 긴 native dropdown이 되지 않게")로 바꾼다. 색상 원/칩은 실제
 * ProjectCategory.color(hex)를 그대로 쓴다(이모지 색 하드코딩 금지).
 */

interface PopoverOption {
  id: string;
  label: string;
  /** 있으면 옵션 앞에 색상 원을 그린다 — 대분류(Group)는 색이 없어 생략된다. */
  color?: string;
}

/** 이 select는 일정 등록 팝업의 스크롤 가능한 body(overflow-y-auto) 안에
 * 있고, 그 바깥 폼(form)은 overflow-hidden이다 — 실제 클리핑 경계는
 * window가 아니라 그 overflow-hidden/auto/scroll 조상이다. window.innerHeight를
 * 기준으로 삼으면(예: 700px 창) 폼 자체는 훨씬 작게(예: 590px) 잘려 있어도
 * "아래 공간이 충분하다"고 잘못 판단해 옵션 목록이 폼 밖으로 잘리는 채로
 * 열린다 — 실제 로그인 화면 DOM 측정으로 이 오차를 확인했다. */
function findClippingRect(el: HTMLElement): { top: number; bottom: number } {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (style.overflowY === "hidden" || style.overflowY === "auto" || style.overflowY === "scroll") {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

function PopoverSelect({
  value,
  options,
  placeholder,
  disabled,
  searchable,
  onChange,
}: {
  value: string;
  options: PopoverOption[];
  placeholder: string;
  disabled?: boolean;
  searchable?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openUpward, setOpenUpward] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      // 아래쪽 공간이 부족하고 위쪽이 더 넓으면 위로 펼친다(findClippingRect
      // 주석 참고 — window가 아니라 실제 overflow-hidden 조상 기준으로 계산).
      const rect = buttonRef.current.getBoundingClientRect();
      const clip = findClippingRect(buttonRef.current);
      const estimatedPanelHeight = (searchable ? 40 : 0) + 224 + 16;
      const spaceBelow = clip.bottom - rect.bottom;
      const spaceAbove = rect.top - clip.top;
      setOpenUpward(spaceBelow < estimatedPanelHeight && spaceAbove > spaceBelow);
    }
    setOpen((v) => !v);
  }

  const selected = options.find((o) => o.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery ? options.filter((o) => o.label.toLowerCase().includes(normalizedQuery)) : options;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        className="flex w-full items-center gap-1.5 rounded-md border border-navy-100 bg-white px-2.5 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:bg-navy-50/60 disabled:text-navy-950/30"
      >
        {selected?.color && (
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: selected.color }} />
        )}
        <span className={`min-w-0 flex-1 truncate ${selected ? "text-navy-950" : "text-navy-950/40"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span aria-hidden className="shrink-0 text-[9px] text-navy-950/40">
          ▾
        </span>
      </button>
      {open && !disabled && (
        <div
          className={`absolute left-0 z-30 w-56 rounded-md border border-navy-100 bg-white shadow-lg ${openUpward ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {searchable && (
            <div className="border-b border-navy-100 p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="검색"
                className="w-full rounded border border-navy-100 px-2 py-1 text-xs outline-none focus:border-navy-300"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-navy-50 ${
                  o.id === value ? "bg-navy-50 font-medium text-navy-950" : "text-navy-950/80"
                }`}
              >
                {o.color && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-1.5 text-xs text-navy-950/40">검색 결과가 없습니다.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const NONE_OPTION_ID = "";

export function ProjectCategorySelect({
  categoryId,
  onChange,
  categories,
  groups,
}: {
  categoryId: string;
  onChange: (id: string) => void;
  categories: ProjectCategoryOption[];
  groups: ProjectCategoryGroupOption[];
}) {
  // Task는 최종 카테고리(중분류) id만 저장한다(요청사항) — 대분류 선택은 이
  // Component 안에서만 쓰는 임시 UI 상태이고, 지금 선택된 카테고리로부터
  // 역산해서 초기화한다.
  const currentCategory = categories.find((c) => c.id === categoryId);
  const [selectedGroupId, setSelectedGroupId] = useState(currentCategory?.groupId ?? "");

  // TaskDetailPanel은 수정 모드를 열자마자 이 Component를 마운트하지만,
  // categoryId는 그 뒤 getTaskDetailAction(비동기)이 응답해야 채워진다 —
  // 같은 mount 안에서 나중에 채워지므로 useState 초기값만으로는 대분류가
  // 복원되지 않는다. useEffect 대신 "렌더 중 상태 조정"(React가 권장하는,
  // prop이 바뀔 때 상태를 맞추는 패턴 — setState-in-effect 경고를 피한다)으로
  // categoryId가 실제로 바뀐 렌더에서만 대분류를 재계산한다. categoryId가
  // 빈 값으로 바뀌는 경우(= 사용자가 대분류를 바꿔 onChange("")를 호출한
  // 경우)는 건드리지 않는다 — 그때는 selectedGroupId가 이미 사용자가 방금
  // 고른 새 대분류라 되돌리면 안 된다.
  const [prevCategoryId, setPrevCategoryId] = useState(categoryId);
  if (categoryId !== prevCategoryId) {
    setPrevCategoryId(categoryId);
    if (categoryId && currentCategory && currentCategory.groupId !== selectedGroupId) {
      setSelectedGroupId(currentCategory.groupId);
    }
  }

  // Step 5B-4와 동일한 "현재 선택된 값은 비활성이어도 목록에 남긴다" 규칙.
  const visibleGroups = groups.filter((g) => g.active || g.id === selectedGroupId);
  const categoriesInGroup = categories.filter((c) => c.groupId === selectedGroupId && (c.active || c.id === categoryId));

  function handleGroupChange(groupId: string) {
    setSelectedGroupId(groupId);
    // 대분류를 바꾸면 이전에 선택했던 중분류는 더 이상 그 목록에 없으므로 비운다.
    if (!groupId || categories.find((c) => c.id === categoryId)?.groupId !== groupId) onChange(NONE_OPTION_ID);
  }

  const groupOptions: PopoverOption[] = [
    { id: NONE_OPTION_ID, label: "선택 안 함" },
    ...visibleGroups.map((g) => ({ id: g.id, label: g.name })),
  ];
  const categoryOptions: PopoverOption[] = categoriesInGroup.map((c) => ({ id: c.id, label: c.name, color: tintFromColor(c.color).border }));

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <label className="text-[11px] text-navy-950/50">대분류</label>
        <PopoverSelect value={selectedGroupId} options={groupOptions} placeholder="대분류 선택" onChange={handleGroupChange} />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-navy-950/50">중분류</label>
        <PopoverSelect
          value={categoryId}
          options={categoryOptions}
          placeholder={selectedGroupId ? "중분류 선택" : "대분류를 먼저 선택하세요"}
          disabled={!selectedGroupId}
          searchable
          onChange={onChange}
        />
      </div>
    </div>
  );
}
