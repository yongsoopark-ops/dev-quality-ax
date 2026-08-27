/**
 * 향후 Google AI / OpenAI / Anthropic 등 모든 AI Provider 호출이 공통으로 쓰는 타입.
 * 이번 단계에서는 실제 Provider 연동을 구현하지 않고, 이 타입들을 기준으로 한
 * Usage 기록 기반만 만든다.
 */

export type AiProvider = "GOOGLE" | "OPENAI" | "ANTHROPIC" | "OTHER";

export type AiUsageStatus = "SUCCESS" | "FAILED";

/**
 * 업무 유형은 자유 문자열이 아니라 이 중앙 목록으로 관리한다.
 * 향후 항목을 추가할 때도 이 위치 한 곳만 수정하면 된다.
 */
export type AiTaskType =
  | "VOC_ANALYSIS"
  | "DOCUMENT_ANALYSIS"
  | "AI_CHAT"
  | "SHEET_AI_INPUT"
  | "DRIVE_AI"
  | "OTHER";

/**
 * Provider마다 응답 Usage 구조가 다르므로, 내부적으로는 이 정규화된 형태만 다룬다.
 * Provider가 값을 제공하지 않으면 0으로 정규화하되, 실제로 제공되지 않은 값을
 * 임의로 추정해서 채우지는 않는다 (0은 "미제공"을 뜻하는 값으로만 쓴다).
 */
export interface NormalizedAiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
