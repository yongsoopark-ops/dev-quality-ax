/**
 * 운영 DB 리전 전환 준비 — 미국 테스트 Supabase를 "현재" 싱가포르 운영 DB
 * 기준으로 다시 정확히 동기화한다(이전 1회성 복제 이후 운영 데이터가 바뀌었을
 * 수 있으므로 최신 상태로 재동기화).
 *
 * 절차: US 테이블을 FK 역순으로 전부 비운 뒤, SG(읽기 전용)에서 읽은 데이터를
 * FK 순서대로 다시 삽입한다. SG 쪽은 findMany만 호출 — 어떤 쓰기도 하지 않는다.
 * ID/createdAt/updatedAt/FK를 전부 원본 그대로 보존한다.
 *
 * 실행: npx tsx scripts/resync-us-from-sg.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.sg-test.local" });
const sgUrl = process.env.DATABASE_URL;
loadEnv({ path: ".env.us-test.local", override: true });
const usUrl = process.env.DATABASE_URL;

if (!sgUrl || !usUrl || sgUrl === usUrl) {
  console.error("SG/US DATABASE_URL을 각각 읽지 못했거나 같은 값입니다 — 중단합니다.");
  process.exit(1);
}

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const sgPrisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: sgUrl })) });
const usPrisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: usUrl })) });

function idSet(rows: { id: string }[]) {
  return rows.map((r) => r.id).sort();
}

async function main() {
  console.log("=== 1) 싱가포르(운영, 읽기 전용) 최종 스냅샷 조회 ===");
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
  console.log("SG count(전환 전 최종 점검):", JSON.stringify(sourceCounts, null, 2));
  console.log("SG User ID 목록:", idSet(users).join(", "));
  console.log("SG Task ID 목록:", idSet(tasks).join(", "));

  console.log("\n=== 2) US 테스트 DB 기존 데이터 삭제(FK 역순) ===");
  await usPrisma.$transaction(
    async (tx) => {
      await tx.notification.deleteMany();
      await tx.taskComment.deleteMany();
      await tx.taskScheduleRevision.deleteMany();
      await tx.taskMeetingAttendee.deleteMany();
      await tx.taskMeetingDetail.deleteMany();
      await tx.taskProjectDetail.deleteMany();
      await tx.taskAssignee.deleteMany();
      await tx.task.deleteMany();
      await tx.projectCategory.deleteMany();
      await tx.sidebarLayout.deleteMany();
      await tx.dashboardLayout.deleteMany();
      await tx.aIUsage.deleteMany();
      await tx.kPIResult.deleteMany();
      await tx.kPIDefinition.deleteMany();
      await tx.googleSheetSourceRow.deleteMany();
      await tx.googleSheetSource.deleteMany();
      await tx.user.deleteMany();
    },
    { timeout: 120_000 },
  );
  console.log("US 기존 데이터 삭제 완료.");

  console.log("\n=== 3) SG 스냅샷을 US에 재삽입(FK 순서) ===");
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
      const sortedComments = [...taskComments].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
      for (const c of sortedComments) await tx.taskComment.create({ data: c });
      for (const n of notifications) await tx.notification.create({ data: n });
    },
    { timeout: 120_000 },
  );

  console.log("\n=== 4) 재동기화 후 검증 ===");
  const [usUsers, usTasks] = await Promise.all([usPrisma.user.findMany({ select: { id: true } }), usPrisma.task.findMany({ select: { id: true } })]);
  const targetCounts = {
    users: usUsers.length,
    sheetSources: await usPrisma.googleSheetSource.count(),
    sheetRows: await usPrisma.googleSheetSourceRow.count(),
    kpiDefs: await usPrisma.kPIDefinition.count(),
    kpiResults: await usPrisma.kPIResult.count(),
    aiUsages: await usPrisma.aIUsage.count(),
    dashboardLayouts: await usPrisma.dashboardLayout.count(),
    sidebarLayouts: await usPrisma.sidebarLayout.count(),
    projectCategories: await usPrisma.projectCategory.count(),
    tasks: usTasks.length,
    taskAssignees: await usPrisma.taskAssignee.count(),
    taskProjectDetails: await usPrisma.taskProjectDetail.count(),
    taskMeetingDetails: await usPrisma.taskMeetingDetail.count(),
    taskMeetingAttendees: await usPrisma.taskMeetingAttendee.count(),
    taskRevisions: await usPrisma.taskScheduleRevision.count(),
    taskComments: await usPrisma.taskComment.count(),
    notifications: await usPrisma.notification.count(),
  };
  console.log("US count(재동기화 후):", JSON.stringify(targetCounts, null, 2));

  const countMismatches = Object.keys(sourceCounts).filter(
    (k) => sourceCounts[k as keyof typeof sourceCounts] !== targetCounts[k as keyof typeof targetCounts],
  );
  const sgUserIds = idSet(users);
  const usUserIds = idSet(usUsers);
  const sgTaskIds = idSet(tasks);
  const usTaskIds = idSet(usTasks);
  const userIdMatch = JSON.stringify(sgUserIds) === JSON.stringify(usUserIds);
  const taskIdMatch = JSON.stringify(sgTaskIds) === JSON.stringify(usTaskIds);

  console.log(countMismatches.length === 0 ? "✅ 모든 Table count 일치." : `❌ count 불일치: ${countMismatches.join(", ")}`);
  console.log(userIdMatch ? "✅ User ID 집합 완전 일치." : "❌ User ID 집합 불일치.");
  console.log(taskIdMatch ? "✅ Task ID 집합 완전 일치." : "❌ Task ID 집합 불일치.");

  await sgPrisma.$disconnect();
  await usPrisma.$disconnect();

  if (countMismatches.length > 0 || !userIdMatch || !taskIdMatch) {
    console.error("\n검증 실패 — 운영 전환을 진행하지 마십시오.");
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error("재동기화 실패:", e);
  await sgPrisma.$disconnect();
  await usPrisma.$disconnect();
  process.exit(1);
});
