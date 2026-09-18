"use client";

import {
  DESIGN_AVATAR,
  DESIGN_CARRIED_TAG,
  DESIGN_CARRY_BUTTON,
  DESIGN_COMMON_BAR_COLOR,
  DESIGN_COMMON_PCT_TEXT_COLOR,
  DESIGN_DDAY_TONE,
  DESIGN_ITEM_STATUS,
  DESIGN_QUARTER_BADGE,
  DESIGN_REPEAT_TAG,
  DESIGN_REPEAT_TAG_OVERDUE,
  DESIGN_STATUS,
  DESIGN_SUB_BAR_COLOR,
  DESIGN_SUB_PCT_TEXT_COLOR,
} from "@/lib/progress/designTokens";
import { PROGRESS_STATUS_LABEL, repeatDayLabel } from "@/lib/progress/constants";
import { currentStageText, effectiveRounds, isRepeatDueDayPassed, pw8ReviewBadge, releaseDday, sampleDday, subProjectItemSpan, type BadgeTone } from "@/lib/progress/derive";
import { compareQuarter, currentFiscalQuarter, quarterLabel, type FiscalQuarter } from "@/lib/progress/date";
import type { ProgressCommonTaskItemRow, ProgressRegularProjectRow, ProgressSubProjectRow } from "@/lib/progress/types";
import type { ProgressStatus } from "@/app/generated/prisma/enums";
import { StageRail, type StageMark } from "./StageRail";

/**
 * 진행 현황 대시보드 카드/행 — Claude Design ZIP("진행 현황 관리판
 * v2.dc.html")의 실제 렌더 구조를 그대로 옮긴다(§4·§6·§7). 색상/여백/폰트
 * 크기는 lib/progress/designTokens.ts의 값을 그대로 쓰고 근사치로 바꾸지
 * 않는다.
 */

const toneStyle = (tone: BadgeTone) => {
  const t = DESIGN_DDAY_TONE[tone];
  return { color: t.color, background: t.bg, border: `1px solid ${t.border}` };
};

const smallBadgeClass = "shrink-0 whitespace-nowrap rounded-[5px] px-[7px] py-px text-[10.5px] font-semibold tabular-nums";

function StatusPillSelect({ status, pending, onChange }: { status: ProgressStatus; pending: boolean; onChange: (s: ProgressStatus) => void }) {
  const c = DESIGN_STATUS[status];
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => onChange(e.target.value as ProgressStatus)}
      className="appearance-none rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold"
      style={{ color: c.color, background: c.bg, border: `1px solid ${c.border}` }}
    >
      {(Object.keys(PROGRESS_STATUS_LABEL) as ProgressStatus[]).map((s) => (
        <option key={s} value={s}>{PROGRESS_STATUS_LABEL[s]}</option>
      ))}
    </select>
  );
}

function OwnerChip({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border border-[#e9edf3] bg-[#f4f6fa] py-0.5 pl-[3px] pr-[9px] text-[11.5px] text-[#4b5364]">
      <span
        className="grid shrink-0 place-items-center rounded-full text-[9.5px]"
        style={{ width: size, height: size, background: DESIGN_AVATAR.bg, color: DESIGN_AVATAR.color }}
      >
        {name.slice(-2)}
      </span>
      {name}
    </span>
  );
}

/** 서브 프로젝트 카드의 담당자 표시 — 정규 프로젝트와 달리 Design 원본은
 * 배경/테두리 있는 pill로 감싸지 않고 아바타 원 + 이름만 나열한다(§6 원본
 * 마크업: 바깥 span은 배경 없는 순수 flex 래퍼). OwnerChip과 겉보기엔
 * 비슷해도 컨테이너에 pill 스타일이 없다는 점이 실제 차이라 별도 컴포넌트로
 * 분리한다. */
function OwnerInline({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-[11.5px] text-[#4b5364]">
      <span
        className="grid shrink-0 place-items-center rounded-full text-[9.5px]"
        style={{ width: size, height: size, background: DESIGN_AVATAR.bg, color: DESIGN_AVATAR.color }}
      >
        {name.slice(-2)}
      </span>
      {name}
    </span>
  );
}

// ── 정규 프로젝트 — 한 행(row) 구조(Design §4) ─────────────────────────

export function RegularProjectCard({
  project,
  pending,
  onEdit,
  onStatusChange,
  onStageChange,
  onSampleDateChange,
  onAddRound,
  onCancelRound,
}: {
  project: ProgressRegularProjectRow;
  pending: boolean;
  onEdit: () => void;
  onStatusChange: (status: ProgressStatus) => void;
  onStageChange: (index: number, mark: StageMark) => void;
  onSampleDateChange: (index: number, value: string) => void;
  onAddRound: () => void;
  onCancelRound: () => void;
}) {
  const dday = releaseDday(project.targetReleaseDate, project.actualReleaseDate);
  const review = pw8ReviewBadge(project.actualReleaseDate);
  const sample = sampleDday(project.stageRunIndexes, project.samplePw3Date, project.samplePw4Date);
  const effRounds = effectiveRounds(project.stageRunIndexes, project.improvementRounds);
  const stageCode = project.stageRunIndexes.length ? `PW${Math.max(...project.stageRunIndexes) + 1}` : "";
  const stageText = currentStageText(project.stageRunIndexes);
  const stageName = stageCode ? stageText.replace(`${stageCode} `, "") : stageText;

  return (
    <article className="flex flex-wrap items-center gap-x-[18px] gap-y-3 rounded-xl border border-[#dde2ea] bg-white px-[15px] py-3">
      {/* 왼쪽: 이름/D-day, 담당자/상태 */}
      <div className="flex min-w-0 flex-col gap-[5px]" style={{ flex: "1 1 240px" }}>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            title="클릭하면 수정"
            onClick={onEdit}
            className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold text-[#1b1f2b] hover:text-navy-700 hover:underline"
            style={{ letterSpacing: "-0.01em" }}
          >
            {project.name}
          </button>
          {project.artifactUrl && (
            <a href={project.artifactUrl} target="_blank" rel="noreferrer" title="산출물 링크 열기" className="shrink-0 whitespace-nowrap rounded-md border border-navy-100 bg-navy-50 px-2 py-0.5 text-[11px] text-navy-700 no-underline">
              산출물 ↗
            </a>
          )}
          <span title={dday.tooltip} className={smallBadgeClass} style={toneStyle(dday.tone)}>{dday.text}</span>
        </div>
        <div className="flex flex-wrap items-center gap-[7px]">
          <OwnerChip name={project.ownerName} />
          <StatusPillSelect status={project.status} pending={pending} onChange={onStatusChange} />
        </div>
      </div>

      {/* 가운데: PW 레일 + 현재 단계 문구 */}
      <div className="flex min-w-0 flex-col gap-1.5" style={{ flex: "2 1 300px" }}>
        <StageRail
          runIndexes={project.stageRunIndexes}
          skipIndexes={project.stageSkipIndexes}
          samplePw3Date={project.samplePw3Date}
          samplePw4Date={project.samplePw4Date}
          effRounds={effRounds}
          pending={pending}
          onSetStage={onStageChange}
          onSetSampleDate={onSampleDateChange}
          onAddRound={onAddRound}
          onCancelRound={onCancelRound}
        />
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#1b1f2b]">
          {stageCode ? (
            <>
              <span className="shrink-0 font-semibold text-navy-700">{stageCode}</span>
              <span className="shrink-0 text-[#cfd5e0]">·</span>
              <span className="min-w-0 flex-1 truncate text-[#4b5364]">{stageName}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[#4b5364]">{stageName}</span>
          )}
          {sample && <span title={sample.tooltip} className={smallBadgeClass} style={toneStyle(sample.tone)}>{sample.text}</span>}
          {review && <span title={review.tooltip} className={smallBadgeClass} style={toneStyle(review.tone)}>{review.text}</span>}
          {effRounds > 0 && (
            <span
              title={`PW4 진행 시 개선 1차로 자동 취급 · 현재 ${effRounds}차`}
              className={smallBadgeClass}
              style={{ color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a" }}
            >
              개선 {effRounds}차
            </span>
          )}
        </div>
      </div>

      {/* 오른쪽: Kick Off / 목표 출시 / 실제 출시 */}
      <div className="grid min-w-0 grid-cols-3 gap-[10px]" style={{ flex: "1 1 260px" }}>
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[10.5px] text-[#9aa1b1]" style={{ letterSpacing: "0.02em" }}>Kick Off</div>
          <div className="whitespace-nowrap text-[12.5px] tabular-nums text-[#4b5364]">{project.kickoffDate ? project.kickoffDate.replaceAll("-", ".") : "—"}</div>
        </div>
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[10.5px] text-[#9aa1b1]" style={{ letterSpacing: "0.02em" }}>목표 출시</div>
          <div className="whitespace-nowrap text-[12.5px] tabular-nums text-[#1b1f2b]">{project.targetReleaseDate ? project.targetReleaseDate.replaceAll("-", ".") : "—"}</div>
        </div>
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[10.5px] text-[#9aa1b1]" style={{ letterSpacing: "0.02em" }}>실제 출시</div>
          <div
            className="whitespace-nowrap text-[12.5px] tabular-nums"
            style={{ color: project.actualReleaseDate ? "#15803d" : "#d4d4d4", fontWeight: project.actualReleaseDate ? 600 : 400 }}
          >
            {project.actualReleaseDate ? project.actualReleaseDate.replaceAll("-", ".") : "—"}
          </div>
        </div>
      </div>
    </article>
  );
}

// ── 서브 프로젝트 카드(Design §6) ───────────────────────────────────────

export function SubProjectCard({
  project,
  quarter,
  pending,
  onEdit,
  onStatusChange,
  onToggleItem,
}: {
  project: ProgressSubProjectRow;
  quarter: FiscalQuarter;
  pending: boolean;
  onEdit: () => void;
  onStatusChange: (status: ProgressStatus) => void;
  onToggleItem: (itemId: string) => void;
}) {
  const doneTotal = project.items.filter((it) => it.status === "DONE").length;
  const total = project.items.length;
  const pct = total ? Math.round((doneTotal / total) * 100) : 0;
  const thisQItems = project.items.filter((it) => it.quarterYear === quarter.year && it.quarterNum === quarter.q);
  const doneThisQ = thisQItems.filter((it) => it.status === "DONE").length;
  const span = subProjectItemSpan(project.items);
  const spanLabel = span ? (span.start.year === span.end.year && span.start.q === span.end.q ? `${span.start.year} Q${span.start.q}` : `${span.start.year} Q${span.start.q} – ${span.end.year} Q${span.end.q}`) : "";
  const firstIncompleteId = thisQItems.find((it) => it.status !== "DONE")?.id;
  // 배지 = "지금 보고 있는 분기"(quarter prop, 섹션의 ‹ › 분기 이동 값). 등록
  // 당시 분기(project.quarterStartYear/Q)는 다른 분기를 보고 있을 때도
  // 고정돼 있어 진행률 구간(spanLabel)과 어긋나 보였다 — 그건 배지가 아니라
  // "등록 구간" 표시(spanLabel)의 역할이라 배지에는 쓰지 않는다.
  const isViewingCurrentFiscalQuarter = compareQuarter(quarter, currentFiscalQuarter()) === 0;
  const quarterBadgeColor = isViewingCurrentFiscalQuarter ? DESIGN_QUARTER_BADGE.current : DESIGN_QUARTER_BADGE.other;

  return (
    <article className="flex flex-col gap-[9px] rounded-xl border border-[#dde2ea] bg-white px-[15px] py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          title={`회계 ${quarterLabel(quarter)}${isViewingCurrentFiscalQuarter ? " · 현재 분기" : ""}`}
          className="whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
          style={{ color: quarterBadgeColor.color, background: quarterBadgeColor.bg, border: `1px solid ${quarterBadgeColor.border}` }}
        >
          {quarterLabel(quarter)}
        </span>
        <OwnerInline name={project.ownerName} />
        <StatusPillSelect status={project.status} pending={pending} onChange={onStatusChange} />
        <span className="ml-auto whitespace-nowrap text-[11.5px] text-[#6f778a]">이번 분기 {doneThisQ}/{thisQItems.length} 완료</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" title="클릭하면 수정" onClick={onEdit} className="text-left text-[14px] font-semibold text-[#1b1f2b] hover:text-navy-700 hover:underline" style={{ letterSpacing: "-0.01em" }}>
          {project.name}
        </button>
        {project.sheetUrl && (
          <a href={project.sheetUrl} target="_blank" rel="noreferrer" title="산출물 시트 열기" className="whitespace-nowrap rounded-md border border-navy-100 bg-navy-50 px-2 py-0.5 text-[11px] text-navy-700 no-underline">
            산출물 ↗
          </a>
        )}
      </div>

      <div className="flex items-center gap-[9px]">
        <span title={`등록 구간 ${spanLabel} · 전체 ${doneTotal}/${total} 완료`} className="whitespace-nowrap text-[11px] tabular-nums text-[#6f778a]">{spanLabel}</span>
        <span className="h-1 min-w-[40px] flex-1 overflow-hidden rounded-sm bg-[#edf0f4]">
          <span className="block h-full rounded-sm" style={{ width: `${pct}%`, background: DESIGN_SUB_BAR_COLOR }} />
        </span>
        <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums" style={{ color: DESIGN_SUB_PCT_TEXT_COLOR }}>{doneTotal}/{total} · {pct}%</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {thisQItems.length === 0 && <div className="rounded-lg border border-dashed border-[#d5dbe5] px-3 py-2 text-[12.5px] text-[#8a91a3]">{quarterLabel(quarter)}에 진행 예정인 세부 목표가 없습니다.</div>}
        {thisQItems.map((it) => {
          const done = it.status === "DONE";
          const isCur = !done && it.id === firstIncompleteId;
          const idx = project.items.findIndex((x) => x.id === it.id);
          const k = DESIGN_ITEM_STATUS[it.status];
          return (
            <button
              key={it.id}
              type="button"
              disabled={pending}
              onClick={() => onToggleItem(it.id)}
              className="flex w-full items-center gap-2 rounded-[7px] border border-transparent px-2 py-[5px] text-left hover:bg-[#f7f9fc]"
            >
              <span className="w-[13px] shrink-0 text-center text-[11.5px]" style={{ color: k.color }}>{k.marker}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-[#9aa1b1]">{String(idx + 1).padStart(2, "0")}</span>
              <span
                className="min-w-0 flex-1 truncate text-[12.5px]"
                style={{ color: done ? "#8a91a3" : "#1b1f2b", fontWeight: isCur ? 600 : 400 }}
              >
                {it.text}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[10.5px] text-[#8a91a3]">{it.quarterYear} Q{it.quarterNum}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

// ── 공통 업무 담당자별 카드(Design §7) ──────────────────────────────────

interface CommonOwnerItem {
  itemId: string;
  taskId: string;
  taskName: string;
  status: ProgressCommonTaskItemRow["status"];
  repeat: boolean;
  repeatDay: string;
  carriedFromYear: number | null;
  carriedFromMonth: number | null;
}

export function CommonOwnerCard({
  ownerName,
  items,
  month,
  pending,
  onEditTask,
  onToggleItem,
  onCarryForward,
}: {
  ownerName: string;
  items: CommonOwnerItem[];
  month: { year: number; month: number };
  pending: boolean;
  onEditTask: (taskId: string) => void;
  onToggleItem: (itemId: string) => void;
  onCarryForward: (itemId: string) => void;
}) {
  const doneN = items.filter((it) => it.status === "DONE").length;
  const pct = items.length ? Math.round((doneN / items.length) * 100) : 0;
  const monthTag = `${month.year}-${String(month.month).padStart(2, "0")}`;

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-[#dde2ea] bg-white px-[15px] py-3">
      <div className="flex items-center gap-2">
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[10px]" style={{ background: DESIGN_AVATAR.bg, color: DESIGN_AVATAR.color }}>
          {ownerName.slice(-2)}
        </span>
        <span className="text-[14px] font-semibold">{ownerName}</span>
        <span className="whitespace-nowrap text-[11.5px] tabular-nums text-[#8a91a3]">{monthTag}</span>
        <span className="ml-auto whitespace-nowrap text-[11.5px] text-[#6f778a]">{doneN} / {items.length} 완료</span>
      </div>

      <div className="flex items-center gap-[9px]">
        <span className="h-1 min-w-[40px] flex-1 overflow-hidden rounded-sm bg-[#edf0f4]">
          <span className="block h-full rounded-sm" style={{ width: `${pct}%`, background: DESIGN_COMMON_BAR_COLOR }} />
        </span>
        <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums" style={{ color: DESIGN_COMMON_PCT_TEXT_COLOR }}>{pct}%</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {items.map((it) => {
          const done = it.status === "DONE";
          const k = DESIGN_ITEM_STATUS[it.status];
          const canCarry = !done;
          const overdue = it.repeat && !done && isRepeatDueDayPassed(it.repeatDay, month);
          const repeatTagTone = overdue ? DESIGN_REPEAT_TAG_OVERDUE : DESIGN_REPEAT_TAG;
          return (
            <div key={it.itemId} className="flex items-center gap-2 rounded-md px-[7px] py-[5px] hover:bg-[#f7f9fc]">
              <button
                type="button"
                title="클릭하면 수정"
                onClick={() => onEditTask(it.taskId)}
                className="min-w-0 flex-1 truncate text-left text-[12.5px] hover:text-navy-700 hover:underline"
                style={{ color: done ? "#8a91a3" : "#1b1f2b", textDecoration: done ? "line-through" : "none" }}
              >
                {it.taskName}
              </button>
              {it.repeat && (
                <span
                  title={overdue ? `${repeatDayLabel(it.repeatDay)} 반복 업무 · 기준일 경과` : `${repeatDayLabel(it.repeatDay)} 반복 업무`}
                  className="shrink-0 whitespace-nowrap rounded-[5px] px-1.5 py-px text-[10.5px] font-semibold"
                  style={{ color: repeatTagTone.color, background: repeatTagTone.bg, border: `1px solid ${repeatTagTone.border}` }}
                >
                  매월 {repeatDayLabel(it.repeatDay)}
                </span>
              )}
              {it.carriedFromYear != null && it.carriedFromMonth != null && (
                <span
                  title={`${it.carriedFromYear}-${String(it.carriedFromMonth).padStart(2, "0")} 계획에서 이월된 업무`}
                  className="shrink-0 whitespace-nowrap rounded-[5px] px-1.5 py-px text-[10.5px] font-semibold"
                  style={{ color: DESIGN_CARRIED_TAG.color, background: DESIGN_CARRIED_TAG.bg, border: `1px solid ${DESIGN_CARRIED_TAG.border}` }}
                >
                  {String(it.carriedFromMonth).padStart(2, "0")}월 이월
                </span>
              )}
              <button
                type="button"
                disabled={pending}
                title={done ? "예정으로 되돌리기" : "완료로 전환"}
                onClick={() => onToggleItem(it.itemId)}
                className="shrink-0 whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11px] font-semibold"
                style={{ color: k.color, background: k.bg, border: `1px solid ${k.border}` }}
              >
                {k.marker === "●" ? "완료" : "예정"}
              </button>
              {canCarry && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onCarryForward(it.itemId)}
                  className="shrink-0 whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11px] font-semibold hover:!border-amber-200 hover:!bg-amber-50 hover:!text-amber-700"
                  style={{ color: DESIGN_CARRY_BUTTON.color, background: DESIGN_CARRY_BUTTON.bg, border: `1px solid ${DESIGN_CARRY_BUTTON.border}` }}
                >
                  이월
                </button>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
