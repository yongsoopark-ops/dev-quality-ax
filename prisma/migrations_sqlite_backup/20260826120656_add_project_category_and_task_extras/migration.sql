-- AlterTable
ALTER TABLE "Task" ADD COLUMN "goalName" TEXT;
ALTER TABLE "Task" ADD COLUMN "nextTaskDueDate" DATETIME;
ALTER TABLE "Task" ADD COLUMN "nextTaskName" TEXT;
ALTER TABLE "Task" ADD COLUMN "nextTaskStartDate" DATETIME;

-- CreateTable
CREATE TABLE "ProjectCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TaskProjectDetail" (
    "taskId" TEXT NOT NULL PRIMARY KEY,
    "projectName" TEXT NOT NULL,
    "pwStage" TEXT NOT NULL,
    "categoryId" TEXT,
    CONSTRAINT "TaskProjectDetail_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskProjectDetail_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProjectCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskProjectDetail" ("projectName", "pwStage", "taskId") SELECT "projectName", "pwStage", "taskId" FROM "TaskProjectDetail";
DROP TABLE "TaskProjectDetail";
ALTER TABLE "new_TaskProjectDetail" RENAME TO "TaskProjectDetail";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCategory_name_key" ON "ProjectCategory"("name");
