import type { W3PreflightResult } from "@/lib/sheetAutomation/write/w3Preflight";
import type { WriteExecutionResult } from "@/lib/sheetAutomation/write/types";
import type { WriteResultPlanSnapshot } from "@/lib/sheetAutomation/write/actions";
import type { W4PreflightResult } from "@/lib/sheetAutomation/w3ToW4/w4Preflight";
import type { W3ToW4ExecutionResult, W3ToW4ValidationResult } from "@/lib/sheetAutomation/w3ToW4/types";

/**
 * Chat 메시지에서 뽑아낸 "무엇을 하려는 요청인지". AI가 추정하지 않고 Code Parser
 * (parseCommand.ts)가 문구/URL 패턴만으로 판단한다. 향후 DRIVE_SEARCH/KPI_QUERY 같은
 * 새 명령을 추가할 때도 이 union에 항목만 늘리면 된다.
 */
export type ChatCommand =
  | { type: "W3_AUTOMATION"; spreadsheetUrl: string }
  | { type: "W4_AUTOMATION"; spreadsheetUrl: string }
  | { type: "MISSING_URL" }
  | { type: "INVALID_URL" }
  | { type: "UNSUPPORTED" };

/** "W3 자동화 실행" 버튼 클릭 결과 — Chat 완료 Card 렌더링에 필요한 것만 담는다. */
export type W3ExecutionOutcome =
  | { outcome: "SUCCESS"; result: WriteExecutionResult; validation?: { ok: boolean; issues: string[] }; planSnapshot?: WriteResultPlanSnapshot }
  | { outcome: "STALE"; message: string }
  | { outcome: "ERROR"; message: string };

/** "W4 자동화 실행" 버튼 클릭 결과 — Chat 완료 Card 렌더링에 필요한 것만 담는다. */
export type W4ExecutionOutcome =
  | { outcome: "SUCCESS"; result: W3ToW4ExecutionResult; validation?: W3ToW4ValidationResult }
  | { outcome: "STALE"; message: string }
  | { outcome: "ERROR"; message: string };

/** Command Router가 계산한, Chat 화면에 그대로 그릴 수 있는 결과. */
export type ChatCommandResult =
  | { kind: "TEXT"; message: string }
  | { kind: "W3_PREFLIGHT"; preflight: W3PreflightResult }
  | { kind: "W3_EXECUTION"; execution: W3ExecutionOutcome }
  | { kind: "W4_PREFLIGHT"; preflight: W4PreflightResult }
  | { kind: "W4_EXECUTION"; execution: W4ExecutionOutcome };
