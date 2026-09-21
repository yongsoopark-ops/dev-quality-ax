"use client";

import { useState } from "react";
import {
  DESIGN_AVATAR,
  DESIGN_CARRIED_TAG,
  DESIGN_CARRY_BUTTON,
  DESIGN_COMMON_BAR_COLOR,
  DESIGN_COMMON_PCT_TEXT_COLOR,
  DESIGN_DDAY_TONE,
  DESIGN_QUARTER_BADGE,
  DESIGN_REPEAT_TAG,
  DESIGN_REPEAT_TAG_OVERDUE,
  DESIGN_STATUS,
  DESIGN_SUB_BAR_COLOR,
  DESIGN_SUB_ITEM_INPROGRESS_ROW,
  DESIGN_SUB_ITEM_MARKER,
  DESIGN_SUB_PCT_TEXT_COLOR,
} from "@/lib/progress/designTokens";
import { PROGRESS_STATUS_LABEL, repeatDayLabel } from "@/lib/progress/constants";
import { currentStageText, effectiveRounds, isRepeatDueDayPassed, pw8ReviewBadge, releaseDday, sampleDday, subProjectItemSpan, type BadgeTone } from "@/lib/progress/derive";
import { compareQuarter, currentFiscalQuarter, quarterLabel, quartersBetween, type FiscalQuarter } from "@/lib/progress/date";
import type { ProgressCommonTaskItemRow, ProgressRegularProjectRow, ProgressSubProjectRow } from "@/lib/progress/types";
import { PROGRESS_UI_SCALE } from "./ProgressPageShell";
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

/** ①(제목)·②(PW 레일)·③(일정) 세 블록의 폭/간격 목표 — "실제로 보이는(줌
 * 적용 후) 값" 기준이다. PROGRESS_MAX_WIDTH_TARGET과 같은 이유로 소스 px를
 * 고정하지 않고 PROGRESS_UI_SCALE로 나눠서 구한다(배율이 바뀌어도 실제
 * 렌더 값은 그대로 유지). ③의 margin-left는 article 자체의
 * gap-x-[18px](실제 렌더 ARTICLE_GAP_SOURCE_PX×PROGRESS_UI_SCALE)에 더해져
 * ②-③ 사이 실제 총 간격이 ZONE3_MARGIN_LEFT_TARGET_PX가 되도록 역산한다
 * — article의 gap을 무시하고 margin만 목표값으로 두면 실제 간격이 그만큼
 * 더 벌어진다.
 *
 * zone2(PW 레일)는 ①·③처럼 고정 폭을 갖지 않는다 — flex: 1 1 0px로 ①·③이
 * 가져가고 남는 폭을 항상 전부 흡수한다(캡 없음). StageRail은 PW1~8을
 * grid-cols-8로 이 폭에 꽉 채워 그린다(칸 폭 = (zone2 폭 - gap 7개)/8).
 * 한때 여기에 max-width 캡(600px)을 걸었었는데, 카드 폭이 커질수록(예:
 * 2560px에서 카드 자체가 2230px) 캡에 막힌 zone2가 남는 폭을 못 가져가
 * zone3 오른쪽에 수백~1000px대 빈 공간이 남는 문제가 있었다 — 캡을
 * 완전히 제거해 항상 남는 폭 전부를 zone2가 흡수하도록 고쳤다. 초광폭
 * 화면에서 막대가 과도해지는 것이 걱정되면 zone2에 캡을 다시 걸지 말고
 * ProgressPageShell의 PROGRESS_MAX_WIDTH_TARGET(카드 전체 폭의 유일한
 * 제한 지점)을 낮출 것 — zone2에 숫자 폭을 넣으면 화면 폭이 바뀔 때마다
 * 그 숫자가 다시 안 맞아지는 문제가 반복된다.
 * flex-basis를 0으로 둬서(①·③은 각자 고정 폭을 이미 차지한 뒤) 줄바꿈
 * 여부는 항상 zone2가 최소 폭(0)인 상태로 판정되므로, 1440px 같은 좁은
 * 폭에서도 세 블록이 항상 한 줄을 유지한다. */
const ARTICLE_GAP_SOURCE_PX = 18; // article의 gap-x-[18px]와 반드시 일치해야 함
const ZONE1_WIDTH_TARGET_PX = 240;
const ZONE3_MARGIN_LEFT_TARGET_PX = 36;
const ZONE3_DATE_GAP_TARGET_PX = 28;

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
      {/* 왼쪽: 이름/D-day, 담당자/상태 — flex-grow 제거, 고정 basis(240px)만
          차지하고 남는 폭은 흡수하지 않는다(카드 우측 여백으로 남김). 긴
          제목은 basis 안에서 truncate로 잘린다(아래 title 버튼의
          min-w-0 shrink truncate). */}
      <div className="flex min-w-0 flex-col gap-[5px]" style={{ flex: `0 1 ${ZONE1_WIDTH_TARGET_PX / PROGRESS_UI_SCALE}px` }}>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            title="클릭하면 수정"
            onClick={onEdit}
            className="min-w-0 shrink truncate text-left text-[14px] font-semibold text-[#1b1f2b] hover:text-navy-700 hover:underline"
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

      {/* 가운데: PW 레일 + 현재 단계 문구 — ①·③이 가져가고 남는 폭을 이
          블록이 항상 전부 흡수한다(flex-grow 1, basis 0, 캡 없음). */}
      <div className="flex min-w-0 flex-col gap-1.5" style={{ flex: "1 1 0px" }}>
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
              <span className="min-w-0 shrink truncate text-[#4b5364]">{stageName}</span>
            </>
          ) : (
            <span className="min-w-0 shrink truncate text-[#4b5364]">{stageName}</span>
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

      {/* 오른쪽: Kick Off / 목표 출시 / 실제 출시 — ①·② 모두 flex-grow를
          없애 남는 폭을 흡수하지 않으므로(카드 우측 여백으로 남음), ③도
          flex: 0 0 auto로 내용 폭만 차지한다. 세 날짜 사이는 grid의 균등
          분할 대신 flex + gap으로 붙어 보이게 한다. 각 항목은 날짜 포맷
          (YYYY.MM.DD) 기준 고정 폭(64px)을 둬 값이 "—"여도 카드마다
          라벨·날짜 정렬이 흔들리지 않는다. */}
      <div
        className="flex items-start"
        style={{
          flex: "0 0 auto",
          marginLeft: ZONE3_MARGIN_LEFT_TARGET_PX / PROGRESS_UI_SCALE - ARTICLE_GAP_SOURCE_PX,
          gap: `${ZONE3_DATE_GAP_TARGET_PX / PROGRESS_UI_SCALE}px`,
        }}
      >
        <div style={{ width: 64 }}>
          <div className="whitespace-nowrap text-[10.5px] text-[#9aa1b1]" style={{ letterSpacing: "0.02em" }}>Kick Off</div>
          <div className="whitespace-nowrap text-[12.5px] tabular-nums text-[#4b5364]">{project.kickoffDate ? project.kickoffDate.replaceAll("-", ".") : "—"}</div>
        </div>
        <div style={{ width: 64 }}>
          <div className="whitespace-nowrap text-[10.5px] text-[#9aa1b1]" style={{ letterSpacing: "0.02em" }}>목표 출시</div>
          <div className="whitespace-nowrap text-[12.5px] tabular-nums text-[#1b1f2b]">{project.targetReleaseDate ? project.targetReleaseDate.replaceAll("-", ".") : "—"}</div>
        </div>
        <div style={{ width: 64 }}>
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
  onSetItemQuarter,
}: {
  project: ProgressSubProjectRow;
  quarter: FiscalQuarter;
  pending: boolean;
  onEdit: () => void;
  onStatusChange: (status: ProgressStatus) => void;
  onToggleItem: (itemId: string) => void;
  /** 요청 1 — "다음 분기로" 고정 이월 버튼 대신, 항목의 분기 배지 자체를
   * 버튼으로 만들어 눌렀을 때 이 프로젝트에 이미 설정된 분기 구간
   * (project.quarterStart~End) 중 아무 분기로나 바로 옮길 수 있게 한다. */
  onSetItemQuarter: (itemId: string, year: number, q: number) => void;
}) {
  // 항목별 분기 선택 드롭다운 — 한 카드 안에서 한 번에 하나만 열린다
  // (StageRail의 openIndex와 동일한 패턴).
  const [openQuarterItemId, setOpenQuarterItemId] = useState<string | null>(null);
  const projectQuarters = quartersBetween(
    { year: project.quarterStartYear, q: project.quarterStartQ as 1 | 2 | 3 | 4 },
    { year: project.quarterEndYear, q: project.quarterEndQ as 1 | 2 | 3 | 4 },
  );
  const doneTotal = project.items.filter((it) => it.status === "DONE").length;
  const total = project.items.length;
  const pct = total ? Math.round((doneTotal / total) * 100) : 0;
  const thisQItems = project.items.filter((it) => it.quarterYear === quarter.year && it.quarterNum === quarter.q);
  const doneThisQ = thisQItems.filter((it) => it.status === "DONE").length;
  const span = subProjectItemSpan(project.items);
  const spanLabel = span ? (span.start.year === span.end.year && span.start.q === span.end.q ? `${span.start.year} Q${span.start.q}` : `${span.start.year} Q${span.start.q} – ${span.end.year} Q${span.end.q}`) : "";
  // "미완료 중 강조할 항목" — 진행중 항목이 있으면 그 항목 하나만 강조하고
  // (이미 amber 행 강조가 있으니 중복 강조 방지), 없으면 종전대로 첫
  // 미완료(예정) 항목을 강조한다.
  const firstIncompleteId = thisQItems.find((it) => it.status === "IN_PROGRESS")?.id ?? thisQItems.find((it) => it.status !== "DONE")?.id;
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

      <div className="flex min-w-0 items-center gap-2">
        <button type="button" title="클릭하면 수정" onClick={onEdit} className="min-w-0 shrink truncate text-left text-[14px] font-semibold text-[#1b1f2b] hover:text-navy-700 hover:underline" style={{ letterSpacing: "-0.01em" }}>
          {project.name}
        </button>
        {project.sheetUrl && (
          <a href={project.sheetUrl} target="_blank" rel="noreferrer" title="산출물 시트 열기" className="shrink-0 whitespace-nowrap rounded-md border border-navy-100 bg-navy-50 px-2 py-0.5 text-[11px] text-navy-700 no-underline">
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
          const inProgress = it.status === "IN_PROGRESS";
          const isCur = !done && it.id === firstIncompleteId;
          const idx = project.items.findIndex((x) => x.id === it.id);
          const marker = DESIGN_SUB_ITEM_MARKER[it.status];
          return (
            <div
              key={it.id}
              className="flex w-full items-center gap-2 rounded-[7px] border px-2 py-[5px]"
              style={inProgress ? { borderColor: DESIGN_SUB_ITEM_INPROGRESS_ROW.border, background: DESIGN_SUB_ITEM_INPROGRESS_ROW.background } : { borderColor: "transparent" }}
            >
              <button
                type="button"
                disabled={pending}
                title={done ? "예정으로 되돌리기" : "완료로 전환"}
                onClick={() => onToggleItem(it.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-[#f7f9fc]"
              >
                <span
                  className="box-border shrink-0 rounded-full"
                  style={{ width: 11, height: 11, border: `1.5px solid ${marker.border}`, background: marker.background }}
                />
                <span className="shrink-0 text-[11px] tabular-nums text-[#9aa1b1]">{String(idx + 1).padStart(2, "0")}</span>
                <span
                  className="min-w-0 flex-1 truncate text-[12.5px]"
                  style={{ color: done ? "#8a91a3" : "#1b1f2b", fontWeight: isCur ? 600 : 400, textDecoration: done ? "line-through" : "none" }}
                >
                  {it.text}
                </span>
              </button>
              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={pending}
                  title="분기 변경"
                  onClick={() => setOpenQuarterItemId((v) => (v === it.id ? null : it.id))}
                  className="whitespace-nowrap rounded-full px-[9px] py-0.5 text-[10.5px] font-semibold hover:!border-amber-200 hover:!bg-amber-50 hover:!text-amber-700"
                  style={{ color: DESIGN_CARRY_BUTTON.color, background: DESIGN_CARRY_BUTTON.bg, border: `1px solid ${DESIGN_CARRY_BUTTON.border}` }}
                >
                  {it.quarterYear} Q{it.quarterNum}
                </button>
                {openQuarterItemId === it.id && (
                  <>
                    <div className="fixed inset-0 z-[6]" onClick={() => setOpenQuarterItemId(null)} />
                    <div
                      className="absolute right-0 top-full z-[6] mt-1.5 flex min-w-[96px] flex-col gap-0.5 rounded-[9px] border border-[#d5dbe5] bg-white p-[5px]"
                      style={{ boxShadow: "0 10px 26px rgba(18,22,34,0.16)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {projectQuarters.map((fq) => {
                        const active = fq.year === it.quarterYear && fq.q === it.quarterNum;
                        return (
                          <button
                            key={`${fq.year}-${fq.q}`}
                            type="button"
                            onClick={() => {
                              onSetItemQuarter(it.id, fq.year, fq.q);
                              setOpenQuarterItemId(null);
                            }}
                            className="whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] text-[#1b1f2b] hover:bg-[#f1f4f8]"
                            style={{ background: active ? "#f1f4f8" : "none", fontWeight: active ? 600 : 400 }}
                          >
                            {fq.year} Q{fq.q}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
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
          const marker = DESIGN_SUB_ITEM_MARKER[it.status];
          const canCarry = !done;
          const overdue = it.repeat && !done && isRepeatDueDayPassed(it.repeatDay, month);
          const repeatTagTone = overdue ? DESIGN_REPEAT_TAG_OVERDUE : DESIGN_REPEAT_TAG;
          return (
            <div key={it.itemId} className="flex items-center gap-2 rounded-md px-[7px] py-[5px] hover:bg-[#f7f9fc]">
              <button
                type="button"
                disabled={pending}
                title={done ? "예정으로 되돌리기" : "완료로 전환"}
                onClick={() => onToggleItem(it.itemId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className="box-border shrink-0 rounded-full"
                  style={{ width: 11, height: 11, border: `1.5px solid ${marker.border}`, background: marker.background }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[12.5px]"
                  style={{ color: done ? "#8a91a3" : "#1b1f2b", textDecoration: done ? "line-through" : "none" }}
                >
                  {it.taskName}
                </span>
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
                title="클릭하면 수정"
                onClick={() => onEditTask(it.taskId)}
                className="shrink-0 whitespace-nowrap text-[10.5px] text-neutral-300 hover:text-navy-700"
              >
                수정
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
