import type { AiProvider, NormalizedAiUsage } from "@/lib/ai/types";

export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  /** Provider가 Cache 가격을 제공하지 않으면 생략한다 — 0으로 채우지 않는다. */
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
}

/**
 * 실제 사용할 모델이 아직 확정되지 않았으므로 프로덕션 가격표는 비워둔다.
 * 등록되지 않은 모델은 calculateAiCost()가 null을 반환하며, 이는 "가격 정보 없음"을
 * 뜻한다 — 절대 비용 0으로 취급하지 않는다.
 */
const PRODUCTION_MODEL_PRICING: Record<string, ModelPricing> = {};

/**
 * 비용 계산 로직 자체를 검증하기 위한 개발 전용 테스트 가격표.
 * 실제 모델 가격을 흉내내지 않도록 이름 자체를 TEST 전용으로 두며,
 * 프로덕션 환경에서는 절대 병합되지 않는다.
 */
const DEV_TEST_MODEL_PRICING: Record<string, ModelPricing> = {
  "OTHER:test-priced-model": {
    inputPricePerMillion: 1,
    outputPricePerMillion: 2,
    cacheReadPricePerMillion: 0.5,
    cacheWritePricePerMillion: 1.5,
  },
};

const MODEL_PRICING: Record<string, ModelPricing> =
  process.env.NODE_ENV === "production"
    ? PRODUCTION_MODEL_PRICING
    : { ...PRODUCTION_MODEL_PRICING, ...DEV_TEST_MODEL_PRICING };

function pricingKey(provider: AiProvider, model: string): string {
  return `${provider}:${model}`;
}

/** 등록되지 않은 Provider+Model 조합이면 null을 반환한다. */
export function getModelPricing(provider: AiProvider, model: string): ModelPricing | null {
  return MODEL_PRICING[pricingKey(provider, model)] ?? null;
}

const MILLION = 1_000_000;
/** USD 비용 계산 시 부동소수점 오차를 줄이기 위한 반올림 자리수. */
const COST_PRECISION = 1e8;

/**
 * Provider+Model의 가격 정보가 있으면 Usage를 기준으로 비용(USD)을 계산한다.
 * 가격 정보가 없으면 null을 반환한다 — 0으로 대체하지 않는다.
 * 환율 변환은 하지 않는다 (DB 기본 비용 단위는 USD).
 */
export function calculateAiCost(
  provider: AiProvider,
  model: string,
  usage: NormalizedAiUsage,
): number | null {
  const pricing = getModelPricing(provider, model);
  if (!pricing) return null;

  const inputCost = (usage.inputTokens / MILLION) * pricing.inputPricePerMillion;
  const outputCost = (usage.outputTokens / MILLION) * pricing.outputPricePerMillion;
  const cacheReadCost = pricing.cacheReadPricePerMillion
    ? (usage.cacheReadTokens / MILLION) * pricing.cacheReadPricePerMillion
    : 0;
  const cacheWriteCost = pricing.cacheWritePricePerMillion
    ? (usage.cacheWriteTokens / MILLION) * pricing.cacheWritePricePerMillion
    : 0;

  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return Math.round(total * COST_PRECISION) / COST_PRECISION;
}
