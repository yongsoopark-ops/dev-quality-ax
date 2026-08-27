"use server";

import { auth } from "@/auth";
import { routeChatCommand } from "@/lib/chat/commandRouter";
import { parseChatCommand } from "@/lib/chat/parseCommand";
import { executeW2ToW3WriteAction } from "@/lib/sheetAutomation/write/actions";
import { executeW3ToW4WriteAction } from "@/lib/sheetAutomation/w3ToW4/actions";
import type { ChatCommandResult, W3ExecutionOutcome, W4ExecutionOutcome } from "@/lib/chat/types";

/**
 * Chat Client는 Google Sheets API를 직접 호출하지 않는다 — 여기서만 로그인 확인 →
 * Command 인식 → (필요 시) W3 Preflight 조회까지 한 번에 처리한다. ADMIN으로
 * 제한하지 않고 기존 (shell) 로그인 정책만 따른다.
 */
export async function runChatCommandAction(input: {
  message: string;
}): Promise<{ result?: ChatCommandResult; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }
  if (!input.message.trim()) {
    return { error: "메시지를 입력해 주세요." };
  }

  const command = parseChatCommand(input.message);
  const result = await routeChatCommand(command);
  return { result };
}

/**
 * Preflight Card의 "[W3 자동화 실행]" 버튼 → Confirm 후 호출된다. 화면에 남아 있는
 * 예전 Preflight 결과를 신뢰하지 않고, executeW2ToW3WriteAction이 spreadsheetUrl로
 * 항상 새로 읽어 다시 계산한 뒤 READY일 때만 실행한다(요청사항 19/20).
 */
export async function executeW3AutomationAction(input: {
  spreadsheetUrl: string;
}): Promise<{ result?: W3ExecutionOutcome; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }

  const res = await executeW2ToW3WriteAction(input.spreadsheetUrl);

  if (res.stale) {
    return { result: { outcome: "STALE", message: res.error ?? "Sheet 내용이 변경되어 자동화 계획을 다시 확인해야 합니다." } };
  }
  if (res.error && !res.result) {
    return { result: { outcome: "ERROR", message: res.error } };
  }
  if (!res.result) {
    return { result: { outcome: "ERROR", message: "실행 결과를 확인하지 못했습니다." } };
  }
  if (res.result.error) {
    return { result: { outcome: "ERROR", message: res.result.error } };
  }

  return {
    result: {
      outcome: "SUCCESS",
      result: res.result,
      validation: res.validation,
      planSnapshot: res.planSnapshot,
    },
  };
}

/**
 * Preflight Card의 "[W4 자동화 실행]" 버튼 → Confirm 후 호출된다. Client는 spreadsheetUrl만
 * 넘기고 Plan을 넘기지 않는다 — executeW3ToW4WriteAction이 URL로 항상 새로 읽어
 * 최신 상태를 다시 계산한 뒤 READY일 때만 실행한다(요청사항: 실행 안전장치).
 */
export async function executeW4AutomationAction(input: {
  spreadsheetUrl: string;
}): Promise<{ result?: W4ExecutionOutcome; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "로그인이 필요합니다." };
  }

  const res = await executeW3ToW4WriteAction(input.spreadsheetUrl);

  if (res.stale) {
    return { result: { outcome: "STALE", message: res.error ?? "Sheet 내용이 변경되어 이관 계획을 다시 확인해야 합니다." } };
  }
  if (res.error && !res.result) {
    return { result: { outcome: "ERROR", message: res.error } };
  }
  if (!res.result) {
    return { result: { outcome: "ERROR", message: "실행 결과를 확인하지 못했습니다." } };
  }
  if (res.result.error) {
    return { result: { outcome: "ERROR", message: res.result.error } };
  }

  return {
    result: {
      outcome: "SUCCESS",
      result: res.result,
      validation: res.validation,
    },
  };
}
