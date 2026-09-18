-- 진행 현황(Progress Dashboard) — 순수 추가형 Migration. 기존 테이블/컬럼
-- 변경·삭제 없음(8개 CreateTable, 2개 CreateEnum, 인덱스, FK만 포함 —
-- git diff -b prisma/schema.prisma 로 재확인됨).
-- Seed 데이터 없음 — Equipment와 달리 고정 마스터 목록이 없어, 모든 Row는
-- 실제 사용자가 화면에서 등록한다.
-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'DONE');

-- CreateEnum
CREATE TYPE "ProgressItemStatus" AS ENUM ('WAITING', 'DONE');

-- CreateTable
CREATE TABLE "ProgressRegularProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "stageRunIndexes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "stageSkipIndexes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "kickoffDate" TIMESTAMP(3),
    "targetReleaseDate" TIMESTAMP(3),
    "actualReleaseDate" TIMESTAMP(3),
    "samplePw3Date" TIMESTAMP(3),
    "samplePw4Date" TIMESTAMP(3),
    "artifactUrl" TEXT,
    "improvementRounds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressRegularProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressUpdateLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressUpdateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressSubProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'PLANNED',
    "quarterStartYear" INTEGER NOT NULL,
    "quarterStartQ" INTEGER NOT NULL,
    "quarterEndYear" INTEGER NOT NULL,
    "quarterEndQ" INTEGER NOT NULL,
    "sheetUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressSubProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressSubProjectItem" (
    "id" TEXT NOT NULL,
    "subProjectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "quarterYear" INTEGER NOT NULL,
    "quarterNum" INTEGER NOT NULL,
    "status" "ProgressItemStatus" NOT NULL DEFAULT 'WAITING',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressSubProjectItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressCommonTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "repeat" BOOLEAN NOT NULL DEFAULT false,
    "repeatDay" TEXT,
    "monthStartYear" INTEGER NOT NULL,
    "monthStartNum" INTEGER NOT NULL,
    "monthEndYear" INTEGER NOT NULL,
    "monthEndNum" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressCommonTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressCommonTaskItem" (
    "id" TEXT NOT NULL,
    "commonTaskId" TEXT NOT NULL,
    "monthYear" INTEGER NOT NULL,
    "monthNum" INTEGER NOT NULL,
    "status" "ProgressItemStatus" NOT NULL DEFAULT 'WAITING',
    "carriedFromYear" INTEGER,
    "carriedFromMonth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressCommonTaskItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressRegularProject_ownerId_idx" ON "ProgressRegularProject"("ownerId");

-- CreateIndex
CREATE INDEX "ProgressRegularProject_status_idx" ON "ProgressRegularProject"("status");

-- CreateIndex
CREATE INDEX "ProgressUpdateLog_projectId_idx" ON "ProgressUpdateLog"("projectId");

-- CreateIndex
CREATE INDEX "ProgressSubProject_ownerId_idx" ON "ProgressSubProject"("ownerId");

-- CreateIndex
CREATE INDEX "ProgressSubProject_status_idx" ON "ProgressSubProject"("status");

-- CreateIndex
CREATE INDEX "ProgressSubProject_quarterStartYear_quarterStartQ_idx" ON "ProgressSubProject"("quarterStartYear", "quarterStartQ");

-- CreateIndex
CREATE INDEX "ProgressSubProjectItem_subProjectId_idx" ON "ProgressSubProjectItem"("subProjectId");

-- CreateIndex
CREATE INDEX "ProgressSubProjectItem_quarterYear_quarterNum_idx" ON "ProgressSubProjectItem"("quarterYear", "quarterNum");

-- CreateIndex
CREATE INDEX "ProgressCommonTask_ownerId_idx" ON "ProgressCommonTask"("ownerId");

-- CreateIndex
CREATE INDEX "ProgressCommonTaskItem_commonTaskId_monthYear_monthNum_idx" ON "ProgressCommonTaskItem"("commonTaskId", "monthYear", "monthNum");

-- CreateIndex
CREATE INDEX "ProgressCommonTaskItem_monthYear_monthNum_idx" ON "ProgressCommonTaskItem"("monthYear", "monthNum");

-- AddForeignKey
ALTER TABLE "ProgressRegularProject" ADD CONSTRAINT "ProgressRegularProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdateLog" ADD CONSTRAINT "ProgressUpdateLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProgressRegularProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdateLog" ADD CONSTRAINT "ProgressUpdateLog_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressSubProject" ADD CONSTRAINT "ProgressSubProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressSubProjectItem" ADD CONSTRAINT "ProgressSubProjectItem_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "ProgressSubProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressCommonTask" ADD CONSTRAINT "ProgressCommonTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressCommonTaskItem" ADD CONSTRAINT "ProgressCommonTaskItem_commonTaskId_fkey" FOREIGN KEY ("commonTaskId") REFERENCES "ProgressCommonTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

