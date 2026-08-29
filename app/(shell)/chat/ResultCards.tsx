"use client";

import type { W3ExecutionOutcome, W4ExecutionOutcome } from "@/lib/chat/types";
import type { W3PreflightResult } from "@/lib/sheetAutomation/write/w3Preflight";
import type { W4PreflightResult } from "@/lib/sheetAutomation/w3ToW4/w4Preflight";
import type { TemplateCompatibilityInfo } from "@/lib/sheetAutomation/templateSchema";
import { ChatResultCard } from "./components/ChatResultCard";
import { ChatMessageBanner } from "./components/ChatMessageBanner";
import { MetricGrid, type MetricItem } from "./components/MetricGrid";

/**
 * 이 파일의 모든 컴포넌트는 W3/W4 Preflight·실행 결과의 "표현"만 담당한다 —
 * Preflight 계산/Template 판단 로직은 기존과 완전히 동일하다(한 줄도 바꾸지
 * 않았다). Chat UX 단순화 Step — READY 상태의 확인/실행 버튼은 제거했다.
 * 이제 ChatClient.tsx가 preflight READY를 받으면 카드로 보여주기 전에 바로
 * 실행 Action을 호출하므로(자동 실행), 이 카드가 READY 상태로 그려질 일은
 * 실제로는 없다 — 그래도 타입상 가능한 상태라 방어적으로 "버튼 없이 통과
 * 표시"만 남겨 둔다. NEEDS_REVIEW/TEMPLATE_CHANGED/ERROR 표시는 기존과 동일.
 */

/** "Template V1 / COMPATIBLE" 처럼 Preflight 카드 상단에 항상 붙는 한 줄 표시. */
function TemplateCheckLine({ templateCheck }: { templateCheck: TemplateCompatibilityInfo }) {
  const ok = templateCheck.status === "COMPATIBLE";
  return (
    <p className={`mt-0.5 text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>
      Template {templateCheck.version} / {templateCheck.status}
    </p>
  );
}

/** Template 구조 불일치로 Write가 차단된 상태 — 실행 버튼 자체가 없다. */
export function TemplateChangedCard({ templateCheck }: { templateCheck: TemplateCompatibilityInfo }) {
  return (
    <ChatResultCard
      title="자동화를 실행할 수 없습니다"
      status="ERROR"
      statusLabel="TEMPLATE_CHANGED"
      subtitle={<p className="mt-0.5 text-xs text-navy-950/50">Template {templateCheck.version}</p>}
    >
      <ul className="space-y-1 text-sm text-red-800">
        {templateCheck.issues.map((issue, i) => (
          <li key={i}>- {issue}</li>
        ))}
      </ul>
    </ChatResultCard>
  );
}

export function PreflightCard({ preflight }: { preflight: W3PreflightResult }) {
  if (preflight.status === "ERROR") {
    return <ChatMessageBanner tone="error" message={preflight.message} />;
  }
  if (preflight.status === "TEMPLATE_CHANGED") {
    return <TemplateChangedCard templateCheck={preflight.templateCheck} />;
  }

  const { summary, templateCheck } = preflight;

  const metrics: MetricItem[] = [
    { label: "PW2 검사 항목", value: `${summary.totalW2Items}건` },
    { label: "승인 현황 입력 예정", value: `${summary.approvalStatus.rowsPlanned}건` },
    { label: "승인 현황 추가 행", value: `${summary.approvalStatus.rowsToInsert}개` },
    { label: "기존 값 보호", value: `${summary.valuesProtected}건` },
  ];

  return (
    <ChatResultCard
      title={
        preflight.status === "READY"
          ? "W3 자동화 실행 준비가 완료되었습니다"
          : "확인이 필요한 항목이 있어 아직 실행 준비가 완료되지 않았습니다"
      }
      status={preflight.status === "READY" ? "SUCCESS" : "WARNING"}
      statusLabel={preflight.status === "READY" ? "READY" : "NEEDS_REVIEW"}
      subtitle={
        <>
          <p className="mt-0.5 break-words text-xs text-navy-950/50">{summary.spreadsheetTitle}</p>
          <TemplateCheckLine templateCheck={templateCheck} />
        </>
      }
    >
      <MetricGrid items={metrics} />

      {summary.testTypeCounts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">시험 종류별 분류</p>
          <ul className="mt-1 space-y-0.5 text-sm text-navy-950/80">
            {summary.testTypeCounts.map((t) => (
              <li key={t.testType}>
                - {t.testType}: {t.count}건
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.detailStructure.length > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">상세 검사영역 추가 구조</p>
          <ul className="mt-1 space-y-0.5 text-sm text-navy-950/80">
            {summary.detailStructure.map((s) => (
              <li key={s.sectionName}>
                - {s.sectionName}: Header {s.blocksToInsert} / Data {s.blocksToInsert} / Blank {s.blocksToInsert}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-navy-950/50">확인 필요</p>
        {preflight.status === "READY" ? (
          <p className="mt-0.5 text-sm text-emerald-700">0건</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm text-amber-700">
            {preflight.issues.map((issue, i) => (
              <li key={i}>- {issue}</li>
            ))}
          </ul>
        )}
      </div>
    </ChatResultCard>
  );
}

export function ExecutionCard({ execution }: { execution: W3ExecutionOutcome }) {
  if (execution.outcome === "STALE") {
    return <ChatMessageBanner tone="warning" message={execution.message} />;
  }
  if (execution.outcome === "ERROR") {
    return <ChatMessageBanner tone="error" message={execution.message} />;
  }

  const { result, validation, planSnapshot } = execution;
  const totalRowsAdded = result.approvalRowsInserted + result.detailBlocksInserted * 3;
  const needsReviewCount = validation && !validation.ok ? validation.issues.length : 0;

  const metrics: MetricItem[] = [
    ...(planSnapshot ? [{ label: "PW2 검사 항목", value: `${planSnapshot.totalW2Items}건` }] : []),
    { label: "추가한 행", value: totalRowsAdded },
    { label: "보호한 기존 결과값", value: result.valuesProtected },
    { label: "확인 필요", value: needsReviewCount, tone: needsReviewCount === 0 ? "positive" : "warning" },
  ];

  return (
    <ChatResultCard
      title="W3 자동화 완료"
      status={needsReviewCount === 0 ? "SUCCESS" : "WARNING"}
      statusLabel={needsReviewCount === 0 ? "성공" : "확인 필요"}
    >
      <MetricGrid items={metrics} />

      {planSnapshot && planSnapshot.detailSections.length > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">상세 검사</p>
          <ul className="mt-1 space-y-0.5 text-sm text-navy-950/80">
            {planSnapshot.detailSections.map((s) => (
              <li key={s.sectionName}>
                - {s.sectionName}: {s.requiredSlotCount}
              </li>
            ))}
          </ul>
        </div>
      )}

      {needsReviewCount > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">확인 필요 상세</p>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-700">
            {validation?.issues.map((issue, i) => <li key={i}>- {issue}</li>)}
          </ul>
        </div>
      )}
    </ChatResultCard>
  );
}

export function W4PreflightCard({ preflight }: { preflight: W4PreflightResult }) {
  if (preflight.status === "ERROR") {
    return <ChatMessageBanner tone="error" message={preflight.message} />;
  }
  if (preflight.status === "TEMPLATE_CHANGED") {
    return <TemplateChangedCard templateCheck={preflight.templateCheck} />;
  }

  const { summary, templateCheck } = preflight;

  const metrics: MetricItem[] = [
    { label: "개선진행 대상", value: `${summary.totalImprovementItems}건` },
    { label: "승인 현황 이관", value: `${summary.approvalTransferCount}건` },
    { label: "상세 검사 Block 이관", value: `${summary.detailBlocksToInsert}건` },
    { label: "승인 현황 반영됨", value: `${summary.alreadyTransferredApprovalCount}건` },
  ];

  return (
    <ChatResultCard
      title={
        preflight.status === "READY"
          ? summary.alreadyUpToDate
            ? "이미 최신 상태입니다 — 실행할 변경이 없습니다"
            : "W4 자동화 실행 준비가 완료되었습니다"
          : "확인이 필요한 항목이 있어 아직 실행 준비가 완료되지 않았습니다"
      }
      status={preflight.status === "READY" ? "SUCCESS" : "WARNING"}
      statusLabel={preflight.status === "READY" ? "READY" : "NEEDS_REVIEW"}
      subtitle={
        <>
          <p className="mt-0.5 break-words text-xs text-navy-950/50">{summary.spreadsheetTitle}</p>
          <TemplateCheckLine templateCheck={templateCheck} />
        </>
      }
    >
      <MetricGrid items={metrics} />

      {summary.targets.length > 0 && (
        <div>
          <p className="text-xs font-medium text-navy-950/50">대상 목록</p>
          <ul className="mt-1 space-y-0.5 text-sm text-navy-950/80">
            {summary.targets.map((t) => (
              <li key={t.inspectionOrder}>
                - 순 {t.inspectionOrder} / {t.testType} / {t.item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-navy-950/50">기존 W4 반영 상태</p>
        <ul className="mt-1 space-y-0.5 text-sm text-navy-950/80">
          <li>- 상세 Block 반영됨: {summary.alreadyTransferredDetailCount}건</li>
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium text-navy-950/50">확인 필요</p>
        {preflight.status === "READY" ? (
          <p className="mt-0.5 text-sm text-emerald-700">0건</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm text-amber-700">
            {preflight.issues.map((issue, i) => (
              <li key={i}>- {issue}</li>
            ))}
          </ul>
        )}
      </div>
    </ChatResultCard>
  );
}

export function W4ExecutionCard({ execution }: { execution: W4ExecutionOutcome }) {
  if (execution.outcome === "STALE") {
    return <ChatMessageBanner tone="warning" message={execution.message} />;
  }
  if (execution.outcome === "ERROR") {
    return <ChatMessageBanner tone="error" message={execution.message} />;
  }

  const { result, validation } = execution;
  const totalRowsAdded = result.approvalRowsInserted + result.detailBlocksInserted;
  const needsReviewCount = validation && !validation.ok ? validation.items.filter((i) => i.status !== "COMPLETE").length : 0;

  const metrics: MetricItem[] = [
    { label: "승인 현황 신규 행", value: result.approvalRowsInserted },
    { label: "상세 검사 Block", value: result.detailBlocksInserted },
    { label: "복제한 총 행 수", value: result.totalRowsCopied },
    {
      label: "확인 필요",
      value: validation ? needsReviewCount : "-",
      tone: !validation ? "default" : needsReviewCount === 0 ? "positive" : "warning",
    },
  ];

  return (
    <ChatResultCard
      title="W4 자동화 완료"
      status={needsReviewCount === 0 ? "SUCCESS" : "WARNING"}
      statusLabel={needsReviewCount === 0 ? "성공" : "확인 필요"}
    >
      <MetricGrid items={metrics} />

      {!validation ? (
        <p className="text-sm text-navy-950/50">검증 결과를 확인하지 못했습니다.</p>
      ) : needsReviewCount > 0 ? (
        <div>
          <p className="text-xs font-medium text-navy-950/50">확인 필요 상세</p>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-700">
            {validation.items
              .filter((i) => i.status !== "COMPLETE")
              .map((i) => (
                <li key={i.inspectionOrder}>
                  - 순 {i.inspectionOrder} [{i.status}]{i.detail ? `: ${i.detail}` : ""}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </ChatResultCard>
  );
}
