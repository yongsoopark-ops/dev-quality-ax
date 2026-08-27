-- CreateTable
CREATE TABLE "KPIDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "filterConfig" TEXT NOT NULL DEFAULT '{"conditions":[]}',
    "denominatorFilterConfig" TEXT,
    "groupByHeader" TEXT,
    "sumHeader" TEXT,
    "chartType" TEXT NOT NULL DEFAULT 'NUMBER_CARD',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KPIDefinition_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GoogleSheetSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KPIDefinition_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KPIResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiId" TEXT NOT NULL,
    "value" REAL,
    "resultData" TEXT NOT NULL DEFAULT '[]',
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSyncedAt" DATETIME,
    CONSTRAINT "KPIResult_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KPIDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "KPIResult_kpiId_key" ON "KPIResult"("kpiId");
