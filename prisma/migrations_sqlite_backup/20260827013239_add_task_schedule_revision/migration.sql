-- CreateTable
CREATE TABLE "TaskScheduleRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskScheduleRevision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskScheduleRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskScheduleRevision_taskId_idx" ON "TaskScheduleRevision"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskScheduleRevision_taskId_revisionNo_key" ON "TaskScheduleRevision"("taskId", "revisionNo");
