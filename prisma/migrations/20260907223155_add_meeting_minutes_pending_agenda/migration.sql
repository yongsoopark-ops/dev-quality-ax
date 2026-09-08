-- CreateTable
CREATE TABLE "MeetingMinutesPendingAgenda" (
    "id" TEXT NOT NULL,
    "meetingType" "MeetingTemplateType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingMinutesPendingAgenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingMinutesPendingAgenda_meetingType_consumedAt_idx" ON "MeetingMinutesPendingAgenda"("meetingType", "consumedAt");
