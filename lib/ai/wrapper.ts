import { auth } from "@/auth";
import { calculateAiCost } from "@/lib/ai/pricing";
import { recordAiUsage } from "@/lib/ai/usageLogger";
import type { AiProvider, AiTaskType, NormalizedAiUsage } from "@/lib/ai/types";

const ZERO_USAGE: NormalizedAiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface AiCallContext {
  taskType: AiTaskType;
  /** 호출 전에 이미 정해져 있는 값 — 실패 시에도 어떤 Provider/Model을 시도했는지 기록하기 위함. */
  provider: AiProvider;
  model: string;
  projectId?: string | null;
}

export interface AiExecutionResult<T> {
  data: T;
  usage: NormalizedAiUsage;
}

function extractErrorCode(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return "UNKNOWN_ERROR";
}

/**
 * 향후 모든 AI Provider 호출은 이 Wrapper를 거치도록 한다 (Client Component에서
 * Provider API를 직접 호출하지 않는다). 이번 단계에서는 실제 Provider 연동을 구현하지
 * 않고, 아래 골격만 제공한다.
 *
 * 흐름:
 *   로그인 확인 → execute() 실행(실제 Provider 호출은 호출부 책임)
 *   → Usage 정규화(execute가 반환) → 비용 계산 → AIUsage 기록 → 결과 반환
 *
 * 실패 시: 알 수 있는 범위(provider/model/taskType)만 기록하고 Token은 임의로
 * 채우지 않은 채(0) FAILED로 남긴 뒤, 원래 에러를 다시 throw한다.
 *
 * 사용 예 (향후 실제 Provider 연동 시):
 *   const text = await callAi(
 *     { taskType: "AI_CHAT", provider: "ANTHROPIC", model: "claude-..." },
 *     async () => {
 *       const response = await anthropicClient.messages.create(...);
 *       return {
 *         data: response.content,
 *         usage: {
 *           inputTokens: response.usage.input_tokens,
 *           outputTokens: response.usage.output_tokens,
 *           cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
 *           cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
 *         },
 *       };
 *     },
 *   );
 */
export async function callAi<T>(
  context: AiCallContext,
  execute: () => Promise<AiExecutionResult<T>>,
): Promise<T> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("로그인이 필요합니다.");
  }

  try {
    const { data, usage } = await execute();

    await recordAiUsage({
      userId: session.user.id,
      projectId: context.projectId ?? null,
      taskType: context.taskType,
      provider: context.provider,
      model: context.model,
      usage,
      calculatedCostUsd: calculateAiCost(context.provider, context.model, usage),
      status: "SUCCESS",
    });

    return data;
  } catch (err) {
    await recordAiUsage({
      userId: session.user.id,
      projectId: context.projectId ?? null,
      taskType: context.taskType,
      provider: context.provider,
      model: context.model,
      usage: ZERO_USAGE,
      calculatedCostUsd: calculateAiCost(context.provider, context.model, ZERO_USAGE),
      status: "FAILED",
      errorCode: extractErrorCode(err),
    }).catch(() => {});

    throw err;
  }
}
