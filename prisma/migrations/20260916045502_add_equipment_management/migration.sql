-- CreateEnum
CREATE TYPE "EquipmentKind" AS ENUM ('GENERAL', 'REPEAT', 'ENVIRONMENT', 'GENERAL_REPEAT');

-- CreateEnum
CREATE TYPE "EquipmentLocation" AS ENUM ('NURIKKUM', 'HYANGDONG');

-- CreateEnum
CREATE TYPE "EquipmentGrade" AS ENUM ('HIGH', 'MID', 'LOW');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_USE', 'UNDER_REPAIR');

-- CreateEnum
CREATE TYPE "EquipmentTimeHalf" AS ENUM ('AM', 'PM');

-- CreateEnum
CREATE TYPE "EquipmentTeamLabel" AS ENUM ('TEAM_1', 'TEAM_2');

-- CreateEnum
CREATE TYPE "EquipmentUsagePurpose" AS ENUM ('ONE_OFF', 'CYCLE');

-- CreateEnum
CREATE TYPE "EquipmentMetricKind" AS ENUM ('COUNT', 'CYCLE', 'HOUR');

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "kind" "EquipmentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "location" "EquipmentLocation" NOT NULL,
    "grade" "EquipmentGrade" NOT NULL,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assignedUserId" TEXT,
    "assignedTeamLabel" "EquipmentTeamLabel",
    "currentStart" TIMESTAMP(3),
    "currentEnd" TIMESTAMP(3),
    "currentHalf" "EquipmentTimeHalf",
    "currentFaultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentReservation" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "assignedTeamLabel" "EquipmentTeamLabel",
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "half" "EquipmentTimeHalf" NOT NULL,
    "purpose" "EquipmentUsagePurpose",
    "cycles" INTEGER,
    "hours" INTEGER,
    "sampleCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentUsageLog" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "reservationId" TEXT,
    "metricKind" "EquipmentMetricKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Equipment_assignedUserId_idx" ON "Equipment"("assignedUserId");

-- CreateIndex
CREATE INDEX "Equipment_status_idx" ON "Equipment"("status");

-- CreateIndex
CREATE INDEX "EquipmentReservation_equipmentId_idx" ON "EquipmentReservation"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentReservation_startDate_idx" ON "EquipmentReservation"("startDate");

-- CreateIndex
CREATE INDEX "EquipmentReservation_endDate_idx" ON "EquipmentReservation"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentUsageLog_reservationId_key" ON "EquipmentUsageLog"("reservationId");

-- CreateIndex
CREATE INDEX "EquipmentUsageLog_equipmentId_idx" ON "EquipmentUsageLog"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentUsageLog_recordedAt_idx" ON "EquipmentUsageLog"("recordedAt");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentReservation" ADD CONSTRAINT "EquipmentReservation_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentReservation" ADD CONSTRAINT "EquipmentReservation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageLog" ADD CONSTRAINT "EquipmentUsageLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageLog" ADD CONSTRAINT "EquipmentUsageLog_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "EquipmentReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: 설비 마스터 28대(디자인 레퍼런스 README "설비 마스터 데이터" 표 그대로).
-- TaskCategoryOption/TaskStatusOption 관례와 같은 이유로 seed 데이터를 migration에
-- 직접 넣는다. status는 전부 AVAILABLE, assignedUserId/assignedTeamLabel은 전부
-- NULL로 시작한다 — 디자인 레퍼런스의 데모용 임의 배정(이미 예약됨/사용중/수리중 등)은
-- 실제 운영 데이터가 아니므로 이식하지 않는다. 실제 담당자 배정은 배포 후 화면에서
-- 직접 지정한다.
INSERT INTO "Equipment" ("id", "kind", "name", "location", "grade", "status", "updatedAt") VALUES
    ('QA-TEQ-001', 'GENERAL',        '연필경도 시험기',            'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-002', 'REPEAT',         '러빙 시험기',                'NURIKKUM', 'HIGH', 'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-003', 'REPEAT',         '러빙 시험기',                'NURIKKUM', 'HIGH', 'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-004', 'GENERAL_REPEAT', '전동 스탠드',                'NURIKKUM', 'MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-005', 'GENERAL_REPEAT', '전동 스탠드',                'NURIKKUM', 'MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-006', 'GENERAL_REPEAT', '전동 스탠드',                'NURIKKUM', 'MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-007', 'GENERAL',        '수동 스탠드',                'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-008', 'GENERAL',        '낙구 시험기',                'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-009', 'GENERAL',        '측면 내구성 시험기',          'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-010', 'GENERAL',        '박리강도 시험기',            'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-011', 'REPEAT',         '힌지 개폐 시험기',           'NURIKKUM', 'HIGH', 'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-012', 'REPEAT',         '회전 시험기',                'NURIKKUM', 'MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-013', 'GENERAL',        '낙하기',                     'HYANGDONG','LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-014', 'REPEAT',         '케이블 굴곡 시험기',         'NURIKKUM', 'MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-015', 'ENVIRONMENT',    '진동 시험기',                'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-016', 'REPEAT',         '필름 개폐기',                'NURIKKUM', 'MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-017', 'ENVIRONMENT',    '항온항습기',                 'NURIKKUM', 'HIGH', 'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-018', 'ENVIRONMENT',    '항온항습기',                 'HYANGDONG','MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-019', 'ENVIRONMENT',    '내산성 시험기',              'HYANGDONG','MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-020', 'ENVIRONMENT',    '자외선 시험기',              'NURIKKUM', 'MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-021', 'ENVIRONMENT',    '열충격 시험기',              'HYANGDONG','MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-022', 'ENVIRONMENT',    '염수분무 시험기',            'HYANGDONG','MID',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-023', 'ENVIRONMENT',    '정전기 발생기',              'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-TEQ-024', 'ENVIRONMENT',    '방수 시험 수조',             'HYANGDONG','LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-MEA-005', 'GENERAL',        '분광 측색계',                'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-MEA-008', 'GENERAL',        'SMART 스위치 필링 시험기',   'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-MEA-009', 'GENERAL',        '표면 응력 측정기',           'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP),
    ('QA-MEA-012', 'GENERAL',        '시야각 측정기',              'NURIKKUM', 'LOW',  'AVAILABLE', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
