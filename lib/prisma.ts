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
 */
function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
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
