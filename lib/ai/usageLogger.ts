import { prisma } from "@/lib/prisma";
import type { AiProvider, AiTaskType, AiUsageStatus, NormalizedAiUsage } from "@/lib/ai/types";

export interface RecordAiUsageParams {
  userId: string;
  projectId?: string | null;
  taskType: AiTaskType;
  provider: AiProvider;
  model: string;
  usage: NormalizedAiUsage;
  /** 가격 정보가 없는 모델은 null을 그대로 전달한다 (0으로 대체하지 않는다). */
  calculatedCostUsd: number | null;
  status: AiUsageStatus;
  errorCode?: string | null;
}

/**
 * AI Provider 호출의 Usage 메타데이터만 DB에 기록한다.
 * 이 함수 자체는 Google API/AI API를 호출하지 않는다.
 * Prompt/Response 전문이나 Error Stack 전체는 받지 않고 저장하지 않는다.
 */
export async function recordAiUsage(params: RecordAiUsageParams) {
  return prisma.aIUsage.create({
    data: {
      userId: params.userId,
      projectId: params.projectId ?? null,
      taskType: params.taskType,
      provider: params.provider,
      model: params.model,
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      cacheReadTokens: params.usage.cacheReadTokens,
      cacheWriteTokens: params.usage.cacheWriteTokens,
      calculatedCostUsd: params.calculatedCostUsd,
      status: params.status,
      errorCode: params.errorCode ?? null,
    },
  });
}
