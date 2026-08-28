import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

/**
 * 임시 내부 진단 전용 Route — Netlify 실제 실행 환경(us-east-1 Functions)에서
 * Supabase 싱가포르 vs 미국 리전까지의 지연을 직접 비교하기 위한 것이다.
 *
 * 절대 원칙:
 * - Production `dqax`가 쓰는 DATABASE_URL/DIRECT_URL은 이 파일에서 전혀
 *   참조하지 않는다. 오직 이 진단 목적으로만 새로 추가하는
 *   SG_DATABASE_URL / US_DATABASE_URL / BENCH_SECRET 환경변수만 읽는다.
 * - 모든 쿼리는 findMany/findFirst/count 등 읽기 전용이며, 어떤 write도
 *   하지 않는다.
 * - BENCH_SECRET이 설정돼 있지 않거나 토큰이 일치하지 않으면 404로 응답해
 *   존재 자체를 드러내지 않는다.
 * - 측정이 끝나면 이 파일은 삭제(또는 최소한 BENCH_SECRET 미설정으로 비활성화)
 *   한다 — 외부에서 무분별하게 호출되는 것을 막기 위함.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RUNS = 15;
const DEFAULT_RUNS = 10;

function stats(durations: number[]) {
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  return { avg: Math.round(avg), min: Math.round(min), max: Math.round(max), runs: durations.map((d) => Math.round(d)) };
}

async function measureRegion(dbUrl: string, runs: number) {
  // 1) cold: 매 반복마다 완전히 새 Pool/PrismaClient를 만들어 "새 연결 비용"을 측정한다.
  //    (주의: 이것도 하나의 Netlify Function 호출 안에서 도는 것이라, Lambda
  //    컨테이너 자체의 최초 콜드스타트와는 다르다 — 아래 순수 "DB 연결" 비용만 반영.)
  const coldDurations: number[] = [];
  for (let i = 0; i < runs; i++) {
    const pool = new Pool({ connectionString: dbUrl });
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });
    const start = performance.now();
    await client.user.findFirst({ select: { id: true } });
    coldDurations.push(performance.now() - start);
    await client.$disconnect();
  }

  // 이후는 재사용 커넥션(warm)으로 측정한다.
  const pool = new Pool({ connectionString: dbUrl, max: 5 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const warmDurations: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await prisma.user.count();
      warmDurations.push(performance.now() - start);
    }

    const scheduleDurations: number[] = [];
    for (let i = 0; i < runs; i++) {
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

    const homeDurations: number[] = [];
    for (let i = 0; i < runs; i++) {
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

    const anyTask = await prisma.task.findFirst({ select: { id: true } });
    const detailDurations: number[] = [];
    if (anyTask) {
      for (let i = 0; i < runs; i++) {
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
    }

    return {
      cold: stats(coldDurations),
      warm: stats(warmDurations),
      schedule: stats(scheduleDurations),
      home: stats(homeDurations),
      taskDetail: detailDurations.length > 0 ? stats(detailDurations) : null,
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.BENCH_SECRET;
  const token = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-bench-token");

  // secret 미설정 또는 불일치 시 존재 자체를 숨긴다.
  if (!secret || !token || token !== secret) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const sgUrl = process.env.SG_DATABASE_URL;
  const usUrl = process.env.US_DATABASE_URL;
  if (!sgUrl || !usUrl) {
    return NextResponse.json({ error: "SG_DATABASE_URL / US_DATABASE_URL이 설정되지 않았습니다." }, { status: 500 });
  }

  const runsParam = Number(req.nextUrl.searchParams.get("runs"));
  const runs = Number.isFinite(runsParam) && runsParam > 0 ? Math.min(runsParam, MAX_RUNS) : DEFAULT_RUNS;

  const startedAt = new Date().toISOString();
  const [sg, us] = await Promise.all([measureRegion(sgUrl, runs), measureRegion(usUrl, runs)]);

  return NextResponse.json({
    startedAt,
    runs,
    runtimeRegion: process.env.AWS_REGION ?? null,
    netlifyContext: process.env.CONTEXT ?? null,
    sg,
    us,
  });
}
