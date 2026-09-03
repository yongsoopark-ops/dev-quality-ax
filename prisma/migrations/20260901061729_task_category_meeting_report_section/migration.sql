-- CreateEnum
CREATE TYPE "MeetingReportSection" AS ENUM ('REGULAR_PROJECT', 'SUB_PROJECT', 'EXCEPTION', 'BUSINESS_TRIP', 'COMMON');

-- AlterTable
ALTER TABLE "TaskCategoryOption" ADD COLUMN     "meetingReportSection" "MeetingReportSection";

-- Backfill: 시스템 예약 4종은 id 자체가 label과 무관한 안정 키이므로 그대로
-- 대응시킨다. "출장 업무"는 사용자가 만든 CUSTOM(cuid id) 업무구분이라 id로
-- 매칭할 수 없어, 이 마이그레이션 작성 시점에 실제 존재를 확인한 그 특정 id로
-- 딱 1회만 지정한다(향후 label이 "해외 출장" 등으로 바뀌어도 이 값은 그대로
-- 유지되어 회의록 자동입력이 계속 정상 동작한다). 다른 환경에 이 id가 없으면
-- 이 UPDATE는 그냥 0행에 적용되고 조용히 넘어간다(에러 아님).
UPDATE "TaskCategoryOption" SET "meetingReportSection" = 'REGULAR_PROJECT' WHERE "id" = 'PROJECT';
UPDATE "TaskCategoryOption" SET "meetingReportSection" = 'SUB_PROJECT' WHERE "id" = 'PERSONAL_GOAL';
UPDATE "TaskCategoryOption" SET "meetingReportSection" = 'EXCEPTION' WHERE "id" = 'EXCEPTION';
UPDATE "TaskCategoryOption" SET "meetingReportSection" = 'COMMON' WHERE "id" = 'COMMON';
UPDATE "TaskCategoryOption" SET "meetingReportSection" = 'BUSINESS_TRIP' WHERE "id" = 'cmti8mkzl000078oc5qjx3laf';
