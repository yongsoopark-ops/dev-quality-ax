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
  /** Step 5B-3 보완 — 이 meetingType에서 자동 회의록 생성/초기화가 실제로
   * 사용하는 Template인지. 같은 meetingType 안에서 true는 항상 최대 1개뿐이다
   * (DB 부분 유니크 인덱스로 강제). */
  isActive: boolean;
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
  isActive: boolean;
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
    isActive: row.isActive,
    updatedBy: row.updatedBy,
    updatedByName: row.updater.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** MEMBER 포함 로그인한 누구나 조회 가능("사용만 가능"). meetingType을 주면
 * 그 유형만, 없으면 전체를 최신 수정순으로 반환한다 — 이 정렬은 목록 표시
 * 순서일 뿐, "어떤 Template을 자동으로 쓸지"는 절대 여기서 결정하지 않는다
 * (그 결정은 항상 getActiveMeetingTemplateAction의 isActive 기준). 각 항목의
 * isActive로 다음 Editor Step이 "현재 사용 중" 표시를 그릴 수 있다. */
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

/**
 * Step 5B-3 보완 — 그 meetingType에서 isActive=true인 Row 1건("이 유형에서
 * 실제 사용 중인 Template"). updatedAt은 더 이상 선택 기준이 아니다 — 같은
 * meetingType에 테스트/대체 Template이 여러 개 있어도 명시적으로 활성화된
 * 것 하나만 돌려준다. 자동 회의록 생성/초기화(다음 Step)가 이 함수만 쓴다.
 * DB 부분 유니크 인덱스가 "최대 1개"를 보장하므로 findFirst로 충분하다.
 * 활성 Template이 아직 하나도 지정되지 않았으면 template: null.
 */
export async function getActiveMeetingTemplateAction(
  meetingType: MeetingTemplateType,
): Promise<{ template?: MeetingTemplateInfo | null; error?: string }> {
  await requireUser();

  const row = await prisma.meetingTemplate.findFirst({
    where: { meetingType, isActive: true },
    include: { updater: { select: { name: true } } },
  });

  return { template: row ? toInfo(row) : null };
}

/**
 * Step 5B-3 보완 — "이 양식 사용"(다음 Editor Step이 호출할 활성 전환).
 * ADMIN만 가능하다. 같은 meetingType의 나머지 Template을 먼저 전부
 * 비활성화한 뒤에만 대상을 활성화한다(이 순서를 반대로 하면 부분 유니크
 * 인덱스가 일시적으로 위반돼 트랜잭션이 실패한다) — 트랜잭션으로 묶어
 * 중간 상태가 노출되지 않는다.
 */
export async function setActiveMeetingTemplateAction(id: string): Promise<{ template?: MeetingTemplateInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdmin(session);
  if (permissionError) return { error: permissionError };

  const target = await prisma.meetingTemplate.findUnique({ where: { id } });
  if (!target) return { error: "Template을 찾을 수 없습니다." };

  try {
    const [, updated] = await prisma.$transaction([
      prisma.meetingTemplate.updateMany({
        where: { meetingType: target.meetingType, id: { not: id } },
        data: { isActive: false },
      }),
      prisma.meetingTemplate.update({
        where: { id },
        data: { isActive: true },
        include: { updater: { select: { name: true } } },
      }),
    ]);
    const info = toInfo(updated);
    return info ? { template: info } : { error: "활성 Template으로 전환했지만 불러오지 못했습니다." };
  } catch {
    return { error: "활성 Template 전환에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** 새 Template은 절대 자동으로 활성화되지 않는다(schema 기본값 isActive=false
 * 그대로 저장) — "이 양식 사용"으로 명시적으로 전환하기 전까지는 테스트/대체
 * Template일 뿐, 자동 회의록 생성/초기화 대상이 되지 않는다(요청사항). */
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

/** Step 5B-3(Editor) — 이름뿐 아니라 회의 유형도 수정할 수 있다(요청사항:
 * "이름/회의 유형 수정 시 기존 unique 제약 안전 처리"). meetingType을
 * 바꿔도 isActive는 그대로 유지된다 — 활성 전환은 항상
 * setActiveMeetingTemplateAction을 통해서만 일어난다(요청사항: 별도 저장
 * 구조를 만들지 않음). @@unique([meetingType, name]) 위반은 catch에서
 * 일반 사용자용 문구로만 알린다. */
export async function updateMeetingTemplateAction(
  id: string,
  input: { name: string; meetingType: MeetingTemplateType; templateSchema: unknown },
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
      data: {
        name,
        meetingType: input.meetingType,
        templateSchema: JSON.stringify(validated),
        updatedBy: session.user.id,
      },
      include: { updater: { select: { name: true } } },
    });
    const info = toInfo(row);
    return info ? { template: info } : { error: "Template을 수정했지만 불러오지 못했습니다." };
  } catch {
    return { error: "Template을 수정하지 못했습니다. 같은 회의 유형에 같은 이름의 Template이 이미 있는지 확인해 주세요." };
  }
}

/**
 * Step 5B-3(Editor) — 개별 회의록을 저장하지 않는 정책상 MeetingTemplate을
 * 참조하는 다른 테이블이 없어(FK로 이 테이블을 가리키는 쪽이 없음) 삭제가
 * 항상 안전하다. 활성(isActive=true) Template을 삭제하면 그 meetingType은
 * 활성 Template이 없는 상태가 된다 — 별도 자동 승계는 하지 않는다(요청사항
 * 범위 밖, Client가 삭제 전 확인창으로 안내).
 */
export async function deleteMeetingTemplateAction(id: string): Promise<{ ok?: true; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdmin(session);
  if (permissionError) return { error: permissionError };

  try {
    await prisma.meetingTemplate.delete({ where: { id } });
    return { ok: true };
  } catch {
    return { error: "Template을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
