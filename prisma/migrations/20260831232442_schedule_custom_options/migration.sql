-- Step 5B-4(사용자 정의 상태/업무구분/프로젝트 카테고리) — 손으로 순서를
-- 맞춘 migration이다(요청사항: 기존 Task migration 안전). Prisma가 자동
-- 생성한 diff는 Task.categoryOptionId/statusOptionId를 곧바로 NOT NULL로
-- 추가하려 해서 기존 Row가 있으면 그대로 실패한다 — 그래서 아래 순서를
-- 반드시 지킨다:
--   1) 마스터 테이블(TaskCategoryOption/TaskStatusOption) 생성
--   2) 시스템 예약 7종/4종 seed(예약 id="PROJECT" 등 — label이 바뀌어도
--      이 id는 고정이라 lib/schedule/constants.ts의 TASK_CATEGORY_KEY/
--      TASK_STATUS_KEY가 계속 신뢰할 수 있다)
--   3) Task에 새 컬럼을 nullable로 추가
--   4) 기존 Row의 categoryOptionId/statusOptionId를 예전 enum 컬럼 값으로
--      backfill(문자열이 동일해 그대로 복사하면 된다)
--   5) 그 다음에야 NOT NULL로 강제
--   6) 예전 category/status enum 컬럼은 지우지 않고 nullable로만 완화
--      (레거시 데이터 보존, 새 코드는 더 이상 이 컬럼을 쓰지 않는다)

-- CreateTable
CREATE TABLE "TaskCategoryOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCategoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskStatusOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskStatusOption_pkey" PRIMARY KEY ("id")
);

-- Seed: 시스템 예약 업무 구분 7종 — id를 기존 TaskCategory enum 값과 똑같은
-- 문자열로 고정한다(색상은 lib/schedule/constants.ts의 옛 TASK_CATEGORY_TINTS
-- border 색을 그대로 이식).
INSERT INTO "TaskCategoryOption" ("id", "label", "color", "order", "active", "createdAt", "updatedAt") VALUES
    ('PROJECT', '프로젝트', '#5b8def', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('PERSONAL_GOAL', '개인 목표', '#5cb87a', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('EXCEPTION', '예외 업무', '#e0a458', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('MEETING', '미팅', '#9b87d9', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('COMMON', '공통 업무', '#94a3b8', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('VACATION', '휴가', '#5aa9b6', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('HALF_DAY', '반차', '#d1b354', 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Seed: 시스템 예약 상태 4종 — "DONE"은 isTaskOverdue(지연 여부 계산)가 계속
-- 신뢰하는 유일한 값이라 반드시 이 문자열로 고정돼야 한다.
INSERT INTO "TaskStatusOption" ("id", "label", "color", "order", "active", "createdAt", "updatedAt") VALUES
    ('TODO', '예정', '#a3b0c2', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('IN_PROGRESS', '진행중', '#93aed8', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('DONE', '완료', '#96c1a5', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ON_HOLD', '보류', '#c7ac8a', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable: ProjectCategory에 색상/순서 추가(기본값이 있어 기존 Row 안전)
ALTER TABLE "ProjectCategory" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#94a3b8',
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Task에 새 컬럼을 일단 nullable로 추가
ALTER TABLE "Task" ADD COLUMN     "categoryOptionId" TEXT,
ADD COLUMN     "statusOptionId" TEXT;

-- Backfill: 기존 Row는 enum 컬럼의 문자열 값이 새 마스터 테이블의 예약 id와
-- 정확히 같으므로 그대로 복사한다. status는 nullable이라 혹시 NULL인 과거
-- Row가 있으면 컬럼 기본값과 같은 'TODO'로 채운다.
UPDATE "Task" SET
    "categoryOptionId" = "category"::text,
    "statusOptionId" = COALESCE("status"::text, 'TODO');

-- 이제 NOT NULL로 강제(백필이 끝난 뒤에만 안전)
ALTER TABLE "Task" ALTER COLUMN "categoryOptionId" SET NOT NULL,
ALTER COLUMN "statusOptionId" SET NOT NULL;

-- 레거시 enum 컬럼은 지우지 않고 nullable로만 완화(새 코드는 더 이상 쓰지 않음)
ALTER TABLE "Task" ALTER COLUMN "category" DROP NOT NULL,
ALTER COLUMN "status" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Task_categoryOptionId_idx" ON "Task"("categoryOptionId");

-- CreateIndex
CREATE INDEX "Task_statusOptionId_idx" ON "Task"("statusOptionId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_categoryOptionId_fkey" FOREIGN KEY ("categoryOptionId") REFERENCES "TaskCategoryOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_statusOptionId_fkey" FOREIGN KEY ("statusOptionId") REFERENCES "TaskStatusOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
