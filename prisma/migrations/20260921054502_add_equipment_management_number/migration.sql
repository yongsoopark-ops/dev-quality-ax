-- AlterTable
-- 안전한 3단계로 나눈다: (1) nullable로 컬럼 추가 (2) 기존 28개 row는
-- managementNumber = id로 백필 (3) NOT NULL로 확정.
-- 이렇게 해야 기존 데이터가 있는 테이블에도 안전하게 적용된다 — 한 번에
-- NOT NULL로 추가하면(Prisma가 기본 생성한 형태) 기존 row에 채울 값이
-- 없어 실패한다.
ALTER TABLE "Equipment" ADD COLUMN "managementNumber" TEXT;

UPDATE "Equipment" SET "managementNumber" = "id" WHERE "managementNumber" IS NULL;

ALTER TABLE "Equipment" ALTER COLUMN "managementNumber" SET NOT NULL;
