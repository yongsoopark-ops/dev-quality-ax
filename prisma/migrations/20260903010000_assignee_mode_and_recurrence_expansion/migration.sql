-- Step(일정관리 담당자 UX + 반복 일정 UX 개선)
-- 전부 additive(값 추가/nullable 또는 기본값 있는 컬럼 추가)라 기존 Row는
-- 전혀 영향받지 않는다. DROP/DELETE/TRUNCATE 등 destructive 문 없음.

-- AlterEnum: RecurrenceType에 DAILY/YEARLY 추가(기존 NONE/WEEKLY/MONTHLY 값과
-- 그 값을 쓰는 기존 Row에는 영향 없음).
ALTER TYPE "RecurrenceType" ADD VALUE IF NOT EXISTS 'DAILY';
ALTER TYPE "RecurrenceType" ADD VALUE IF NOT EXISTS 'YEARLY';

-- AlterTable: Task에 두 컬럼 추가.
-- recurrenceCount: "N회 반복" 종료 조건. 기존 Row는 전부 NULL(횟수 제한 없음 —
-- 기존 endDate/무기한 반복 동작 그대로 유지).
-- isCommonAssignee: "공통"과 "담당자 미지정"을 구분하는 최소 semantic 필드.
-- 기존 Row는 전부 기본값 false로 채워져, 지금까지의 "담당자 없음 → 미배정
-- 취급" 동작을 그대로 유지한다.
ALTER TABLE "Task" ADD COLUMN     "recurrenceCount" INTEGER;
ALTER TABLE "Task" ADD COLUMN     "isCommonAssignee" BOOLEAN NOT NULL DEFAULT false;
