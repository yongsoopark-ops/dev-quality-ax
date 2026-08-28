/**
 * 1회성 데이터 복제 스크립트 — 싱가포르(운영, 읽기 전용) Supabase의 모든 실제
 * 데이터를 미국 테스트 Supabase로 그대로 복사한다. ID/생성일/수정일을 전부
 * 원본 그대로 보존하며, FK 의존 순서를 지켜 하나의 트랜잭션 안에서 대상 DB에
 * 삽입한다. 원본(싱가포르)에는 어떤 쓰기도 하지 않는다 — 오직 findMany만 호출.
 *
 * 실행:
 *   npx tsx scripts/copy-sg-to-us-test.ts
 *   (스크립트 내부에서 .env.sg-test.local과 .env.us-test.local을 각각 직접
 *    읽는다 — 별도로 source/--env-file을 쓸 필요가 없다.)
 *
 * 이 스크립트는 lib/prisma.ts의 공용 싱글턴을 쓰지 않는다 — 원본/대상 두 DB에
 * 동시에 연결해야 하므로 각자 독립된 Pool/PrismaClient를 직접 만든다.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.sg-test.local" });
const sgUrl = process.env.DATABASE_URL;
loadEnv({ path: ".env.us-test.local", override: true });
const usUrl = process.env.DATABASE_URL;

if (!sgUrl || !usUrl || sgUrl === usUrl) {
  console.error("SG/US DATABASE_URL을 각각 .env.sg-test.local / .env.us-test.local에서 읽지 못했거나 같은 값입니다 — 중단합니다.");
  process.exit(1);
}

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const sgPrisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: sgUrl })) });
const usPrisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: usUrl })) });

async function main() {
  console.log("싱가포르(원본, 읽기 전용) → 미국 테스트 DB로 복제합니다...");

  const [
    users,
    sheetSources,
    sheetRows,
    kpiDefs,
    kpiResults,
    aiUsages,
    dashboardLayouts,
    sidebarLayouts,
    projectCategories,
    tasks,
    taskAssignees,
    taskProjectDetails,
    taskMeetingDetails,
    taskMeetingAttendees,
    taskRevisions,
    taskComments,
    notifications,
  ] = await Promise.all([
    sgPrisma.user.findMany(),
    sgPrisma.googleSheetSource.findMany(),
    sgPrisma.googleSheetSourceRow.findMany(),
    sgPrisma.kPIDefinition.findMany(),
    sgPrisma.kPIResult.findMany(),
    sgPrisma.aIUsage.findMany(),
    sgPrisma.dashboardLayout.findMany(),
    sgPrisma.sidebarLayout.findMany(),
    sgPrisma.projectCategory.findMany(),
    sgPrisma.task.findMany(),
    sgPrisma.taskAssignee.findMany(),
    sgPrisma.taskProjectDetail.findMany(),
    sgPrisma.taskMeetingDetail.findMany(),
    sgPrisma.taskMeetingAttendee.findMany(),
    sgPrisma.taskScheduleRevision.findMany(),
    sgPrisma.taskComment.findMany(),
    sgPrisma.notification.findMany(),
  ]);

  const sourceCounts = {
    users: users.length,
    sheetSources: sheetSources.length,
    sheetRows: sheetRows.length,
    kpiDefs: kpiDefs.length,
    kpiResults: kpiResults.length,
    aiUsages: aiUsages.length,
    dashboardLayouts: dashboardLayouts.length,
    sidebarLayouts: sidebarLayouts.length,
    projectCategories: projectCategories.length,
    tasks: tasks.length,
    taskAssignees: taskAssignees.length,
    taskProjectDetails: taskProjectDetails.length,
    taskMeetingDetails: taskMeetingDetails.length,
    taskMeetingAttendees: taskMeetingAttendees.length,
    taskRevisions: taskRevisions.length,
    taskComments: taskComments.length,
    notifications: notifications.length,
  };
  console.log("원본(싱가포르) count:", JSON.stringify(sourceCounts, null, 2));

  await usPrisma.$transaction(
    async (tx) => {
      for (const u of users) await tx.user.create({ data: u });
      for (const s of sheetSources) await tx.googleSheetSource.create({ data: s });
      for (const r of sheetRows) await tx.googleSheetSourceRow.create({ data: r });
      for (const k of kpiDefs) await tx.kPIDefinition.create({ data: k });
      for (const r of kpiResults) await tx.kPIResult.create({ data: r });
      for (const a of aiUsages) await tx.aIUsage.create({ data: a });
      for (const d of dashboardLayouts) await tx.dashboardLayout.create({ data: d });
      for (const s of sidebarLayouts) await tx.sidebarLayout.create({ data: s });
      for (const c of projectCategories) await tx.projectCategory.create({ data: c });
      for (const t of tasks) await tx.task.create({ data: t });
      for (const a of taskAssignees) await tx.taskAssignee.create({ data: a });
      for (const d of taskProjectDetails) await tx.taskProjectDetail.create({ data: d });
      for (const d of taskMeetingDetails) await tx.taskMeetingDetail.create({ data: d });
      for (const a of taskMeetingAttendees) await tx.taskMeetingAttendee.create({ data: a });
      for (const r of taskRevisions) await tx.taskScheduleRevision.create({ data: r });
      // 자기참조(parentId) FK 순서 보장 — 원문(parentId IS NULL)을 답변보다 먼저 넣는다.
      const sortedComments = [...taskComments].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
      for (const c of sortedComments) await tx.taskComment.create({ data: c });
      for (const n of notifications) await tx.notification.create({ data: n });
    },
    { timeout: 120_000 },
  );

  const targetCounts = {
    users: await usPrisma.user.count(),
    sheetSources: await usPrisma.googleSheetSource.count(),
    sheetRows: await usPrisma.googleSheetSourceRow.count(),
    kpiDefs: await usPrisma.kPIDefinition.count(),
    kpiResults: await usPrisma.kPIResult.count(),
    aiUsages: await usPrisma.aIUsage.count(),
    dashboardLayouts: await usPrisma.dashboardLayout.count(),
    sidebarLayouts: await usPrisma.sidebarLayout.count(),
    projectCategories: await usPrisma.projectCategory.count(),
    tasks: await usPrisma.task.count(),
    taskAssignees: await usPrisma.taskAssignee.count(),
    taskProjectDetails: await usPrisma.taskProjectDetail.count(),
    taskMeetingDetails: await usPrisma.taskMeetingDetail.count(),
    taskMeetingAttendees: await usPrisma.taskMeetingAttendee.count(),
    taskRevisions: await usPrisma.taskScheduleRevision.count(),
    taskComments: await usPrisma.taskComment.count(),
    notifications: await usPrisma.notification.count(),
  };
  console.log("대상(미국) count(복제 후):", JSON.stringify(targetCounts, null, 2));

  const mismatches = Object.keys(sourceCounts).filter(
    (k) => sourceCounts[k as keyof typeof sourceCounts] !== targetCounts[k as keyof typeof targetCounts],
  );
  console.log(mismatches.length === 0 ? "모든 Table count 일치." : `불일치: ${mismatches.join(", ")}`);

  await sgPrisma.$disconnect();
  await usPrisma.$disconnect();
}

main().catch(async (e) => {
  console.error("복제 실패 — 대상(미국) DB 트랜잭션은 롤백되었습니다:", e);
  await sgPrisma.$disconnect();
  await usPrisma.$disconnect();
  process.exit(1);
});
