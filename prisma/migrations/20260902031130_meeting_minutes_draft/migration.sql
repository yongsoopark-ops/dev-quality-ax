-- CreateTable
CREATE TABLE "MeetingMinutesDraft" (
    "id" TEXT NOT NULL,
    "meetingType" "MeetingTemplateType" NOT NULL,
    "documentContent" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingMinutesDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingMinutesDraft_meetingType_key" ON "MeetingMinutesDraft"("meetingType");

-- AddForeignKey
ALTER TABLE "MeetingMinutesDraft" ADD CONSTRAINT "MeetingMinutesDraft_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
