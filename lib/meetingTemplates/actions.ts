"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateMeetingTemplateSchema } from "./validate";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import type { MeetingTemplateSchema } from "./types";

/** 조회 결과에서 Client가 그대로 쓰는 모양 — templateSchema는 이미 파싱해서
 * 내려준다(Client가 다시 JSON.parse할 필요 없음). */
export interface MeetingTemplateInfo {
  id: string;
  name: string;
  meetingType: MeetingTemplateType;
  templateSchema: MeetingTemplateSchema;
  updatedBy: string;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("FORBIDDEN");
  return session;
}

/**
 * 권한 정책(요청사항): ADMIN만 Template을 생성/수정할 수 있고, MEMBER는
 * 조회(사용)만 할 수 있다. lib/sidebar/actions.ts의 saveSidebarLayout과
 * 동일한 패턴 — Client가 role을 속일 수 없도록 항상 서버 Session에서 다시
 * 확인한다.
 */
function requireAdmin(session: { user: { role: string } }): string | null {
  if (session.user.role !== "ADMIN") return "관리자만 Template을 생성/수정할 수 있습니다.";
  return null;
}

function toInfo(row: {
  id: string;
  name: string;
  meetingType: MeetingTemplateType;
  templateSchema: string;
  updatedBy: string;
  updater: { name: string | null };
  createdAt: Date;
  updatedAt: Date;
}): MeetingTemplateInfo | null {
  const parsed = validateMeetingTemplateSchema(JSON.parse(row.templateSchema));
  // DB에 저장된 값은 저장 시점에 이미 한 번 검증을 통과했지만, 혹시 모를 수동
  // 변경 등에 대비해 조회 시에도 다시 검증한다 — 깨진 데이터를 그대로 Client에
  // 내려보내지 않는다.
  if (!parsed) return null;
  return {
    id: row.id,
    name: row.name,
    meetingType: row.meetingType,
    templateSchema: parsed,
    updatedBy: row.updatedBy,
    updatedByName: row.updater.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** MEMBER 포함 로그인한 누구나 조회 가능("사용만 가능"). meetingType을 주면
 * 그 유형만, 없으면 전체를 최신순으로 반환한다. */
export async function listMeetingTemplatesAction(
  meetingType?: MeetingTemplateType,
): Promise<{ templates?: MeetingTemplateInfo[]; error?: string }> {
  await requireUser();

  const rows = await prisma.meetingTemplate.findMany({
    where: meetingType ? { meetingType } : undefined,
    orderBy: { updatedAt: "desc" },
    include: { updater: { select: { name: true } } },
  });

  return { templates: rows.map(toInfo).filter((t): t is MeetingTemplateInfo => t !== null) };
}

/** 그 meetingType에서 updatedAt이 가장 최근인 Row 1건 — "초기화 시 최신
 * Template"(다음 Step)이 그대로 쓸 조회 함수. 없으면 template: null. */
export async function getLatestMeetingTemplateAction(
  meetingType: MeetingTemplateType,
): Promise<{ template?: MeetingTemplateInfo | null; error?: string }> {
  await requireUser();

  const row = await prisma.meetingTemplate.findFirst({
    where: { meetingType },
    orderBy: { updatedAt: "desc" },
    include: { updater: { select: { name: true } } },
  });

  return { template: row ? toInfo(row) : null };
}

export async function createMeetingTemplateAction(input: {
  name: string;
  meetingType: MeetingTemplateType;
  templateSchema: unknown;
}): Promise<{ template?: MeetingTemplateInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdmin(session);
  if (permissionError) return { error: permissionError };

  const name = input.name.trim();
  if (!name) return { error: "Template 이름을 입력해 주세요." };

  const validated = validateMeetingTemplateSchema(input.templateSchema);
  if (!validated) return { error: "Template 구조가 올바르지 않습니다." };

  try {
    const row = await prisma.meetingTemplate.create({
      data: {
        name,
        meetingType: input.meetingType,
        templateSchema: JSON.stringify(validated),
        updatedBy: session.user.id,
      },
      include: { updater: { select: { name: true } } },
    });
    const info = toInfo(row);
    return info ? { template: info } : { error: "Template을 저장했지만 불러오지 못했습니다." };
  } catch {
    // 대표적으로 @@unique([meetingType, name]) 위반(이름 중복) — 원인을 세분화해
    // 노출하지 않고 일반 사용자용 문구만 반환한다.
    return { error: "Template을 저장하지 못했습니다. 같은 이름의 Template이 이미 있는지 확인해 주세요." };
  }
}

export async function updateMeetingTemplateAction(
  id: string,
  input: { name: string; templateSchema: unknown },
): Promise<{ template?: MeetingTemplateInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdmin(session);
  if (permissionError) return { error: permissionError };

  const name = input.name.trim();
  if (!name) return { error: "Template 이름을 입력해 주세요." };

  const validated = validateMeetingTemplateSchema(input.templateSchema);
  if (!validated) return { error: "Template 구조가 올바르지 않습니다." };

  try {
    const row = await prisma.meetingTemplate.update({
      where: { id },
      data: { name, templateSchema: JSON.stringify(validated), updatedBy: session.user.id },
      include: { updater: { select: { name: true } } },
    });
    const info = toInfo(row);
    return info ? { template: info } : { error: "Template을 수정했지만 불러오지 못했습니다." };
  } catch {
    return { error: "Template을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
