-- CreateEnum
CREATE TYPE "MeetingTemplateType" AS ENUM ('PART_WEEKLY_MEETING', 'KICK_OFF', 'GATE_REVIEW', 'EXECUTIVE_WEEKLY_REPORT');

-- CreateTable
CREATE TABLE "MeetingTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meetingType" "MeetingTemplateType" NOT NULL,
    "templateSchema" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingTemplate_meetingType_idx" ON "MeetingTemplate"("meetingType");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingTemplate_meetingType_name_key" ON "MeetingTemplate"("meetingType", "name");

-- AddForeignKey
ALTER TABLE "MeetingTemplate" ADD CONSTRAINT "MeetingTemplate_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
