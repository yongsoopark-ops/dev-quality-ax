-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RecurrenceMonthlyRuleType" AS ENUM ('DAY_OF_MONTH', 'NTH_WEEKDAY');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "recurrenceEndDate" TIMESTAMP(3),
ADD COLUMN     "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "recurrenceMonthDay" INTEGER,
ADD COLUMN     "recurrenceMonthlyRuleType" "RecurrenceMonthlyRuleType",
ADD COLUMN     "recurrenceMonthlyWeekOrdinal" INTEGER,
ADD COLUMN     "recurrenceMonthlyWeekday" TEXT,
ADD COLUMN     "recurrenceType" "RecurrenceType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "recurrenceWeekdays" TEXT[] DEFAULT ARRAY[]::TEXT[];
