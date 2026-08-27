"use client";

import { useState } from "react";
import { executeW3AutomationAction, executeW4AutomationAction, runChatCommandAction } from "./actions";
import type { ChatCommandResult, W3ExecutionOutcome, W4ExecutionOutcome } from "@/lib/chat/types";
import type { W3PreflightResult } from "@/lib/sheetAutomation/write/w3Preflight";
import type { W4PreflightResult } from "@/lib/sheetAutomation/w3ToW4/w4Preflight";
import type { TemplateCompatibilityInfo } from "@/lib/sheetAutomation/templateSchema";

/** "Template V1 / COMPATIBLE" 처럼 Preflight 카드 상단에 항상 붙는 한 줄 표시. */
function TemplateCheckLine({ templateCheck }: { templateCheck: TemplateCompatibilityInfo }) {
  const ok = templateCheck.status === "COMPATIBLE";
  return (
    <p className={`text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>
      Template {templateCheck.version} / {templateCheck.status}
    </p>
  );
}

/** Template 구조 불일치로 Write가 차단된 상태 — 실행 버튼 자체가 없다. */
function TemplateChangedCard({ templateCheck }: { templateCheck: TemplateCompatibilityInfo }) {
  return (
    <div className="max-w-[520px] space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">TEMPLATE_CHANGED — 자동화를 실행할 수 없습니다.</p>
      <p className="text-xs text-red-700">Template {templateCheck.version}</p>
      <ul className="mt-1 space-y-0.5">
        {templateCheck.issues.map((issue, i) => (
          <li key={i}>- {issue}</li>
        ))}
      </ul>
    </div>
  );
}

interface UserMessage {
  id: string;
  role: "USER";
  text: string;
}

interface AssistantMessage {
  id: string;
  role: "ASSISTANT";
  result: ChatCommandResult;
}

type ChatMessage = UserMessage | AssistantMessage;

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `m${messageIdCounter}`;
}

function PreflightCard({
  preflight,
  onExecuted,
}: {
  preflight: W3PreflightResult;
  onExecuted: (result: ChatCommandResult) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);

  if (preflight.status === "ERROR") {
    return (
      <div className="max-w-[520px] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {preflight.message}
      </div>
    );
  }
  if (preflight.status === "TEMPLATE_CHANGED") {
    return <TemplateChangedCard templateCheck={preflight.templateCheck} />;
  }

  const { summary, spreadsheetUrl, templateCheck } = preflight;
  const totalNewRows = summary.approvalStatus.rowsToInsert + summary.detailStructure.reduce((sum: number, s) => sum + s.blocksToInsert * 3, 0);

  async function handleExecute() {
    setConfirming(false);
    setExecuting(true);
    const res = await executeW3AutomationAction({ spreadsheetUrl });
    const result: ChatCommandResult = res.result
      ? { kind: "W3_EXECUTION", execution: res.result }
      : { kind: "TEXT", message: res.error ?? "실행하지 못했습니다." };
    onExecuted(result);
    setExecuting(false);
  }

  return (
    <div className="max-w-[520px] space-y-3 rounded-xl border border-navy-100 bg-white p-4 text-sm shadow-sm">
      <div>
        <p className="font-semibold text-navy-950">
          {preflight.status === "READY"
            ? "W3 자동화 실행 준비가 완료되었습니다."
            : "확인이 필요한 항목이 있어 아직 실행 준비가 완료되지 않았습니다."}
        </p>
        <p className="mt-0.5 break-all text-xs text-navy-950/50">{summary.spreadsheetTitle}</p>
        <TemplateCheckLine templateCheck={templateCheck} />
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">PW2 검사 항목</p>
        <p className="text-navy-950">{summary.totalW2Items}건</p>
      </div>

      {summary.testTypeCounts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">시험 종류별 분류</p>
          <ul className="mt-1 space-y-0.5 text-navy-950/80">
            {summary.testTypeCounts.map((t) => (
              <li key={t.testType}>
                - {t.testType}: {t.count}건
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-navy-950/50">품질 승인 현황</p>
        <ul className="mt-1 space-y-0.5 text-navy-950/80">
          <li>- 입력 예정: {summary.approvalStatus.rowsPlanned}건</li>
          <li>- 추가 행: {summary.approvalStatus.rowsToInsert}개</li>
        </ul>
      </div>

      {summary.detailStructure.length > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">상세 검사영역 추가 구조</p>
          <ul className="mt-1 space-y-0.5 text-navy-950/80">
            {summary.detailStructure.map((s) => (
              <li key={s.sectionName}>
                - {s.sectionName}: Header {s.blocksToInsert} / Data {s.blocksToInsert} / Blank {s.blocksToInsert}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-navy-950/50">기존 값 보호</p>
        <p className="text-navy-950">{summary.valuesProtected}건</p>
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">확인 필요</p>
        {preflight.status === "READY" ? (
          <p className="text-emerald-700">0건</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-amber-700">
            {preflight.issues.map((issue, i) => (
              <li key={i}>- {issue}</li>
            ))}
          </ul>
        )}
      </div>

      {preflight.status === "READY" &&
        (confirming ? (
          <div className="space-y-2 border-t border-navy-100 pt-3">
            <p className="text-xs text-navy-950/70">
              W3 자동화를 실행합니다.
              <br />- 품질 승인 현황 {summary.approvalStatus.rowsPlanned}건
              <br />- 신규 행 {totalNewRows}개
              <br />
              담당자가 작성한 기존 결과값은 덮어쓰지 않습니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExecute}
                disabled={executing}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {executing ? "실행 중..." : "실행"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={executing}
                className="rounded-md border border-navy-100 px-3 py-1.5 text-xs text-navy-950/70"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-navy-100 pt-3">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white"
            >
              W3 자동화 실행
            </button>
          </div>
        ))}
    </div>
  );
}

function ExecutionCard({ execution }: { execution: W3ExecutionOutcome }) {
  if (execution.outcome === "STALE") {
    return (
      <div className="max-w-[520px] rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        {execution.message}
      </div>
    );
  }
  if (execution.outcome === "ERROR") {
    return (
      <div className="max-w-[520px] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {execution.message}
      </div>
    );
  }

  const { result, validation, planSnapshot } = execution;
  const totalRowsAdded = result.approvalRowsInserted + result.detailBlocksInserted * 3;
  const needsReviewCount = validation && !validation.ok ? validation.issues.length : 0;

  return (
    <div className="max-w-[520px] space-y-3 rounded-xl border border-navy-100 bg-white p-4 text-sm shadow-sm">
      <div>
        <p className="font-semibold text-navy-950">W3 자동화 완료</p>
        <p className={`mt-0.5 text-xs ${needsReviewCount === 0 ? "text-emerald-700" : "text-amber-700"}`}>
          실행 결과: {needsReviewCount === 0 ? "성공" : "확인 필요"}
        </p>
      </div>

      {planSnapshot && (
        <>
          <div>
            <p className="text-xs font-medium text-navy-950/50">품질 승인 현황</p>
            <p className="text-navy-950">{planSnapshot.totalW2Items}건</p>
          </div>
          <div>
            <p className="text-xs font-medium text-navy-950/50">상세 검사</p>
            <ul className="mt-1 space-y-0.5 text-navy-950/80">
              {planSnapshot.detailSections.map((s) => (
                <li key={s.sectionName}>
                  - {s.sectionName}: {s.requiredSlotCount}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div>
        <p className="text-xs font-medium text-navy-950/50">추가한 행</p>
        <p className="text-navy-950">{totalRowsAdded}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-navy-950/50">보호한 기존 결과값</p>
        <p className="text-navy-950">{result.valuesProtected}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-navy-950/50">확인 필요</p>
        {needsReviewCount === 0 ? (
          <p className="text-emerald-700">0</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-amber-700">
            {validation?.issues.map((issue, i) => <li key={i}>- {issue}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

function W4PreflightCard({
  preflight,
  onExecuted,
}: {
  preflight: W4PreflightResult;
  onExecuted: (result: ChatCommandResult) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);

  if (preflight.status === "ERROR") {
    return (
      <div className="max-w-[520px] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {preflight.message}
      </div>
    );
  }
  if (preflight.status === "TEMPLATE_CHANGED") {
    return <TemplateChangedCard templateCheck={preflight.templateCheck} />;
  }

  const { summary, spreadsheetUrl, templateCheck } = preflight;

  async function handleExecute() {
    setConfirming(false);
    setExecuting(true);
    const res = await executeW4AutomationAction({ spreadsheetUrl });
    const result: ChatCommandResult = res.result
      ? { kind: "W4_EXECUTION", execution: res.result }
      : { kind: "TEXT", message: res.error ?? "실행하지 못했습니다." };
    onExecuted(result);
    setExecuting(false);
  }

  return (
    <div className="max-w-[520px] space-y-3 rounded-xl border border-navy-100 bg-white p-4 text-sm shadow-sm">
      <div>
        <p className="font-semibold text-navy-950">
          {preflight.status === "READY"
            ? summary.alreadyUpToDate
              ? "이미 최신 상태입니다 — 실행할 변경이 없습니다."
              : "W4 자동화 실행 준비가 완료되었습니다."
            : "확인이 필요한 항목이 있어 아직 실행 준비가 완료되지 않았습니다."}
        </p>
        <p className="mt-0.5 break-all text-xs text-navy-950/50">{summary.spreadsheetTitle}</p>
        <TemplateCheckLine templateCheck={templateCheck} />
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">개선진행 대상</p>
        <p className="text-navy-950">{summary.totalImprovementItems}건</p>
      </div>

      {summary.targets.length > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">대상 목록</p>
          <ul className="mt-1 space-y-0.5 text-navy-950/80">
            {summary.targets.map((t) => (
              <li key={t.inspectionOrder}>
                - 순 {t.inspectionOrder} / {t.testType} / {t.item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-navy-950/50">이관 예정</p>
        <ul className="mt-1 space-y-0.5 text-navy-950/80">
          <li>- 품질 승인 현황: {summary.approvalTransferCount}건</li>
          <li>- 상세 검사 Block: {summary.detailBlocksToInsert}건</li>
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">기존 W4 반영 상태</p>
        <ul className="mt-1 space-y-0.5 text-navy-950/80">
          <li>- 승인 현황 반영됨: {summary.alreadyTransferredApprovalCount}건</li>
          <li>- 상세 Block 반영됨: {summary.alreadyTransferredDetailCount}건</li>
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">확인 필요</p>
        {preflight.status === "READY" ? (
          <p className="text-emerald-700">0건</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-amber-700">
            {preflight.issues.map((issue, i) => (
              <li key={i}>- {issue}</li>
            ))}
          </ul>
        )}
      </div>

      {preflight.status === "READY" &&
        !summary.alreadyUpToDate &&
        (confirming ? (
          <div className="space-y-2 border-t border-navy-100 pt-3">
            <p className="text-xs text-navy-950/70">
              W4 자동화를 실행합니다.
              <br />- 품질 승인 현황 {summary.approvalTransferCount}건
              <br />- 상세 검사 Block {summary.detailBlocksToInsert}건
              <br />
              &quot;■ 개선 변경점&quot; 영역과 기존 W4 수기 데이터는 변경하지 않습니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExecute}
                disabled={executing}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {executing ? "실행 중..." : "실행"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={executing}
                className="rounded-md border border-navy-100 px-3 py-1.5 text-xs text-navy-950/70"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-navy-100 pt-3">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white"
            >
              W4 자동화 실행
            </button>
          </div>
        ))}
    </div>
  );
}

function W4ExecutionCard({ execution }: { execution: W4ExecutionOutcome }) {
  if (execution.outcome === "STALE") {
    return (
      <div className="max-w-[520px] rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        {execution.message}
      </div>
    );
  }
  if (execution.outcome === "ERROR") {
    return (
      <div className="max-w-[520px] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {execution.message}
      </div>
    );
  }

  const { result, validation } = execution;
  const totalRowsAdded = result.approvalRowsInserted + result.detailBlocksInserted;
  const needsReviewCount = validation && !validation.ok ? validation.items.filter((i) => i.status !== "COMPLETE").length : 0;

  return (
    <div className="max-w-[520px] space-y-3 rounded-xl border border-navy-100 bg-white p-4 text-sm shadow-sm">
      <div>
        <p className="font-semibold text-navy-950">W4 자동화 완료</p>
        <p className={`mt-0.5 text-xs ${needsReviewCount === 0 ? "text-emerald-700" : "text-amber-700"}`}>
          실행 결과: {needsReviewCount === 0 ? "성공" : "확인 필요"}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">이관된 건수</p>
        <ul className="mt-1 space-y-0.5 text-navy-950/80">
          <li>- 품질 승인 현황 신규 행: {result.approvalRowsInserted}</li>
          <li>- 상세 검사 Block: {result.detailBlocksInserted}</li>
          <li>- 복제한 총 행 수: {result.totalRowsCopied}</li>
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">Validation</p>
        {!validation ? (
          <p className="text-navy-950/50">검증 결과를 확인하지 못했습니다.</p>
        ) : needsReviewCount === 0 ? (
          <p className="text-emerald-700">모든 대상 항목 COMPLETE</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-amber-700">
            {validation.items
              .filter((i) => i.status !== "COMPLETE")
              .map((i) => (
                <li key={i.inspectionOrder}>
                  - 순 {i.inspectionOrder} [{i.status}]{i.detail ? `: ${i.detail}` : ""}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  function appendAssistantMessage(result: ChatCommandResult) {
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "ASSISTANT", result }]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    setMessages((prev) => [...prev, { id: nextMessageId(), role: "USER", text }]);
    setInput("");
    setIsSending(true);

    const res = await runChatCommandAction({ message: text });
    const result: ChatCommandResult = res.result ?? {
      kind: "TEXT",
      message: res.error ?? "요청을 처리하지 못했습니다.",
    };
    appendAssistantMessage(result);
    setIsSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex min-h-screen flex-col p-8">
      <div>
        <h1 className="text-lg font-semibold text-navy-950">Chat</h1>
        <p className="mt-1 max-w-[640px] text-sm text-navy-950/60">
          개발품질 업무 요청과 자동화를 실행하는 통합 작업 공간입니다.
        </p>
      </div>

      <div className="flex-1 space-y-4 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[300px] items-center justify-center">
            <p className="text-sm text-navy-950/40">무엇을 도와드릴까요?</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "USER" ? "justify-end" : "justify-start"}`}>
              {m.role === "USER" ? (
                <p className="max-w-[520px] whitespace-pre-wrap break-all rounded-xl bg-navy-900 px-3 py-2 text-sm text-white">
                  {m.text}
                </p>
              ) : m.result.kind === "TEXT" ? (
                <p className="max-w-[520px] whitespace-pre-wrap rounded-xl border border-navy-100 bg-navy-50 px-3 py-2 text-sm text-navy-950/80">
                  {m.result.message}
                </p>
              ) : m.result.kind === "W3_PREFLIGHT" ? (
                <PreflightCard preflight={m.result.preflight} onExecuted={appendAssistantMessage} />
              ) : m.result.kind === "W3_EXECUTION" ? (
                <ExecutionCard execution={m.result.execution} />
              ) : m.result.kind === "W4_PREFLIGHT" ? (
                <W4PreflightCard preflight={m.result.preflight} onExecuted={appendAssistantMessage} />
              ) : (
                <W4ExecutionCard execution={m.result.execution} />
              )}
            </div>
          ))
        )}
        {isSending && (
          <div className="flex justify-start">
            <p className="max-w-[520px] rounded-xl border border-navy-100 bg-navy-50 px-3 py-2 text-sm text-navy-950/50">
              분석 중...
            </p>
          </div>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-[720px] items-end gap-2 rounded-xl border border-navy-100 p-3 shadow-sm">
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="업무 요청을 입력하세요"
          className="flex-1 resize-none rounded-lg px-2 py-1.5 text-sm text-navy-950 placeholder:text-navy-950/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isSending}
          className="shrink-0 rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
