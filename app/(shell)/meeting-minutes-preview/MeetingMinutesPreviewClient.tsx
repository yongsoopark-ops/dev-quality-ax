"use client";

import { useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { TemplateRichTextEditor } from "../meeting-templates/TemplateRichTextEditor";
import { MEETING_TEMPLATE_TYPE_LABELS } from "@/lib/meetingTemplates/constants";
import { normalizeHeadingText } from "@/lib/meetingMinutes/sectionHeadings";
import { resetMeetingMinutesDraftAction, saveMeetingMinutesDraftAction, type MeetingMinutesDraft } from "@/lib/meetingMinutes/draft";
import { loadWeeklyScheduleIntoDraftAction, type WeeklyScheduleLoadResult } from "@/lib/meetingMinutes/actions";

/** 자동저장 debounce 간격 — 편집 중 매 키 입력마다 저장 요청을 보내지 않게
 * (요청사항: "과도한 요청을 피하도록 debounce 적용") 마지막 변경 후 이
 * 시간만큼 조용하면 그때 한 번만 저장한다. */
const AUTOSAVE_DEBOUNCE_MS = 1500;

/** DOCX 파일명의 "제목" 부분 — 문서의 첫 heading 텍스트에서 이모지/기호를
 * 뗀 것을 쓴다(요청사항 예시: "🗓️ 주간 업무 회의록" → "주간 업무
 * 회의록_2026-09-07.docx"). heading normalize는 이미 meetingSection 판별에
 * 쓰는 것과 같은 함수를 그대로 재사용한다. */
/** Step(일정 관리 + 회의록 UI Polish) — 저빈도·위험 액션("초기화")을 담는
 * "⋯" 메뉴(요청사항 9). ScheduleFilterBar.tsx의 FilterTrigger와 같은
 * click-outside-to-close 패턴이다. */
function OverflowMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="더 보기"
        className="flex h-7 w-7 items-center justify-center rounded-md text-navy-950/50 hover:bg-navy-50"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-navy-100 bg-white p-1 shadow-lg" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function extractDocumentTitle(doc: JSONContent): string {
  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      const text = (node.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
      return normalizeHeadingText(text);
    }
  }
  return "";
}

/**
 * Step(`일정 불러오기` 버튼 Trigger 전환) — PART_WEEKLY_MEETING이 화면
 * 진입/새로고침만으로 Schedule을 자동 조회하던 것을 명시적 버튼 Trigger로
 * 바꿨다(요청사항). draft(부모가 최초 1회 서버에서 받아오는 것)에는 이제
 * Schedule 관련 값이 전혀 없다 — 그 값들은 이 컴포넌트의 로컬 state
 * (weeklyInfo)로만 존재하고, `일정 불러오기`를 눌렀을 때만 채워진다.
 * 새로고침하면 이 state가 통째로 사라지고 draft 기반 초기 상태로 돌아간다
 * (요청사항: "새로고침 시 Template 기반 초기 Draft로 복귀, 다시 반영하려면
 * 버튼 클릭").
 */
export function MeetingMinutesPreviewClient({
  draft,
  error,
  isAdmin,
  onGoToTemplateSettings,
}: {
  draft: MeetingMinutesDraft | null;
  error: string | null;
  isAdmin: boolean;
  /** "사용 중인 양식이 없습니다" 안내에서 ADMIN이 누르는 "양식 설정으로
   * 이동" 버튼이 호출한다 — 실제 모드 전환은 부모(MeetingMinutesWorkspace)
   * 가 소유한다. */
  onGoToTemplateSettings: () => void;
}) {
  const [documentContent, setDocumentContent] = useState<JSONContent | null>(draft?.document ?? null);
  const [weeklyInfo, setWeeklyInfo] = useState<WeeklyScheduleLoadResult | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [loadFeedback, setLoadFeedback] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // Step(회의록 Draft 저장/초기화 정책) — 자동저장 최소 UX 3종(요청사항):
  // "저장 중.../저장됨/저장 실패". "idle"은 아직 한 번도 저장 시도가 없던
  // 상태(막 화면에 들어왔을 때)라 아무 문구도 보여주지 않는다.
  // Step(V1 코드 건강도 / 안정화 점검) — "conflict"는 낙관적 동시성 충돌
  // (다른 사용자가 그 사이 먼저 저장/초기화함)을 "error"(네트워크/서버 오류)
  // 와 구분해 보여준다 — 사용자가 원인을 오해하지 않도록.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  // Step(Draft/Template 버전 비교 + 양식 변경 안내) — draft prop 자체는
  // 초기화해도 바뀌지 않는다(handleReset은 documentContent만 로컬로 바꾼다,
  // 아래 참고) — 그래서 배너 표시 여부는 draft.templateOutdated를 그대로
  // 읽지 않고 이 로컬 state로 관리한다: draft가 바뀔 때만(회의 유형 전환)
  // draft.templateOutdated로 다시 맞추고, 초기화에 성공하면 즉시 false로
  // 내린다(방금 최신 Template을 clone했으므로).
  const [templateOutdated, setTemplateOutdated] = useState(draft?.templateOutdated ?? false);
  // TemplateRichTextEditor(Tiptap)는 value prop을 "최초 마운트 시점 초기값"
  // 으로만 쓰므로(useEditor가 이후 prop 변경을 반영하지 않음), `일정
  // 불러오기`/초기화로 documentContent가 바뀔 때마다 key를 바꿔 강제로 다시
  // 마운트한다 — 회의 유형 전환(key: meetingType)과 같은 이유다.
  const [reloadNonce, setReloadNonce] = useState(0);

  // 자동저장 debounce 타이머 — draft(회의 유형)가 바뀌거나 컴포넌트가
  // unmount되면 반드시 취소한다(그러지 않으면 전환 직후 이전 회의 유형용
  // 저장 요청이 뒤늦게 나가버린다). ref는 렌더 중이 아니라 effect
  // cleanup에서만 읽는다(react-hooks/refs 규칙 — 렌더 중 ref 접근 금지).
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [draft]);

  // Step(V1 코드 건강도 / 안정화 점검) — 낙관적 동시성 제어 기준값. state가
  // 아니라 ref인 이유: 화면에 직접 표시하지 않고(내부 검증용), debounce
  // 타임아웃 콜백이 "예약된 시점"이 아니라 "실제로 실행되는 시점"의 최신
  // 값을 읽어야 하기 때문이다(state를 클로저로 캡처하면 그 사이 다른 저장이
  // 성공해 버전이 올라가도 그걸 반영하지 못한다). ref 값은 렌더 중이 아니라
  // 아래 effect에서만 draft 기준으로 맞춘다(react-hooks/refs 규칙 — 다른
  // ref들과 동일한 원칙, 상단 saveTimeoutRef 주석 참고).
  const versionRef = useRef(draft?.version ?? 0);
  useEffect(() => {
    versionRef.current = draft?.version ?? 0;
  }, [draft]);

  // draft 참조가 바뀌면(회의 유형 전환으로 새 작성본을 받으면) 편집 중이던
  // 이전 내용과 이전에 불러온 Schedule 상태를 전부 새 draft 기준으로
  // 리셋한다 — useEffect가 아니라 렌더 중 비교라 추가 렌더 없이 한 번에
  // 반영된다(React 공식 문서의 "Adjusting state when a prop changes" 패턴).
  const [prevDraft, setPrevDraft] = useState(draft);
  if (draft !== prevDraft) {
    setPrevDraft(draft);
    setDocumentContent(draft?.document ?? null);
    setWeeklyInfo(null);
    setLoadFeedback(null);
    setLoadError(null);
    setDownloadError(null);
    setSaveStatus("idle");
    setTemplateOutdated(draft?.templateOutdated ?? false);
  }

  /** Step(회의록 Draft 저장/초기화 정책) — Tiptap Editor의 onChange가 호출될
   * 때(=사용자가 직접 타이핑/서식 변경했을 때)만 자동저장을 예약한다.
   * `일정 불러오기`/초기화로 documentContent를 바꾸는 경로(handleLoadSchedule/
   * handleReset)는 이 함수를 거치지 않고 setDocumentContent를 직접 호출한다
   * — 그 값들은 그 즉시 이미 서버가 만든 최신 상태이므로 다시 저장할
   * 필요가 없을뿐더러, 저장 여부를 "편집 이벤트 발생 여부"로만 판단해야
   * 화면 state와 자동저장 트리거가 절대 엇갈리지 않는다. */
  function handleEditorChange(next: JSONContent) {
    setDocumentContent(next);
    if (!draft) return;
    const meetingType = draft.meetingType;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const res = await saveMeetingMinutesDraftAction(meetingType, JSON.stringify(next), versionRef.current);
        // 저장 실패해도 화면에 이미 입력된 내용(documentContent)은 절대
        // 건드리지 않는다(요청사항) — 상태 문구만 바꾼다.
        if (res.conflict) {
          // 다른 사용자(또는 이 화면의 초기화)가 그 사이 먼저 저장해 버전이
          // 앞서갔다 — 지금 이 편집 내용을 조용히 덮어쓰지 않고 알린다.
          // 서버가 알려준 최신 version은 받아들여서(다음 자동저장부터는
          // 정상 반영되도록) 계속 막히지 않게 한다 — 실시간 병합은 하지
          // 않지만(요청사항 범위 밖), 사용자가 다시 저장을 시도하면 통과한다.
          if (typeof res.version === "number") versionRef.current = res.version;
          setSaveStatus("conflict");
        } else if (res.error) {
          setSaveStatus("error");
        } else {
          if (typeof res.version === "number") versionRef.current = res.version;
          setSaveStatus("saved");
        }
      } catch {
        setSaveStatus("error");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** 초기화 — confirmation 1회 후 활성 Template 골격만 다시 clone한다
   * (요청사항: "초기화 실행 전 DOCX 다운로드를 강제하지 않는다" — confirm
   * 문구에서 권장만 하고, 버튼 자체는 즉시 진행한다). */
  async function handleReset() {
    if (!draft) return;
    const confirmed = window.confirm("현재 작성된 회의록 내용을 모두 초기화할까요?\n필요한 경우 먼저 DOCX를 다운로드해 주세요.");
    if (!confirmed) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setResetting(true);
    setLoadError(null);
    setDownloadError(null);
    try {
      const res = await resetMeetingMinutesDraftAction(draft.meetingType);
      if (res.error || !res.draft) {
        setLoadError(res.error ?? "초기화하지 못했습니다.");
        return;
      }
      // 초기화는 AUTO 데이터(일정 불러오기 결과)도 함께 지운다(요청사항:
      // "Schedule AUTO 데이터도 초기화됨") — Template 골격에는 애초에
      // Schedule 자동입력 값이 없으므로 weeklyInfo를 비우는 것만으로 충분하다.
      setDocumentContent(res.draft.document);
      setWeeklyInfo(null);
      setLoadFeedback(null);
      setSaveStatus("idle");
      setTemplateOutdated(false); // 방금 최신 Template을 clone했으므로
      versionRef.current = res.draft.version; // 서버가 방금 올린 version을 기준으로 맞춘다
      setReloadNonce((n) => n + 1);
    } catch {
      setLoadError("초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setResetting(false);
    }
  }

  async function handleLoadSchedule() {
    if (!documentContent) return;
    // Step(V1 코드 건강도 / 안정화 점검) — 타이핑 중 debounce 타이머가 아직
    // 대기 중일 때 곧바로 `일정 불러오기`를 누르면, 그 pending autosave가
    // 나중에 도착해 방금 병합한 AUTO 데이터를 덮어쓸 수 있었다(구버전
    // documentContent 기준). 이 버튼 클릭 자체가 이미 최신 내용을 즉시
    // 저장하므로, 대기 중이던 자동저장은 취소한다.
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setLoadingSchedule(true);
    setLoadError(null);
    setLoadFeedback(null);
    try {
      // 지금 화면에 있는 문서를 그대로 넘긴다 — 서버는 이 문서 위에
      // Schedule AUTO 데이터만 병합하고, 사용자가 적어 둔 특이 사항/결정
      // 내용/향후 일정/주요 안건 등은 그대로 둔다(mergeSectionsIntoDocument).
      // JSON 문자열로 직렬화해서 넘긴다 — 실제로 재현한 문제: 반복되는
      // attrs 모양이 많은 큰 문서를 객체 그대로 Server Action 인자로 넘기면
      // 일부 heading의 attrs.level(H1/H2/H3 구분)이 사라지는 현상이 있었다
      // (lib/meetingMinutes/actions.ts의 documentJson 주석과 같은 문제,
      // TemplateEditor.tsx 저장 경로와 동일한 우회).
      const res = await loadWeeklyScheduleIntoDraftAction(JSON.stringify(documentContent));
      if (res.error || !res.result) {
        // 오류 시 기존 문서를 지우지 않는다(요청사항) — documentContent는
        // 건드리지 않고 오류만 표시한다.
        setLoadError(res.error ?? "일정을 불러오지 못했습니다.");
        return;
      }
      // documentJson은 Next.js Server Action 반환값 직렬화 문제를 피하려고
      // 문자열로 내려온다(lib/meetingMinutes/actions.ts 주석 참고) — 여기서
      // 파싱한다.
      const merged = JSON.parse(res.result.documentJson) as JSONContent;
      setDocumentContent(merged);
      setWeeklyInfo(res.result);
      setReloadNonce((n) => n + 1);
      setLoadFeedback(res.result.taskCount > 0 ? `일정 ${res.result.taskCount}건을 불러왔습니다.` : "불러올 일정이 없습니다.");

      // `일정 불러오기` 결과도 Draft에 곧바로 저장한다 — 이 버튼 클릭 자체가
      // 이미 "명시적인 사용자 Trigger"이므로 별도 debounce 없이 즉시
      // 저장한다. 이렇게 하지 않으면 클릭 직후 추가 타이핑 없이 새로고침할
      // 경우 방금 불러온 AUTO 데이터가 사라져버린다(요청사항: "새로고침으로
      // 작성내용이 초기화되지 않게").
      if (draft) {
        setSaveStatus("saving");
        try {
          const saveRes = await saveMeetingMinutesDraftAction(draft.meetingType, JSON.stringify(merged), versionRef.current);
          if (saveRes.conflict) {
            if (typeof saveRes.version === "number") versionRef.current = saveRes.version;
            setSaveStatus("conflict");
          } else if (saveRes.error) {
            setSaveStatus("error");
          } else {
            if (typeof saveRes.version === "number") versionRef.current = saveRes.version;
            setSaveStatus("saved");
          }
        } catch {
          setSaveStatus("error");
        }
      }
    } catch {
      setLoadError("일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoadingSchedule(false);
    }
  }

  /** Step(파트 주간회의 Table UX + AUTO 필드 개편) — "현재 사용자가 보고/
   * 편집 중인 Draft"를 그대로 내려받는다(요청사항: Template 원본이 아니다).
   * 다운로드는 DB 저장을 의미하지 않는다 — Route Handler(app/api/meeting-minutes/
   * export-docx)는 documentContent를 받아 .docx로 변환만 하고 아무것도
   * 저장하지 않는다. */
  async function handleDownloadDocx() {
    if (!documentContent) return;
    setDownloadingDocx(true);
    setDownloadError(null);
    try {
      const title = extractDocumentTitle(documentContent) || "회의록";
      const dateOnly = weeklyInfo?.meetingDateTime?.split(" ")[0] ?? new Date().toISOString().slice(0, 10);
      const fileName = `${title}_${dateOnly}.docx`;

      const res = await fetch("/api/meeting-minutes/export-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentContent, fileName }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setDownloadError(data?.error ?? "DOCX 파일을 만들지 못했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("DOCX 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDownloadingDocx(false);
    }
  }

  if (error || !draft) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error ?? "회의록을 불러오지 못했습니다."}
      </div>
    );
  }

  if (draft.templateMissing) {
    return (
      <div className="rounded-md border border-navy-100 bg-navy-50/60 p-6 text-sm">
        <p className="font-medium text-navy-950">사용 중인 양식이 없습니다.</p>
        <p className="mt-1 text-navy-950/60">
          {MEETING_TEMPLATE_TYPE_LABELS[draft.meetingType]} 회의록을 작성하려면 먼저 활성 Template을 지정해야 합니다.
        </p>
        {isAdmin ? (
          <button
            type="button"
            onClick={onGoToTemplateSettings}
            className="mt-3 rounded-md bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-navy-800"
          >
            양식 설정으로 이동
          </button>
        ) : (
          <p className="mt-3 text-xs text-navy-950/50">관리자에게 Template 활성화를 요청해 주세요.</p>
        )}
      </div>
    );
  }

  // `일정 불러오기`는 PART_WEEKLY_MEETING 전용이다(요청사항: "Kick Off/Gate
  // Review는 버튼 미노출"). Schedule 자동입력 정보 카드/배너도 이 유형에서만
  // 의미가 있다.
  const isWeeklyMeeting = draft.meetingType === "PART_WEEKLY_MEETING";

  return (
    <div className="space-y-4">
      {/* Step(Draft/Template 버전 비교 + 양식 변경 안내) — DB 값 비교
          (draft.templateOutdated, lib/meetingMinutes/draft.ts isTemplateOutdated)
          로만 판별한다. 여기서는 그 결과를 보여주기만 하고 절대 Draft 내용을
          자동으로 바꾸지 않는다 — 사용자가 직접 초기화를 눌러야 한다
          (요청사항: "Template 변경 시 기존 Draft 자동 덮어쓰기 금지"). */}
      {templateOutdated && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          회의록 양식이 변경되었습니다.
          <br />
          최신 양식을 적용하려면 초기화해 주세요.
          <br />
          초기화 시 현재 작성 내용은 삭제됩니다.
        </div>
      )}

      {/* Step(일정 관리 + 회의록 UI Polish) — "회의 유형/기반 Template" 카드
          중복 제거(요청사항 8). Template 이름은 ADMIN이 양식 설정에서 확인
          가능하니 여기서는 compact 한 줄 컨텍스트("파트 주간회의 · 9월
          2주차 · 2026-09-07")로 대신한다 — 일정 불러오기 전에는 회의 유형만
          보인다. */}
      <p className="text-sm font-medium text-navy-950/70">
        {MEETING_TEMPLATE_TYPE_LABELS[draft.meetingType]}
        {weeklyInfo?.meetingWeek && ` · ${weeklyInfo.meetingWeek}`}
        {weeklyInfo?.meetingDateTime && ` · ${weeklyInfo.meetingDateTime.split(" ")[0]}`}
      </p>

      {/* Schedule 자동입력 결과 카드는 `일정 불러오기`를 눌러 weeklyInfo가
          채워진 뒤에만 표시한다 — 누르기 전에는 Schedule을 조회조차 하지
          않으므로 보여줄 값 자체가 없다(요청사항). 세로 padding을 줄여
          compact하게(요청사항 10과 같은 방향). */}
      {weeklyInfo && (
        <div className="grid grid-cols-3 gap-3 rounded-md border border-navy-100 bg-navy-50/60 px-3 py-2 text-sm">
          <div>
            <p className="text-xs text-navy-950/50">대상 업무기간</p>
            <p className="font-medium text-navy-950">
              {weeklyInfo.range.start} ~ {weeklyInfo.range.end}
            </p>
          </div>
          <div>
            <p className="text-xs text-navy-950/50">실제 회의 일시</p>
            <p className="font-medium text-navy-950">{weeklyInfo.meetingDateTime ?? "확인 필요"}</p>
          </div>
          <div>
            <p className="text-xs text-navy-950/50">자동입력된 업무 수</p>
            <p className="font-medium text-navy-950">{weeklyInfo.taskCount}건</p>
          </div>
        </div>
      )}

      {/* Step(일정 관리 + 회의록 UI Polish) — Workspace Header 액션 위계
          정리(요청사항 9): Primary(일정 불러오기)는 그대로 강조된 버튼,
          Secondary(DOCX 다운로드)는 outline 버튼 + 그 옆에 compact 저장
          상태 텍스트(버튼이 아니다). 저빈도·파괴적인 "초기화"는 항상 빨간
          버튼으로 노출하지 않고 "⋯" 메뉴 안으로 옮겼다 — 클릭 후 나오는
          메뉴 항목 자체는 여전히 빨간 글씨로 위험성을 표시한다. */}
      <div className="flex flex-wrap items-center gap-2">
        {isWeeklyMeeting && (
          <button
            type="button"
            onClick={handleLoadSchedule}
            disabled={loadingSchedule || !documentContent}
            className="rounded-md bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {loadingSchedule ? "일정 불러오는 중..." : "일정 불러오기"}
          </button>
        )}
        {/* DOCX 다운로드 — 웹 UI(이 Toolbar/버튼/경고 배너)는 documentContent
            밖에 있는 React 렌더링이라 애초에 변환 대상에 포함되지 않는다
            (요청사항: "웹 UI는 제외"). 대상은 지금 이 화면의 Draft
            (documentContent) 그대로다. */}
        <button
          type="button"
          onClick={handleDownloadDocx}
          disabled={downloadingDocx || !documentContent}
          className="rounded-md border border-navy-200 px-3.5 py-1.5 text-xs font-medium text-navy-950/80 hover:bg-navy-50 disabled:opacity-50"
        >
          {downloadingDocx ? "DOCX 만드는 중..." : "DOCX 다운로드"}
        </button>
        {/* 자동저장 최소 UX 3종(요청사항): 저장 중.../저장됨/저장 실패 —
            버튼이 아니라 compact 텍스트다. idle(아직 편집 없음)에는 아무것도
            보여주지 않는다. */}
        <span className="text-xs">
          {saveStatus === "saving" && <span className="text-navy-950/40">저장 중...</span>}
          {saveStatus === "saved" && <span className="text-navy-950/40">저장됨 ✓</span>}
          {saveStatus === "error" && <span className="text-red-600">저장 실패</span>}
          {saveStatus === "conflict" && <span className="text-amber-700">다른 사용자가 방금 저장함</span>}
        </span>

        <OverflowMenu>
          {/* 초기화 — confirmation 1회 후에만 실행한다(요청사항). 새로고침/
              `일정 불러오기`와 완전히 분리된 별도 버튼 Trigger다. */}
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting || !documentContent}
            className="w-full whitespace-nowrap rounded px-3 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {resetting ? "초기화하는 중..." : "초기화"}
          </button>
        </OverflowMenu>

        {loadFeedback && !loadError && <span className="text-xs text-emerald-700">{loadFeedback}</span>}
        {loadError && <span className="text-xs text-red-600">{loadError}</span>}
        {downloadError && <span className="text-xs text-red-600">{downloadError}</span>}
        {saveStatus === "error" && <span className="text-xs text-red-600">다음 자동저장에서 다시 시도합니다.</span>}
        {saveStatus === "conflict" && (
          <span className="text-xs text-amber-700">다른 사용자가 먼저 저장했습니다 — 계속 입력하면 다음 자동저장부터 정상 반영됩니다.</span>
        )}
      </div>

      {weeklyInfo?.meetingNotFoundReason && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {weeklyInfo.meetingNotFoundReason} 회의 일시/장소/참석 예정자는 자동입력되지 않았습니다.
        </div>
      )}

      {weeklyInfo && weeklyInfo.missingHeadings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          다음 섹션의 heading을 문서에서 찾지 못해 자동 반영하지 못했습니다: {weeklyInfo.missingHeadings.join(", ")}. 회의록
          Template에서 해당 제목이 그대로 있는지 확인해 주세요.
        </div>
      )}

      {weeklyInfo && weeklyInfo.missingFields.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          다음 회의 기본정보 항목을 문서에서 찾지 못해 자동 반영하지 못했습니다: {weeklyInfo.missingFields.join(", ")}. 회의록
          Template에 해당 라벨이 그대로(&quot;라벨:&quot; 형태) 있는지 확인해 주세요.
        </div>
      )}

      {/* key — 회의 유형이 바뀌거나(meetingType) `일정 불러오기`/초기화로
          문서가 갱신될 때마다(reloadNonce) Editor를 강제로 다시 마운트한다.
          Tiptap의 useEditor는 value(content)를 최초 마운트 시점 초기값으로만
          쓰고 이후 prop 변경을 반영하지 않기 때문이다(TemplateRichTextEditor.tsx
          참고). onChange는 handleEditorChange — 사용자가 직접 편집했을 때만
          자동저장을 예약한다(handleLoadSchedule/handleReset은 이 경로를
          거치지 않고 setDocumentContent를 직접 호출한다). */}
      {documentContent && (
        <TemplateRichTextEditor key={`${draft.meetingType}-${reloadNonce}`} value={documentContent} onChange={handleEditorChange} />
      )}
    </div>
  );
}
