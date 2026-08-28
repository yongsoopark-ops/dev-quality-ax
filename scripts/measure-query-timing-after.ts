/**
 * 진단 전용(읽기 전용) — 성능 개선 적용 후, 실제 /schedule·/home page.tsx가
 * 지금 실행하는 query 그대로를 재현해 측정한다. measure-query-timing.ts(before)와
 * 같은 조건(동일 DB, 동일 반복 횟수)으로 비교하기 위한 스크립트다. 데이터를
 * 전혀 바꾸지 않는다.
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
  console.log("=== /schedule page.tsx (개선 후: 얕은 select + latest revision 2필드만) ===");
  await time("task.findMany(경량 select)", () =>
    prisma.task.findMany({
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        startDate: true,
        dueDate: true,
        goalName: true,
        assignees: { select: { userId: true } },
        projectDetail: { select: { projectName: true } },
        scheduleRevisions: { orderBy: { revisionNo: "desc" }, take: 1, select: { startDate: true, dueDate: true } },
        _count: { select: { comments: true } },
      },
    }),
  );

  console.log("\n=== /schedule 3-query Promise.all 합산(개선 후) ===");
  await time("Promise.all([task(경량), user, projectCategory])", () =>
    Promise.all([
      prisma.task.findMany({
        orderBy: { startDate: "asc" },
        select: {
          id: true,
          title: true,
          category: true,
          status: true,
          startDate: true,
          dueDate: true,
          goalName: true,
          assignees: { select: { userId: true } },
          projectDetail: { select: { projectName: true } },
          scheduleRevisions: { orderBy: { revisionNo: "desc" }, take: 1, select: { startDate: true, dueDate: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
      prisma.projectCategory.findMany({ orderBy: { name: "asc" } }),
    ]),
  );

  console.log("\n=== Task 상세 Lazy Load(Task Modal을 열 때만, getTaskDetailAction) ===");
  const anyTask = await prisma.task.findFirst({ select: { id: true } });
  if (anyTask) {
    await time("getTaskDetailAction 재현(projectDetail+meetingDetail+scheduleRevisions)", () =>
      prisma.task.findUnique({
        where: { id: anyTask.id },
        include: {
          projectDetail: true,
          meetingDetail: { include: { attendees: true } },
          scheduleRevisions: { orderBy: { revisionNo: "desc" }, include: { creator: { select: { name: true } } } },
        },
      }),
    );
  }

  console.log("\n=== Update Modal Lazy Load(Update Modal을 열 때만, getTaskCommentsAction) ===");
  if (anyTask) {
    await time("getTaskCommentsAction 재현", () =>
      prisma.taskComment.findMany({
        where: { taskId: anyTask.id, parentId: null },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true } }, replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } } },
      }),
    );
  }

  console.log("\n=== /home page.tsx (개선 후: Promise.all 2단계, ACTIVE User 중복 제거) ===");
  await time("1단계 Promise.all([activeUsers, kpiDefinition, dashboardLayout])", () =>
    Promise.all([
      prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, email: true, lastActiveAt: true, lastHeartbeatAt: true } }),
      prisma.kPIDefinition.findMany({ where: { enabled: true }, orderBy: { displayOrder: "asc" }, include: { result: true } }),
      prisma.dashboardLayout.findUnique({ where: { key: "HOME_KPI" } }),
    ]),
  );
  await time("2단계 Promise.all([aIUsage, teamPresence(계산만, 쿼리없음)])", () =>
    Promise.all([
      prisma.aIUsage.findMany({ where: { status: "SUCCESS" }, select: { userId: true, calculatedCostUsd: true } }),
      Promise.resolve(null),
    ]),
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
