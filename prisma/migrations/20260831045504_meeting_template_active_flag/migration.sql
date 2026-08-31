-- AlterTable
ALTER TABLE "MeetingTemplate" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT false;

-- Step 5B-3 보완: 한 meetingType에 isActive=true인 Row가 최대 1개만 존재하도록
-- DB 레벨에서 강제한다(부분 유니크 인덱스 — isActive=false인 Row는 제약 대상이
-- 아니므로 같은 meetingType에 비활성 Template이 여러 개 있는 것은 계속 허용된다).
-- Prisma schema 문법으로는 부분 인덱스를 표현할 수 없어 이 migration.sql에
-- 직접 추가한다.
-- CreateIndex
CREATE UNIQUE INDEX "MeetingTemplate_meetingType_active_key" ON "MeetingTemplate"("meetingType") WHERE "isActive" = true;
