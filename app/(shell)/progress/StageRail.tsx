"use client";

import { useState } from "react";
import { PROGRESS_PW_STAGES, PROGRESS_ROUND_STAGE_INDEX, PROGRESS_SAMPLE_STAGE_PW3_INDEX, PROGRESS_SAMPLE_STAGE_PW4_INDEX } from "@/lib/progress/constants";
import { DESIGN_STAGE_COLOR } from "@/lib/progress/designTokens";
import { SegmentedDateInput } from "./DateSegments";

export type StageMark = "RUN" | "SKIP" | "NONE";

/**
 * 정규 프로젝트 PW1~PW8 레일 — Claude Design ZIP §5의 "bar" 모드를 정확히
 * 재현한다(대체 "dot" 모드는 디자인 도구 Prop 토글용 변형이라 제외 —
 * Design 기본값이 bar). 8칸 grid(gap 4px), 각 칸은 막대(5px, 현재 칸만
 * 7px) + 그 아래 라벨로 구성되고, 클릭하면 진행/생략/취소 팝업이 뜬다.
 */
export function StageRail({
  runIndexes,
  skipIndexes,
  samplePw3Date,
  samplePw4Date,
  effRounds,
  pending,
  onSetStage,
  onSetSampleDate,
  onAddRound,
  onCancelRound,
}: {
  runIndexes: number[];
  skipIndexes: number[];
  samplePw3Date: string;
  samplePw4Date: string;
  effRounds: number;
  pending: boolean;
  onSetStage: (index: number, mark: StageMark) => void;
  onSetSampleDate: (index: number, value: string) => void;
  onAddRound: () => void;
  onCancelRound: () => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [sampleFieldOpen, setSampleFieldOpen] = useState(false);
  const curIndex = runIndexes.length ? Math.max(...runIndexes) : -1;

  function openMenu(i: number) {
    setOpenIndex((v) => (v === i ? null : i));
    setSampleFieldOpen(false);
  }

  function closeMenu() {
    setOpenIndex(null);
    setSampleFieldOpen(false);
  }

  function stateOf(i: number): "run" | "skip" | "up" {
    if (skipIndexes.includes(i)) return "skip";
    if (runIndexes.includes(i)) return "run";
    return "up";
  }

  return (
    <div className="relative grid grid-cols-8 gap-1">
      {openIndex !== null && <div className="fixed inset-0 z-[6]" onClick={closeMenu} />}
      {PROGRESS_PW_STAGES.map((name, i) => {
        const state = stateOf(i);
        const isCur = state === "run" && i === curIndex;
        const isSkipped = state === "skip";
        const isSample = i === PROGRESS_SAMPLE_STAGE_PW3_INDEX || i === PROGRESS_SAMPLE_STAGE_PW4_INDEX;
        const sampleValue = i === PROGRESS_SAMPLE_STAGE_PW3_INDEX ? samplePw3Date : samplePw4Date;
        const col = state === "run" ? (isCur ? DESIGN_STAGE_COLOR.cur : DESIGN_STAGE_COLOR.done) : DESIGN_STAGE_COLOR.up;
        // 라벨/어깨숫자 색 — bar(DESIGN_STAGE_COLOR)와 label의 역할을 분리했다.
        // bar는 장식이라 옅어도 되지만 label은 텍스트라 흰 배경 대비 읽혀야
        // 한다 — blue-300/navy-100을 라벨에 그대로 쓰면 대비가 각각
        // 1.8:1/1.2:1로 WCAG AA(4.5:1) 미달이라 실측 후 되돌렸다.
        //  - 현재 단계(cur)   → navy-700(대비 충분, bar와 동일 톤 유지)
        //  - 지난 진행(run)   → neutral-500(bar는 blue-300 유지, label만 분리)
        //  - 미진행(up)       → neutral-400(bar는 navy-100 유지, label만 분리)
        //  - 생략(skip)       → neutral-400(취소선으로 이미 "생략"을 표시)
        const labelColor = isSkipped ? "#a3a3a3" : isCur ? "#2c4a85" : state === "run" ? "#737373" : "#a3a3a3";
        const suffix = i === PROGRESS_ROUND_STAGE_INDEX && effRounds > 0 ? String(effRounds) : "";
        const suffixColor = isSkipped ? "#a3a3a3" : state === "up" ? "#a3a3a3" : "#2c4a85";

        return (
          <div key={i} className="relative min-w-0">
            <button
              type="button"
              disabled={pending}
              onClick={() => openMenu(i)}
              title={`PW${i + 1} ${name}${isSkipped ? " · 생략" : state === "run" ? " · 진행" : " · 미진행"}${suffix ? ` · 개선 ${suffix}차 등록` : ""}`}
              className="flex w-full flex-col items-stretch gap-1 border-0 bg-transparent p-0"
            >
              <span
                className="block rounded-[3px]"
                style={
                  isSkipped
                    ? { height: 5, background: "repeating-linear-gradient(115deg, #d4d4d4 0 3px, #f5f5f5 3px 6px)" }
                    : { height: isCur ? 7 : 5, background: col }
                }
              />
              <span
                className="block truncate text-left text-[10.5px] leading-tight"
                style={{ letterSpacing: "-0.01em", color: labelColor, fontWeight: !isSkipped && isCur ? 700 : 400, textDecoration: isSkipped ? "line-through" : "none" }}
              >
                PW{i + 1}
                {suffix && <span className="ml-px align-super text-[8.5px] font-bold" style={{ color: suffixColor }}>{suffix}</span>}
              </span>
            </button>
            {openIndex === i && (
              <div
                className="absolute left-0 top-full z-[6] mt-1.5 flex min-w-[142px] flex-col gap-0.5 rounded-[9px] border border-[#d5dbe5] bg-white p-[5px]"
                style={{ boxShadow: "0 10px 26px rgba(18,22,34,0.16)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="whitespace-nowrap px-2 pb-0.5 pt-1 text-[10.5px] text-[#9aa1b1]">PW{i + 1} {name}</div>
                {(
                  [
                    { key: "RUN" as const, label: "진행", dot: "#2c4a85" },
                    { key: "SKIP" as const, label: "생략", dot: "hatch" },
                    { key: "NONE" as const, label: "취소", dot: "#e8ecf5" },
                  ]
                ).map((m) => {
                  const active = (m.key === "RUN" && state === "run" && !isSkipped) || (m.key === "SKIP" && isSkipped) || (m.key === "NONE" && state === "up");
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => { onSetStage(i, m.key); closeMenu(); }}
                      className="flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] text-[#1b1f2b] hover:bg-[#f1f4f8]"
                      style={{ background: active ? "#f1f4f8" : "none" }}
                    >
                      <span
                        className="block h-[9px] w-[9px] shrink-0 rounded-sm"
                        style={m.dot === "hatch" ? { background: "repeating-linear-gradient(115deg, #d4d4d4 0 3px, #f5f5f5 3px 6px)" } : m.key === "NONE" ? { border: "1px solid #d5dbe5" } : { background: m.dot }}
                      />
                      {m.label}
                    </button>
                  );
                })}
                {isSample && (
                  <>
                    <span className="my-0.5 h-px bg-[#edf0f4]" />
                    <button
                      type="button"
                      onClick={() => setSampleFieldOpen((v) => !v)}
                      className="flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] text-[#2c4a85] hover:bg-[#f4f6fb]"
                    >
                      <span className="block h-[9px] w-[9px] shrink-0 rounded-sm bg-[#93c5fd]" />
                      샘플 일정{sampleValue && ` · ${sampleValue}`}
                    </button>
                    {sampleFieldOpen && (
                      <div className="px-2 pb-1 pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <SegmentedDateInput
                          value={sampleValue}
                          onChange={(value) => onSetSampleDate(i, value)}
                          onEnter={closeMenu}
                          autoFocus
                        />
                      </div>
                    )}
                  </>
                )}
                {i === PROGRESS_ROUND_STAGE_INDEX && state === "run" && (
                  <>
                    <span className="my-0.5 h-px bg-[#edf0f4]" />
                    <button
                      type="button"
                      title="개선 효력이 없어 다음 차수로 넘길 때"
                      onClick={() => { onAddRound(); closeMenu(); }}
                      className="flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] text-[#b45309] hover:bg-[#fffbeb]"
                    >
                      <span className="block h-[9px] w-[9px] shrink-0 rounded-sm bg-[#fbbf24]" />
                      차수 추가 (현재 {Math.max(1, effRounds)}차)
                    </button>
                    {effRounds > 1 && (
                      <button
                        type="button"
                        title="직전 차수로 되돌릴 때(1차 미만으로는 내려가지 않음)"
                        onClick={() => { onCancelRound(); closeMenu(); }}
                        className="flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] text-[#737373] hover:bg-[#f5f5f5]"
                      >
                        <span className="block h-[9px] w-[9px] shrink-0 rounded-sm border border-[#d4d4d4]" />
                        차수 취소 (현재 {effRounds}차)
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

