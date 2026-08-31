"use client";

import { useRef } from "react";
import { BLOCK_TYPE_LABELS } from "@/lib/meetingTemplates/constants";
import { MAX_LIST_DEPTH } from "@/lib/meetingTemplates/validate";
import type { ListItemNode, MeetingTemplateBlock } from "@/lib/meetingTemplates/types";

/**
 * Step 5B-3.2(자유 문서 Editor) — Word처럼 하나의 문서를 직접 쓰는 화면.
 * 사용자는 "이 섹션이 무슨 block type인지" 전혀 몰라도 된다 — 텍스트에
 * 이모지를 직접 타이핑하면 그게 곧 제목/본문의 일부가 된다(별도 아이콘
 * 입력칸을 두지 않는다). heading/text/list/table 4종만 실제로 편집
 * 가능하고, 나머지(meeting-info 등 예전 구조화 block)는 혹시 남아있어도
 * 안전하게 최소 표시만 한다(이번 Step에서 새로 만들 수는 없음).
 */

const paragraphInputClass =
  "w-full resize-y rounded border border-transparent bg-transparent px-1 py-1 text-sm leading-relaxed text-navy-950/80 outline-none focus:border-navy-200 focus:bg-navy-50/50";
const headingInputClass =
  "min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-navy-200 focus:bg-navy-50/50";
const lineInputClass = "min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-navy-200 focus:bg-navy-50/50";

const HEADING_SIZE_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-2xl font-bold",
  2: "text-lg font-semibold",
  3: "text-base font-semibold",
};

/** depth별 들여쓰기 폭(px) — Tab 한 번에 한 단계씩. */
const DEPTH_INDENT_PX = 20;

/** depth에 따른 마커 — depth 0만 list의 style(글머리표/번호)을 따르고,
 * depth 1 이상은 항상 하위 항목처럼 보이는 "-"/"·"로 표시한다(요청사항
 * 예시: 번호 목록 아래 하위 줄도 전부 "-"). 번호는 depth 0 항목끼리만 센다. */
function markerFor(style: "bullet" | "numbered", depth: number, numberAtDepth0: number): string {
  if (depth === 0) return style === "numbered" ? `${numberAtDepth0}.` : "•";
  if (depth === 1) return "-";
  return "·";
}

/** "Enter로 줄 추가"(같은 depth로) + Tab/Shift+Tab으로 들여쓰기(요청사항).
 * Backspace로 빈 줄을 지우면 바로 앞 줄로 포커스가 돌아간다 — 기존 UX 그대로
 * 유지, depth와는 무관하다. 별도 "중첩 목록" block을 만들지 않고 기존 list
 * block 안에서 항목마다 depth만 갖는다. */
function EditableItemLines({
  items,
  style,
  onChange,
}: {
  items: ListItemNode[];
  style: "bullet" | "numbered";
  onChange: (items: ListItemNode[]) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function updateText(i: number, text: string) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, text } : it)));
  }

  function setDepth(i: number, depth: number) {
    const clamped = Math.max(0, Math.min(MAX_LIST_DEPTH, depth));
    onChange(items.map((it, idx) => (idx === i ? { ...it, depth: clamped } : it)));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Tab") {
      e.preventDefault();
      setDepth(i, items[i].depth + (e.shiftKey ? -1 : 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const next = [...items];
      next.splice(i + 1, 0, { text: "", depth: items[i].depth });
      onChange(next);
      requestAnimationFrame(() => refs.current[i + 1]?.focus());
    } else if (e.key === "Backspace" && items[i].text === "" && items.length > 1) {
      e.preventDefault();
      onChange(items.filter((_, idx) => idx !== i));
      requestAnimationFrame(() => refs.current[Math.max(0, i - 1)]?.focus());
    }
  }

  if (items.length === 0) {
    return (
      <button
        type="button"
        onClick={() => onChange([{ text: "", depth: 0 }])}
        className="text-xs text-navy-950/40 hover:text-navy-950/70"
      >
        + 항목 추가
      </button>
    );
  }

  // JSX map 콜백 안에서 변수를 재할당하면 안 되므로(react-hooks/immutability),
  // depth 0 항목 번호는 렌더 이전에 별도 pass로 미리 계산해둔다.
  const numbers: number[] = [];
  let counter = 0;
  for (const item of items) {
    if (item.depth === 0) counter += 1;
    numbers.push(counter);
  }

  return (
    <div className="space-y-0.5">
      {items.map((item, i) => {
        return (
          <div
            key={i}
            className="group/item flex items-center gap-1.5"
            style={{ marginLeft: item.depth * DEPTH_INDENT_PX }}
          >
            <span className="w-4 shrink-0 text-right text-sm text-navy-950/40">{markerFor(style, item.depth, numbers[i])}</span>
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={lineInputClass}
              value={item.text}
              onChange={(e) => updateText(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, i)}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="shrink-0 text-navy-950/0 group-hover/item:text-navy-950/30 hover:!text-red-600"
            >
              ✕
            </button>
          </div>
        );
      })}
      <p className="pl-6 text-[11px] text-navy-950/30">Tab: 들여쓰기 · Shift+Tab: 내어쓰기</p>
    </div>
  );
}

/** Word처럼 실제 셀 값을 갖는 표 — project-list/action-item-list의 "열
 * 정의만 있는 표"와 달리 행 추가/삭제도 자유롭다. */
function EditableTable({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const colCount = rows[0]?.length ?? 2;

  function updateCell(r: number, c: number, value: string) {
    onChange(rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)));
  }
  function addRow() {
    onChange([...rows, Array.from({ length: colCount }, () => "")]);
  }
  function removeRow(r: number) {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, ri) => ri !== r));
  }
  function addColumn() {
    onChange(rows.map((row) => [...row, ""]));
  }
  function removeColumn(c: number) {
    if (colCount <= 1) return;
    onChange(rows.map((row) => row.filter((_, ci) => ci !== c)));
  }

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded border border-navy-100">
        <table className="w-full min-w-[280px] border-collapse text-left text-sm">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="group/tr">
                {row.map((cell, c) => (
                  <td key={c} className="group/td border border-navy-100 p-0">
                    <input
                      className="w-full min-w-[80px] border-none bg-transparent px-2 py-1.5 outline-none focus:bg-navy-50/50"
                      value={cell}
                      onChange={(e) => updateCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
                <td className="w-6 border-none p-0 text-center align-middle">
                  <button
                    type="button"
                    onClick={() => removeRow(r)}
                    className="text-navy-950/0 group-hover/tr:text-navy-950/30 hover:!text-red-600"
                    aria-label="행 삭제"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: colCount }).map((_, c) => (
                <td key={c} className="border-none p-0.5 text-center">
                  {/* 열 삭제는 헤더가 따로 없어 첫 행 아래에 작은 컨트롤로만 노출한다. */}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-navy-950/40">
        <button type="button" onClick={addRow} className="hover:text-navy-950/70">
          + 행
        </button>
        <button type="button" onClick={addColumn} className="hover:text-navy-950/70">
          + 열
        </button>
        {colCount > 1 && (
          <button type="button" onClick={() => removeColumn(colCount - 1)} className="hover:!text-red-600">
            − 마지막 열 삭제
          </button>
        )}
      </div>
    </div>
  );
}

export function SectionBody({ block, onUpdate }: { block: MeetingTemplateBlock; onUpdate: (patch: Record<string, unknown>) => void }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="flex items-center gap-1.5">
          <input
            className={`${headingInputClass} ${HEADING_SIZE_CLASS[block.config.level]}`}
            value={block.config.text}
            onChange={(e) => onUpdate({ config: { ...block.config, text: e.target.value } })}
            placeholder="제목을 입력하세요(이모지를 직접 넣어도 됩니다. 예: 📋 주간 업무 회의록)"
          />
          <div className="flex shrink-0 gap-0.5 rounded border border-navy-100 p-0.5">
            {([1, 2, 3] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => onUpdate({ config: { ...block.config, level: lvl } })}
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  block.config.level === lvl ? "bg-navy-900 text-white" : "text-navy-950/50 hover:bg-navy-50"
                }`}
              >
                H{lvl}
              </button>
            ))}
          </div>
        </div>
      );

    case "text":
      return (
        <textarea
          className={paragraphInputClass}
          rows={3}
          value={block.config.text ?? ""}
          onChange={(e) => onUpdate({ config: { ...block.config, text: e.target.value } })}
          placeholder="내용을 입력하세요"
        />
      );

    case "list":
      return (
        <div className="space-y-1.5">
          <div className="flex justify-end">
            <select
              className="rounded border border-navy-100 px-1.5 py-0.5 text-[11px] text-navy-950/60"
              value={block.config.style}
              onChange={(e) => onUpdate({ config: { ...block.config, style: e.target.value as "bullet" | "numbered" } })}
            >
              <option value="bullet">글머리표</option>
              <option value="numbered">번호</option>
            </select>
          </div>
          <EditableItemLines
            items={block.config.items ?? []}
            style={block.config.style}
            onChange={(items) => onUpdate({ config: { ...block.config, items } })}
          />
        </div>
      );

    case "table":
      return <EditableTable rows={block.config.rows} onChange={(rows) => onUpdate({ config: { ...block.config, rows } })} />;

    // Step 5B-3.2 이전에 만들어졌을 수 있는 구조화 block — 새로 만들 수는
    // 없지만(요청사항: block type을 사용자가 선택하지 않게 한다), 혹시 남아
    // 있어도 화면이 깨지지 않도록 최소한의 안전한 표시만 한다.
    default:
      return <p className="text-xs italic text-navy-950/30">({BLOCK_TYPE_LABELS[block.type]} — 이전 버전 구조화 섹션)</p>;
  }
}
