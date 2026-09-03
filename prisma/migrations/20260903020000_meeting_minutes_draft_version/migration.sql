-- Step(V1 코드 건강도 / 안정화 점검) — MeetingMinutesDraft에 낙관적 동시성
-- 제어용 version 컬럼을 추가한다. 기본값이 있는 단순 컬럼 추가라 기존 Row는
-- 전부 version=0으로 채워지고 전혀 영향받지 않는다. DROP/DELETE/TRUNCATE 등
-- destructive 문 없음.

-- AlterTable
ALTER TABLE "MeetingMinutesDraft" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
