-- AlterTable
ALTER TABLE "MeetingMinutesDraft" ADD COLUMN     "sourceTemplateId" TEXT,
ADD COLUMN     "sourceTemplateUpdatedAt" TIMESTAMP(3);
