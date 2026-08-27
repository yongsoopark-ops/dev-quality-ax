-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "memo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "goalName" TEXT,
    "nextTaskName" TEXT,
    "nextTaskStartDate" DATETIME,
    "nextTaskDueDate" DATETIME,
    "halfDayPeriod" TEXT,
    "lastRevisionNo" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Task_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("category", "createdAt", "createdBy", "dueDate", "goalName", "halfDayPeriod", "id", "memo", "nextTaskDueDate", "nextTaskName", "nextTaskStartDate", "startDate", "status", "title", "updatedAt") SELECT "category", "createdAt", "createdBy", "dueDate", "goalName", "halfDayPeriod", "id", "memo", "nextTaskDueDate", "nextTaskName", "nextTaskStartDate", "startDate", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_startDate_idx" ON "Task"("startDate");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
CREATE INDEX "Task_category_idx" ON "Task"("category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
