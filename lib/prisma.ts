import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

/**
 * Supabase PostgreSQL — DATABASE_URL은 PgBouncer를 경유하는 Pooled 연결
 * (Transaction mode, 포트 6543)이다. prisma.config.ts(CLI 전용)와 달리 여기는
 * Netlify Serverless 환경에서도 매 요청마다 새 Pool을 만들지 않도록 dev
 * 환경에서는 globalThis에 Pool 자체도 캐싱해 HMR로 모듈이 재평가돼도 재사용한다.
 *
 * max(성능 진단 Step 근거): Netlify Functions는 보통 컨테이너 1개가 한 번에
 * 요청 1건만 처리하므로, pg.Pool의 기본값(10)은 우리 코드가 실제로 쓰는
 * 동시성보다 훨씬 크다 — Supabase Pooler 슬롯을 컨테이너 수만큼 곱해서
 * 불필요하게 점유한다. 반대로 1로 강제하면 같은 요청 안의 Promise.all 병렬
 * 조회(/schedule 3개, /home 3개+2개)가 Pool 안에서 서로 순서를 기다리며
 * 직렬화돼 병렬화 효과가 사라진다. 지금 코드에서 한 요청이 동시에 필요로 하는
 * 최대 연결 수(3)에 여유를 조금 더한 5로 설정한다 — 병렬 조회는 그대로 보장하고,
 * 기본값(10) 대비 컨테이너당 최대 절반 이하로 Supabase Pooler 슬롯 사용을 줄인다.
 */
function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
}

function createPrismaClient() {
  const pool = globalForPrisma.pgPool ?? createPool();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pgPool = pool;
  }
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
