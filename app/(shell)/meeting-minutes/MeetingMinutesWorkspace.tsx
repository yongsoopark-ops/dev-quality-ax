"use client";

import { useState } from "react";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import { getMeetingMinutesDraftAction, type MeetingMinutesDraft } from "@/lib/meetingMinutes/draft";
import type { MeetingTemplateInfo } from "@/lib/meetingTemplates/actions";
import { MEETING_TEMPLATE_TYPE_LABELS, MEETING_TEMPLATE_TYPE_OPTIONS } from "@/lib/meetingTemplates/constants";
import { isSupportedMeetingMinutesType } from "@/lib/meetingMinutes/workspaceTypes";
import { MeetingMinutesPreviewClient } from "../meeting-minutes-preview/MeetingMinutesPreviewClient";
import { MeetingTemplateManager } from "../meeting-templates/MeetingTemplateManager";

type Mode = "write" | "template";

/**
 * Step(회의록 Workspace 회의유형 공통화) — 이전 통합 Step까지는 "회의록
 * 작성"이 사실상 PART_WEEKLY_MEETING 하나였다. 이번 Step에서 상단에 회의
 * 유형 선택을 추가해, 선택한 유형에 맞는 작성본을 lib/meetingMinutes/draft.ts
 * 의 Builder map을 통해 불러온다.
 *
 * - PART_WEEKLY_MEETING: Schedule 자동입력 + 기본정보 자동입력(기존 로직)
 * - KICK_OFF / GATE_REVIEW: 활성 Template clone만(Schedule 집계 없음)
 * - EXECUTIVE_WEEKLY_REPORT: 이번 Step 대상 아님 — 선택지에서 비활성화
 *
 * "회의록 작성"/"양식 설정" mode 전환과 ADMIN 전용 gating은 이전 통합 Step과
 * 동일하게 유지한다 — 이번 Step은 그 위에 "회의 유형" 축 하나를 추가할 뿐이다.
 */
export function MeetingMinutesWorkspace({
  isAdmin,
  initialType,
  initialDraft,
  initialDraftError,
  initialTemplates,
  initialTemplatesError,
}: {
  isAdmin: boolean;
  initialType: MeetingTemplateType;
  initialDraft: MeetingMinutesDraft | null;
  initialDraftError: string | null;
  initialTemplates: MeetingTemplateInfo[];
  initialTemplatesError: string | null;
}) {
  const [mode, setMode] = useState<Mode>("write");
  const [selectedType, setSelectedType] = useState<MeetingTemplateType>(initialType);
  const [draft, setDraft] = useState<MeetingMinutesDraft | null>(initialDraft);
  const [draftError, setDraftError] = useState<string | null>(initialDraftError);
  const [loadingDraft, setLoadingDraft] = useState(false);

  async function handleTypeChange(next: MeetingTemplateType) {
    if (next === selectedType) return;
    setSelectedType(next);
    setLoadingDraft(true);
    try {
      const res = await getMeetingMinutesDraftAction(next);
      setDraft(res.draft ?? null);
      setDraftError(res.draft ? null : (res.error ?? "회의록을 불러오지 못했습니다."));
    } catch {
      setDraft(null);
      setDraftError("회의록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoadingDraft(false);
    }
  }

  return (
    <>
      {/* Step(일정 관리 + 회의록 UI Polish) — Page Title 존재감 강화(요청사항
          1): text-lg(18px)/semibold → text-3xl(30px)/bold. 회의 유형별
          compact 컨텍스트("파트 주간회의 · 9월 2주차 · 회의일")는 weeklyInfo
          (일정 불러오기 이후에만 존재)를 들고 있는 MeetingMinutesPreviewClient
          쪽에서 표시한다(요청사항 8) — 여기 제목은 회의 유형과 무관한 고정
          타이틀로 단순하게 유지한다. */}
      <div className="shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-navy-950">회의록</h1>
            <p className="mt-1.5 text-sm text-navy-950/60">
              {mode === "write"
                ? "편집 내용은 자동저장되어 새로고침·재접속 후에도 유지됩니다."
                : "회의록 작성 화면에서 자동으로 채워질 양식을 관리합니다."}
            </p>
          </div>

          {isAdmin && (
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-navy-100 bg-navy-50/60 p-1 text-xs">
              <button
                type="button"
                onClick={() => setMode("write")}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  mode === "write" ? "bg-white text-navy-950 shadow-sm" : "text-navy-950/50 hover:text-navy-950"
                }`}
              >
                회의록 작성
              </button>
              <button
                type="button"
                onClick={() => setMode("template")}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  mode === "template" ? "bg-white text-navy-950 shadow-sm" : "text-navy-950/50 hover:text-navy-950"
                }`}
              >
                양식 설정
              </button>
            </div>
          )}
        </div>

        {/* 회의 유형 선택 — "양식 설정" 모드에서는 Template 자체의 회의
            유형을 TemplateEditor 안의 select로 다루므로, 이 선택은 "회의록
            작성" 모드에서만 의미가 있다(요청사항: 작성 화면 상단에 추가). */}
        {(mode === "write" || !isAdmin) && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="meeting-minutes-type" className="text-xs text-navy-950/50">
              회의 유형
            </label>
            <select
              id="meeting-minutes-type"
              value={selectedType}
              onChange={(e) => handleTypeChange(e.target.value as MeetingTemplateType)}
              disabled={loadingDraft}
              className="rounded border border-navy-100/70 bg-white px-2 py-1 text-xs text-navy-950 disabled:opacity-50"
            >
              {MEETING_TEMPLATE_TYPE_OPTIONS.map((t) => {
                const supported = isSupportedMeetingMinutesType(t);
                return (
                  <option key={t} value={t} disabled={!supported}>
                    {MEETING_TEMPLATE_TYPE_LABELS[t]}
                    {!supported && " (준비 중)"}
                  </option>
                );
              })}
            </select>
            {loadingDraft && <span className="text-xs text-navy-950/40">불러오는 중...</span>}
          </div>
        )}
      </div>

      <div className="mt-7 min-h-0 flex-1 overflow-y-auto">
        {mode === "write" || !isAdmin ? (
          <MeetingMinutesPreviewClient
            draft={draft}
            error={draftError}
            isAdmin={isAdmin}
            onGoToTemplateSettings={() => setMode("template")}
          />
        ) : (
          <MeetingTemplateManager
            initialTemplates={initialTemplates}
            initialError={initialTemplatesError}
            initialMeetingType={selectedType}
          />
        )}
      </div>
    </>
  );
}
