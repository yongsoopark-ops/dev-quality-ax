"use client";

import { createDefaultMeetingInfoField, createDefaultTableColumn } from "@/lib/meetingTemplates/defaults";
import type { MeetingTemplateBlock } from "@/lib/meetingTemplates/types";

const inputClass = "w-full rounded-md border border-navy-100 px-2.5 py-1.5 text-sm";

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * meeting-info의 fields / project-list·action-item-list의 columns처럼
 * "key(내부 식별값, 보호) + label(자유 편집) + 순서(위/아래 버튼)"를 공유하는
 * 중첩 목록 편집 UI. 블록 자체의 순서는 Drag & Drop이지만, 이 중첩 목록까지
 * 2중 DnD를 두면 과해져(요청사항: 완전 자유 Editor를 만들지 않음) 위/아래
 * 버튼으로 충분히 "field 추가·삭제·순서"를 만족시킨다.
 */
function KeyedListEditor<T extends { key: string; label: string; icon?: string }>({
  items,
  onChange,
  createDefault,
  showIcon,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  createDefault: () => T;
  showIcon?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={item.key} className="flex items-center gap-1.5">
          <div className="flex shrink-0 flex-col leading-none">
            <button
              type="button"
              disabled={i === 0}
              onClick={() => onChange(moveItem(items, i, i - 1))}
              className="text-[10px] text-navy-950/40 hover:text-navy-950 disabled:opacity-20"
              aria-label="위로"
            >
              ▲
            </button>
            <button
              type="button"
              disabled={i === items.length - 1}
              onClick={() => onChange(moveItem(items, i, i + 1))}
              className="text-[10px] text-navy-950/40 hover:text-navy-950 disabled:opacity-20"
              aria-label="아래로"
            >
              ▼
            </button>
          </div>
          <span
            className="shrink-0 truncate rounded bg-navy-50 px-1.5 py-1 text-[11px] text-navy-950/40"
            style={{ maxWidth: 96 }}
            title={`내부 식별값(수정 불가): ${item.key}`}
          >
            {item.key}
          </span>
          {showIcon && (
            <input
              className="w-12 shrink-0 rounded-md border border-navy-100 px-1.5 py-1 text-center text-sm"
              value={item.icon ?? ""}
              placeholder="🙂"
              onChange={(e) => onChange(items.map((it, idx) => (idx === i ? { ...it, icon: e.target.value } : it)))}
            />
          )}
          <input
            className={inputClass}
            value={item.label}
            onChange={(e) => onChange(items.map((it, idx) => (idx === i ? { ...it, label: e.target.value } : it)))}
            placeholder="표시 이름"
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="shrink-0 text-xs text-red-600 hover:underline"
          >
            삭제
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, createDefault()])}
        className="rounded-md border border-navy-100 px-2.5 py-1 text-xs text-navy-950/70 hover:bg-navy-50"
      >
        + 추가
      </button>
    </div>
  );
}

/**
 * block.type별 config 편집 UI. block은 이미 상위(TemplateEditor)에서
 * type으로 판별된 채 넘어오므로 여기서는 switch로 그 type에 맞는 필드만
 * 그린다 — type 자체는 이 컴포넌트에서 바꿀 수 없다(요청사항: AI/자동화가
 * 의존하는 식별값 보호, block.type은 추가 시점에만 정해지고 이후 고정).
 */
export function BlockConfigEditor({
  block,
  onChange,
}: {
  block: MeetingTemplateBlock;
  onChange: (config: MeetingTemplateBlock["config"]) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div className="grid grid-cols-[72px_1fr_56px] gap-2">
          <select
            className={inputClass}
            value={block.config.level}
            onChange={(e) => onChange({ ...block.config, level: Number(e.target.value) as 1 | 2 | 3 })}
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <input
            className={inputClass}
            value={block.config.text}
            onChange={(e) => onChange({ ...block.config, text: e.target.value })}
            placeholder="제목 텍스트"
          />
          <input
            className={`${inputClass} text-center`}
            value={block.config.icon ?? ""}
            onChange={(e) => onChange({ ...block.config, icon: e.target.value })}
            placeholder="🙂"
          />
        </div>
      );

    case "text":
      return (
        <div className="space-y-1.5">
          <textarea
            className={inputClass}
            rows={2}
            value={block.config.text ?? ""}
            onChange={(e) => onChange({ ...block.config, text: e.target.value })}
            placeholder="고정 문구(선택 — 비워두면 실제 회의 시점에 채워짐)"
          />
          <input
            className={inputClass}
            value={block.config.placeholder ?? ""}
            onChange={(e) => onChange({ ...block.config, placeholder: e.target.value })}
            placeholder="입력 안내 문구(선택)"
          />
        </div>
      );

    case "list":
      return (
        <div className="flex items-center gap-2">
          <select
            className={inputClass}
            value={block.config.style}
            onChange={(e) => onChange({ ...block.config, style: e.target.value as "bullet" | "numbered" })}
          >
            <option value="bullet">불릿</option>
            <option value="numbered">번호</option>
          </select>
          <input
            className={`${inputClass} max-w-[80px] text-center`}
            value={block.config.icon ?? ""}
            onChange={(e) => onChange({ ...block.config, icon: e.target.value })}
            placeholder="🙂"
          />
        </div>
      );

    case "meeting-info":
      return (
        <KeyedListEditor
          items={block.config.fields}
          onChange={(fields) => onChange({ ...block.config, fields })}
          createDefault={createDefaultMeetingInfoField}
          showIcon
        />
      );

    case "agenda-list":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-navy-950/70">
            <input
              type="checkbox"
              checked={block.config.numbered ?? false}
              onChange={(e) => onChange({ ...block.config, numbered: e.target.checked })}
            />
            번호 매기기
          </label>
          <input
            className={`${inputClass} max-w-[80px] text-center`}
            value={block.config.icon ?? ""}
            onChange={(e) => onChange({ ...block.config, icon: e.target.value })}
            placeholder="🙂"
          />
        </div>
      );

    case "project-list":
    case "action-item-list":
      return (
        <KeyedListEditor
          items={block.config.columns}
          onChange={(columns) => onChange({ ...block.config, columns })}
          createDefault={createDefaultTableColumn}
        />
      );

    case "review-list":
      return (
        <label className="flex items-center gap-1.5 text-xs text-navy-950/70">
          <input
            type="checkbox"
            checked={block.config.accumulatesAcrossMeetings ?? false}
            onChange={(e) => onChange({ ...block.config, accumulatesAcrossMeetings: e.target.checked })}
          />
          이전 회차 미해결 항목 누적(향후 재검토 필요 영역)
        </label>
      );
  }
}
