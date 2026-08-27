-- CreateTable
CREATE TABLE "GoogleSheetSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "headers" TEXT NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "lastModifiedAt" DATETIME,
    "syncStatus" TEXT NOT NULL DEFAULT 'SYNCING',
    "syncError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleSheetSource_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleSheetSourceRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleSheetSourceRow_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GoogleSheetSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleSheetSourceRow_sourceId_rowIndex_key" ON "GoogleSheetSourceRow"("sourceId", "rowIndex");
