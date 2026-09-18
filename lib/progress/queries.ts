import { prisma } from "@/lib/prisma";
import { FACILITY_PART_MEMBER_NAMES } from "@/lib/facility/constants";
import { formatIsoDate } from "@/lib/progress/date";
import type {
  ProgressAssigneeOption,
  ProgressCommonTaskRow,
  ProgressRegularProjectRow,
  ProgressSubProjectRow,
} from "@/lib/progress/types";

/**
 * 진행 현황 — 순수 조회 헬퍼. Server Component(page.tsx)가 직접 호출한다
 * (설비 관리 lib/facility/queries.ts와 동일한 관례 — "use server" Action
 * 파일에는 mutation만 둔다).
 */

/** 담당자 후보 — ZIP의 MEMBERS(박용수·정효준·이지민·김현나) 4명은 개발품질
 * 파트의 실제 고정 구성원이라, 이미 같은 이유로 하드코딩돼 있는
 * lib/facility/constants.ts의 FACILITY_PART_MEMBER_NAMES를 그대로
 * 재사용한다(같은 목록을 이 모듈에 다시 하드코딩하지 않는다). */
export async function getProgressAssigneeOptions(): Promise<ProgressAssigneeOption[]> {
  const users = await prisma.user.findMany({
    where: { name: { in: [...FACILITY_PART_MEMBER_NAMES] } },
    select: { id: true, name: true },
  });
  const byName = new Map(users.map((u) => [u.name, u.id]));
  return FACILITY_PART_MEMBER_NAMES.filter((name) => byName.has(name)).map((name) => ({ userId: byName.get(name)!, name }));
}

export async function getRegularProjects(): Promise<ProgressRegularProjectRow[]> {
  const rows = await prisma.progressRegularProject.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      owner: { select: { name: true } },
      updateLogs: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    ownerName: r.owner.name ?? "",
    status: r.status,
    stageRunIndexes: r.stageRunIndexes,
    stageSkipIndexes: r.stageSkipIndexes,
    kickoffDate: formatIsoDate(r.kickoffDate),
    targetReleaseDate: formatIsoDate(r.targetReleaseDate),
    actualReleaseDate: formatIsoDate(r.actualReleaseDate),
    samplePw3Date: formatIsoDate(r.samplePw3Date),
    samplePw4Date: formatIsoDate(r.samplePw4Date),
    artifactUrl: r.artifactUrl ?? "",
    improvementRounds: r.improvementRounds,
    updateLogs: r.updateLogs.map((l) => ({
      id: l.id,
      authorName: l.author.name ?? "",
      content: l.content,
      createdAt: formatIsoDate(l.createdAt),
    })),
  }));
}

export async function getSubProjects(): Promise<ProgressSubProjectRow[]> {
  const rows = await prisma.progressSubProject.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      owner: { select: { name: true } },
      items: { orderBy: [{ quarterYear: "asc" }, { quarterNum: "asc" }, { order: "asc" }] },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    ownerName: r.owner.name ?? "",
    status: r.status,
    quarterStartYear: r.quarterStartYear,
    quarterStartQ: r.quarterStartQ,
    quarterEndYear: r.quarterEndYear,
    quarterEndQ: r.quarterEndQ,
    sheetUrl: r.sheetUrl ?? "",
    items: r.items.map((it) => ({
      id: it.id,
      text: it.text,
      quarterYear: it.quarterYear,
      quarterNum: it.quarterNum,
      status: it.status,
      order: it.order,
    })),
  }));
}

export async function getCommonTasks(): Promise<ProgressCommonTaskRow[]> {
  const rows = await prisma.progressCommonTask.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      owner: { select: { name: true } },
      items: { orderBy: [{ monthYear: "asc" }, { monthNum: "asc" }] },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    ownerName: r.owner.name ?? "",
    repeat: r.repeat,
    repeatDay: r.repeatDay ?? "1",
    monthStartYear: r.monthStartYear,
    monthStartNum: r.monthStartNum,
    monthEndYear: r.monthEndYear,
    monthEndNum: r.monthEndNum,
    items: r.items.map((it) => ({
      id: it.id,
      monthYear: it.monthYear,
      monthNum: it.monthNum,
      status: it.status,
      carriedFromYear: it.carriedFromYear,
      carriedFromMonth: it.carriedFromMonth,
    })),
  }));
}
