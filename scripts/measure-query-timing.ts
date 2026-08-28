/**
 * 진단 전용(읽기 전용) — /schedule, /home이 실제로 날리는 Prisma query를 그대로
 * 재현해 Supabase까지의 순수 query 왕복 시간을 측정한다. 데이터를 전혀 바꾸지
 * 않는다. 각 query를 3회 반복해 평균/최악을 함께 기록한다.
 */
import { prisma } from "@/lib/prisma";

async function time<T>(label: string, fn: () => Promise<T>, runs = 3) {
  const durations: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const max = Math.max(...durations);
  console.log(`${label}: avg=${avg.toFixed(0)}ms max=${max.toFixed(0)}ms runs=${durations.map((d) => d.toFixed(0)).join(",")}`);
  return { label, avg, max };
}

async function main() {
  console.log("=== 콜드 커넥션 비용(첫 쿼리, Pool 최초 연결 포함) ===");
  await time("최초 연결+간단 쿼리(SELECT 1급)", () => prisma.user.count(), 1);

  console.log("\n=== /schedule page.tsx의 3개 query ===");
  await time("task.findMany(깊은 include: assignees+projectDetail+meetingDetail+revisions+comments+replies)", () =>
    prisma.task.findMany({
      orderBy: { startDate: "asc" },
      include: {
        assignees: true,
        projectDetail: true,
        meetingDetail: { include: { attendees: true } },
        scheduleRevisions: { orderBy: { revisionNo: "asc" }, include: { creator: { select: { name: true } } } },
        comments: {
          where: { parentId: null },
          orderBy: { createdAt: "asc" },
          include: { author: { select: { name: true } }, replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } } },
        },
      },
    }),
  );
  await time("user.findMany(ACTIVE)", () => prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }));
  await time("projectCategory.findMany", () => prisma.projectCategory.findMany({ orderBy: { name: "asc" } }));

  console.log("\n=== 참고: task.findMany을 얕은 select로만 했을 때(Calendar가 실제 필요로 하는 최소 필드) ===");
  await time("task.findMany(얕은 select: id/title/category/status/startDate/dueDate/assignees만)", () =>
    prisma.task.findMany({
      orderBy: { startDate: "asc" },
      select: { id: true, title: true, category: true, status: true, startDate: true, dueDate: true, assignees: { select: { userId: true } } },
    }),
  );

  console.log("\n=== /home page.tsx의 query들(현재는 순차 await) ===");
  await time("kPIDefinition.findMany(+result)", () => prisma.kPIDefinition.findMany({ where: { enabled: true }, orderBy: { displayOrder: "asc" }, include: { result: true } }));
  await time("user.findMany(ACTIVE) — getMonthlyApiUsageByUser 안", () => prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, email: true } }));
  await time("aIUsage.findMany(이번달)", () => prisma.aIUsage.findMany({ where: { status: "SUCCESS" }, select: { userId: true, calculatedCostUsd: true } }));
  await time("user.findMany(ACTIVE) — getTeamPresenceSummary 안(중복 쿼리)", () =>
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, email: true, lastActiveAt: true, lastHeartbeatAt: true } }),
  );
  await time("googleSheetSourceRow.findMany(캐시 행 전체)", async () => {
    const source = await prisma.googleSheetSource.findFirst();
    if (!source) return [];
    return prisma.googleSheetSourceRow.findMany({ where: { sourceId: source.id }, orderBy: { rowIndex: "asc" } });
  });
  await time("dashboardLayout.findUnique", () => prisma.dashboardLayout.findUnique({ where: { key: "HOME_KPI" } }));

  console.log("\n=== Promise.all 병렬 실행 시 /schedule 3-query 합산 시간(현재 구조 그대로) ===");
  await time("Promise.all([task, user, projectCategory])", () =>
    Promise.all([
      prisma.task.findMany({
        orderBy: { startDate: "asc" },
        include: {
          assignees: true,
          projectDetail: true,
          meetingDetail: { include: { attendees: true } },
          scheduleRevisions: { orderBy: { revisionNo: "asc" }, include: { creator: { select: { name: true } } } },
          comments: { where: { parentId: null }, orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } }, replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } } } },
        },
      }),
      prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
      prisma.projectCategory.findMany({ orderBy: { name: "asc" } }),
    ]),
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
