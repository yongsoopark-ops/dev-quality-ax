/**
 * 진단 전용(읽기 전용) — 싱가포르 vs 미국 테스트 Supabase 리전 비교 측정.
 * measure-query-timing-after.ts와 같은 query 형태를 그대로 재현하되, 두 리전
 * 중 어느 DB에 붙을지를 인자로 받아 5회 이상 반복 측정한다. 데이터를 전혀
 * 바꾸지 않는다(전부 findMany/findUnique/findFirst 읽기 전용).
 *
 * 실행:
 *   npx tsx scripts/measure-region-timing.ts sg   (싱가포르, .env.sg-test.local)
 *   npx tsx scripts/measure-region-timing.ts us   (미국,     .env.us-test.local)
 */
import { config as loadEnv } from "dotenv";

const region = process.argv[2];
if (region !== "sg" && region !== "us") {
  console.error('사용법: npx tsx scripts/measure-region-timing.ts <sg|us>');
  process.exit(1);
}
const envFile = region === "sg" ? ".env.sg-test.local" : ".env.us-test.local";
loadEnv({ path: envFile });
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(`${envFile}에서 DATABASE_URL을 읽지 못했습니다.`);
  process.exit(1);
}

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const RUNS = 5;

function stats(durations: number[]) {
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  return { avg, min, max };
}

function report(label: string, durations: number[]) {
  const { avg, min, max } = stats(durations);
  console.log(
    `${label}: avg=${avg.toFixed(0)}ms min=${min.toFixed(0)}ms max=${max.toFixed(0)}ms runs=[${durations.map((d) => d.toFixed(0)).join(",")}]`,
  );
  return { label, avg, min, max };
}

async function main() {
  console.log(`\n########## 측정 대상 리전: ${region.toUpperCase()} (${envFile}) ##########\n`);

  // 1) Cold connection: 매 반복마다 완전히 새로운 Pool/PrismaClient를 만들어
  //    "최초 연결 비용"을 순수하게 측정한다(재사용 커넥션이면 warm이 되어버림).
  console.log("=== 1. Cold connection (매번 새 Pool 생성 + 최초 쿼리 1회) ===");
  const coldDurations: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({ adapter });
    const start = performance.now();
    await client.user.findFirst({ select: { id: true } });
    coldDurations.push(performance.now() - start);
    await client.$disconnect();
  }
  report("cold connection", coldDurations);

  // 이후 측정은 하나의 재사용 커넥션(warm)으로 진행한다 — 실제 서버리스
  // 함수가 "따뜻한" 상태에서 처리하는 쿼리 비용에 해당한다.
  const pool = new Pool({ connectionString: dbUrl, max: 5 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log("\n=== 2. Warm query (단순 count, 재사용 커넥션) ===");
  const warmDurations: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await prisma.user.count();
    warmDurations.push(performance.now() - start);
  }
  report("warm query", warmDurations);

  console.log("\n=== 3. /schedule 캘린더 쿼리(경량 select, Step G 이후 형태) ===");
  const scheduleDurations: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await prisma.task.findMany({
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
    });
    scheduleDurations.push(performance.now() - start);
  }
  report("/schedule task 쿼리", scheduleDurations);

  console.log("\n=== 4. /home 메인 쿼리 (Promise.all 2단계, Step G 이후 형태) ===");
  const homeDurations: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const [activeUsers] = await Promise.all([
      prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, email: true, lastActiveAt: true, lastHeartbeatAt: true } }),
      prisma.kPIDefinition.findMany({ where: { enabled: true }, orderBy: { displayOrder: "asc" }, include: { result: true } }),
      prisma.dashboardLayout.findUnique({ where: { key: "HOME_KPI" } }),
    ]);
    await Promise.all([
      prisma.aIUsage.findMany({ where: { status: "SUCCESS" }, select: { userId: true, calculatedCostUsd: true } }),
      Promise.resolve(activeUsers),
    ]);
    homeDurations.push(performance.now() - start);
  }
  report("/home Promise.all 2단계 합산", homeDurations);

  const anyTask = await prisma.task.findFirst({ select: { id: true } });

  console.log("\n=== 5. Task 상세 Lazy Load (getTaskDetailAction 재현) ===");
  const detailDurations: number[] = [];
  if (anyTask) {
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      await prisma.task.findUnique({
        where: { id: anyTask.id },
        include: {
          projectDetail: true,
          meetingDetail: { include: { attendees: true } },
          scheduleRevisions: { orderBy: { revisionNo: "desc" }, include: { creator: { select: { name: true } } } },
        },
      });
      detailDurations.push(performance.now() - start);
    }
    report("getTaskDetailAction", detailDurations);
  } else {
    console.log("(Task 데이터 없음 — 스킵)");
  }

  console.log("\n=== 6. Update Modal Lazy Load (getTaskCommentsAction 재현) ===");
  const commentsDurations: number[] = [];
  if (anyTask) {
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      await prisma.taskComment.findMany({
        where: { taskId: anyTask.id, parentId: null },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true } }, replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } } },
      });
      commentsDurations.push(performance.now() - start);
    }
    report("getTaskCommentsAction", commentsDurations);
  } else {
    console.log("(Task 데이터 없음 — 스킵)");
  }

  await prisma.$disconnect();

  console.log(`\n########## ${region.toUpperCase()} 측정 완료 ##########`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
