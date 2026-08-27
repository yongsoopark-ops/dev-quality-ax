-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TaskProjectDetail" (
    "taskId" TEXT NOT NULL PRIMARY KEY,
    "projectName" TEXT NOT NULL,
    "pwStage" TEXT,
    "categoryId" TEXT,
    CONSTRAINT "TaskProjectDetail_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskProjectDetail_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProjectCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskProjectDetail" ("categoryId", "projectName", "pwStage", "taskId") SELECT "categoryId", "projectName", "pwStage", "taskId" FROM "TaskProjectDetail";
DROP TABLE "TaskProjectDetail";
ALTER TABLE "new_TaskProjectDetail" RENAME TO "TaskProjectDetail";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
