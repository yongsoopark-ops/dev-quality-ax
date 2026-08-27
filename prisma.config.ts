import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

// Prisma CLI(migrate/introspect/studio)는 이 datasource.url 하나만 본다 —
// PgBouncer를 거치지 않는 DIRECT_URL을 준다(스키마 변경/마이그레이션은 Pooler를
// 우회해야 안전하다). 런타임 App 쿼리는 이 파일과 무관하게 lib/prisma.ts가
// DATABASE_URL(Pooled)을 @prisma/adapter-pg에 직접 넘겨 별도로 연결한다.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});
