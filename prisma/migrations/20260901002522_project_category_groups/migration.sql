-- Step 5B-5(프로젝트 카테고리 2단계 계층화) — 손으로 순서를 맞춘 migration이다
-- (요청사항: 기존 카테고리 데이터 보호, 임의로 Task의 참조를 바꾸지 않음).
-- Prisma가 자동 생성한 diff는 ProjectCategory.groupId를 곧바로 NOT NULL로
-- 추가하려 해서(이 시점 기준 실제 Row 19개 존재) 그대로 실행하면 실패한다 —
-- 그래서 아래 순서를 반드시 지킨다:
--   1) ProjectCategoryGroup 테이블 생성
--   2) 안전한 기본 Group "미분류" 1개 seed(요청사항: "임시 미분류 group으로
--      안전하게 배치") — 실제로 어떤 대분류에 속해야 하는지는 이름만으로
--      단정할 수 없어 추측 배치하지 않는다. ADMIN이 설정 화면에서 나중에
--      "다른 대분류로 이동"으로 정리한다.
--   3) ProjectCategory에 groupId를 nullable로 추가
--   4) 기존 Row 전부를 "미분류" Group으로 backfill
--   5) 그 다음에야 NOT NULL로 강제
--   6) 인덱스/FK 추가

-- CreateTable
CREATE TABLE "ProjectCategoryGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCategoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCategoryGroup_name_key" ON "ProjectCategoryGroup"("name");

-- Seed: 안전한 기본 Group. id는 고정 문자열로 만들어 두지 않는다 — Group은
-- TaskCategoryOption/TaskStatusOption과 달리 어떤 코드도 특정 id를 의미로
-- 참조하지 않으므로(요청사항: Task는 최종 ProjectCategory id만 참조, Group은
-- 탐색용) 굳이 예약 key를 고정할 필요가 없다.
INSERT INTO "ProjectCategoryGroup" ("id", "name", "order", "active", "createdAt", "updatedAt")
VALUES ('cltmpprjcatgroupdefault0001', '미분류', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable: 일단 nullable로 추가
ALTER TABLE "ProjectCategory" ADD COLUMN "groupId" TEXT;

-- Backfill: 기존 Row 전부를 방금 만든 "미분류" Group으로 배치한다 — 실제
-- Task의 projectDetail.categoryId는 전혀 건드리지 않는다(그대로 유지).
UPDATE "ProjectCategory" SET "groupId" = 'cltmpprjcatgroupdefault0001';

-- 이제 NOT NULL로 강제(백필이 끝난 뒤에만 안전)
ALTER TABLE "ProjectCategory" ALTER COLUMN "groupId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ProjectCategory_groupId_idx" ON "ProjectCategory"("groupId");

-- AddForeignKey
ALTER TABLE "ProjectCategory" ADD CONSTRAINT "ProjectCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectCategoryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
