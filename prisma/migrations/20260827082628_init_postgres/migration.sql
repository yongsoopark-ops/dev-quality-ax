-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('CONNECTED', 'SYNCING', 'ERROR');

-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('COUNT', 'COUNT_ALL', 'RATIO', 'SUM');

-- CreateEnum
CREATE TYPE "ChartType" AS ENUM ('NUMBER_CARD', 'BAR', 'HORIZONTAL_BAR', 'LINE', 'AREA', 'DONUT', 'PIE', 'PROGRESS');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('GOOGLE', 'OPENAI', 'ANTHROPIC', 'OTHER');

-- CreateEnum
CREATE TYPE "AiTaskType" AS ENUM ('VOC_ANALYSIS', 'DOCUMENT_ANALYSIS', 'AI_CHAT', 'SHEET_AI_INPUT', 'DRIVE_AI', 'OTHER');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('PROJECT', 'PERSONAL_GOAL', 'EXCEPTION', 'MEETING', 'COMMON', 'VACATION', 'HALF_DAY');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MENTION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleSheetSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "headers" TEXT NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastModifiedAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCING',
    "syncError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleSheetSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleSheetSourceRow" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleSheetSourceRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KPIDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metricType" "MetricType" NOT NULL,
    "filterConfig" TEXT NOT NULL DEFAULT '{"conditions":[]}',
    "denominatorFilterConfig" TEXT,
    "groupByHeader" TEXT,
    "sumHeader" TEXT,
    "dateHeader" TEXT,
    "chartType" "ChartType" NOT NULL DEFAULT 'NUMBER_CARD',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KPIDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KPIResult" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "resultData" TEXT NOT NULL DEFAULT '[]',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSyncedAt" TIMESTAMP(3),

    CONSTRAINT "KPIResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskType" "AiTaskType" NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "calculatedCostUsd" DOUBLE PRECISION,
    "status" "AiUsageStatus" NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardLayout" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "layoutData" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SidebarLayout" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "layoutData" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SidebarLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "TaskCategory" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "memo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "goalName" TEXT,
    "nextTaskName" TEXT,
    "nextTaskStartDate" TIMESTAMP(3),
    "nextTaskDueDate" TIMESTAMP(3),
    "halfDayPeriod" TEXT,
    "lastRevisionNo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskProjectDetail" (
    "taskId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "pwStage" TEXT,
    "categoryId" TEXT,

    CONSTRAINT "TaskProjectDetail_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "ProjectCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskMeetingDetail" (
    "taskId" TEXT NOT NULL,
    "department" TEXT,
    "time" TIMESTAMP(3),
    "location" TEXT,

    CONSTRAINT "TaskMeetingDetail_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "TaskMeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingTaskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskMeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskScheduleRevision" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "reasonText" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskScheduleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "contentJson" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "taskId" TEXT,
    "commentId" TEXT,
    "actorId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleSheetSourceRow_sourceId_rowIndex_key" ON "GoogleSheetSourceRow"("sourceId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "KPIResult_kpiId_key" ON "KPIResult"("kpiId");

-- CreateIndex
CREATE INDEX "AIUsage_provider_idx" ON "AIUsage"("provider");

-- CreateIndex
CREATE INDEX "AIUsage_userId_idx" ON "AIUsage"("userId");

-- CreateIndex
CREATE INDEX "AIUsage_createdAt_idx" ON "AIUsage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardLayout_key_key" ON "DashboardLayout"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SidebarLayout_key_key" ON "SidebarLayout"("key");

-- CreateIndex
CREATE INDEX "Task_startDate_idx" ON "Task"("startDate");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_category_idx" ON "Task"("category");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCategory_name_key" ON "ProjectCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TaskMeetingAttendee_meetingTaskId_userId_key" ON "TaskMeetingAttendee"("meetingTaskId", "userId");

-- CreateIndex
CREATE INDEX "TaskScheduleRevision_taskId_idx" ON "TaskScheduleRevision"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskScheduleRevision_taskId_revisionNo_key" ON "TaskScheduleRevision"("taskId", "revisionNo");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

-- CreateIndex
CREATE INDEX "TaskComment_parentId_idx" ON "TaskComment"("parentId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_commentId_userId_type_key" ON "Notification"("commentId", "userId", "type");

-- AddForeignKey
ALTER TABLE "GoogleSheetSource" ADD CONSTRAINT "GoogleSheetSource_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleSheetSourceRow" ADD CONSTRAINT "GoogleSheetSourceRow_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GoogleSheetSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPIDefinition" ADD CONSTRAINT "KPIDefinition_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GoogleSheetSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPIDefinition" ADD CONSTRAINT "KPIDefinition_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPIResult" ADD CONSTRAINT "KPIResult_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KPIDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardLayout" ADD CONSTRAINT "DashboardLayout_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SidebarLayout" ADD CONSTRAINT "SidebarLayout_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskProjectDetail" ADD CONSTRAINT "TaskProjectDetail_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskProjectDetail" ADD CONSTRAINT "TaskProjectDetail_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProjectCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMeetingDetail" ADD CONSTRAINT "TaskMeetingDetail_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMeetingAttendee" ADD CONSTRAINT "TaskMeetingAttendee_meetingTaskId_fkey" FOREIGN KEY ("meetingTaskId") REFERENCES "TaskMeetingDetail"("taskId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMeetingAttendee" ADD CONSTRAINT "TaskMeetingAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskScheduleRevision" ADD CONSTRAINT "TaskScheduleRevision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskScheduleRevision" ADD CONSTRAINT "TaskScheduleRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
