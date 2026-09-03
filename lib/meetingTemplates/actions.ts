"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { parseDocumentContentInput, validateDocumentContent } from "./richText";
import { validateMeetingTemplateSchema } from "./validate";
import { attachMissingMeetingSectionAttributes } from "@/lib/meetingMinutes/sectionHeadings";
import { attachMissingFieldKeyAttributes } from "@/lib/meetingMinutes/fieldSemantics";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import type { MeetingTemplateSchema } from "./types";
import type { JSONContent } from "@tiptap/core";

/** Diagnostic 버그 수정(2026-08-31) — 아래 create/update의 catch가 "무슨
 * 에러든 전부 이름 중복"으로 뭉뚱그려 보고하던 것이 실제 원인 파악을
 * 막고 있었다(@@unique([meetingType, name]) 위반이 아닌 다른 이유로 저장이
 * 실패해도 사용자에게는 항상 "같은 이름이 이미 있습니다"만 보였다). Prisma
 * 에러 코드를 직접 확인해, 진짜 unique 위반(P2002)일 때만 그 메시지를 쓰고
 * 그 외에는 실제 에러를 서버 로그에 남긴 뒤 별도의 정직한 메시지를 준다 —
 * app/(shell)/schedule/actions.ts가 이미 쓰는 것과 같은 패턴이다. */
function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** 조회 결과에서 Client가 그대로 쓰는 모양 — templateSchema/documentContent는
 * 이미 파싱해서 내려준다(Client가 다시 JSON.parse할 필요 없음). */
export interface MeetingTemplateInfo {
  id: string;
  name: string;
  meetingType: MeetingTemplateType;
  /** Step 5B-3.2까지의 레거시 block 배열. Rich Text Editor(5B-3.3)는 이 값을
   * 더 이상 만들지 않지만, documentContent가 아직 없는 Template을 처음 열 때
   * 변환용으로만 참조한다. */
  templateSchema: MeetingTemplateSchema;
  /** Step 5B-3.3(Rich Text Editor) — Monday Docs 스타일 문서 본문(Tiptap
   * JSON). null이면 아직 이 Editor로 저장된 적 없는 Template이라는 뜻 —
   * Client가 templateSchema를 변환해서 보여준다. */
  documentContent: JSONContent | null;
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
  documentContent: string | null;
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

  // documentContent는 없을 수 있고(아직 Rich Text Editor로 저장된 적 없는
  // Template), 혹시 손상돼 있어도 이 한 필드만 null 처리한다 — templateSchema
  // 기반 변환으로 여전히 열람/편집할 수 있어야 하므로 Row 전체를 버리지 않는다.
  let documentContent: JSONContent | null = null;
  if (row.documentContent) {
    try {
      documentContent = validateDocumentContent(JSON.parse(row.documentContent));
    } catch {
      documentContent = null;
    }
  }

  return {
    id: row.id,
    name: row.name,
    meetingType: row.meetingType,
    templateSchema: parsed,
    documentContent,
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
 * Template일 뿐, 자동 회의록 생성/초기화 대상이 되지 않는다(요청사항).
 *
 * Step 5B-3.3(Rich Text Editor) — 더 이상 block 배열(templateSchema)을
 * 입력받지 않고 Tiptap 문서(documentContent)를 입력받는다. templateSchema
 * 컬럼은 지우지 않았으므로(요청사항: 기존 Template 데이터 호환) NOT NULL
 * 제약을 만족시키기 위해 "[]"를 그대로 써둔다 — 새로 만드는 Template은 애초에
 * 레거시 block이 있었던 적이 없으므로 정보 손실이 아니다. */
export async function createMeetingTemplateAction(input: {
  name: string;
  meetingType: MeetingTemplateType;
  documentContent: unknown;
}): Promise<{ template?: MeetingTemplateInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdmin(session);
  if (permissionError) return { error: permissionError };

  const name = input.name.trim();
  if (!name) return { error: "Template 이름을 입력해 주세요." };

  const validated = validateDocumentContent(parseDocumentContentInput(input.documentContent));
  if (!validated) return { error: "문서 내용이 올바르지 않습니다." };
  // Step(Template/Preview 분리 검증 + Rich Text 매핑 안정화) — heading의
  // semantic identity(attrs.meetingSection)가 아직 없는 legacy heading에
  // 한해서만, 정규화된 표시 텍스트로 추론해 저장 직전에 채워 넣는다. 이미
  // 있는 attribute는 절대 덮어쓰지 않는다(lib/meetingMinutes/sectionHeadings.ts
  // 참고) — Template 원본을 강제로 일괄 마이그레이션하지 않고 "저장할 때마다
  // 자연스럽게 채워지는" 방식이다(요청사항).
  // Step(파트 주간회의 Table UX + AUTO 필드 개편) — Table 라벨 셀의
  // semantic identity(attrs.fieldKey)도 heading과 같은 정책으로 저장 시
  // 자동 태깅한다(lib/meetingMinutes/fieldSemantics.ts).
  const tagged = attachMissingFieldKeyAttributes(attachMissingMeetingSectionAttributes(validated));

  try {
    const row = await prisma.meetingTemplate.create({
      data: {
        name,
        meetingType: input.meetingType,
        templateSchema: "[]",
        documentContent: JSON.stringify(tagged),
        updatedBy: session.user.id,
      },
      include: { updater: { select: { name: true } } },
    });
    const info = toInfo(row);
    return info ? { template: info } : { error: "Template을 저장했지만 불러오지 못했습니다." };
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return { error: "Template을 저장하지 못했습니다. 같은 이름의 Template이 이미 있는지 확인해 주세요." };
    }
    console.error("[createMeetingTemplateAction] 저장 실패", e);
    return { error: "Template을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** Step 5B-3(Editor) — 이름뿐 아니라 회의 유형도 수정할 수 있다(요청사항:
 * "이름/회의 유형 수정 시 기존 unique 제약 안전 처리"). meetingType을
 * 바꿔도 isActive는 그대로 유지된다 — 활성 전환은 항상
 * setActiveMeetingTemplateAction을 통해서만 일어난다(요청사항: 별도 저장
 * 구조를 만들지 않음). @@unique([meetingType, name]) 위반은 catch에서
 * 일반 사용자용 문구로만 알린다.
 *
 * Step 5B-3.3(Rich Text Editor) — documentContent를 저장한다. 이 Template이
 * 5B-3.2 이전 block으로만 존재하던 것이었어도(templateSchema에 내용 있음)
 * 여기서 한 번이라도 저장하면 그 시점부터는 documentContent가 진짜 내용이
 * 된다 — templateSchema는 "[]"로 남겨 더 이상 참조되지 않게 한다(원본은
 * 저장 전까지 그대로 보존되므로 사용자가 실제로 "저장"을 누르기 전에는
 * 아무것도 깨지지 않는다). */
export async function updateMeetingTemplateAction(
  id: string,
  input: { name: string; meetingType: MeetingTemplateType; documentContent: unknown },
): Promise<{ template?: MeetingTemplateInfo; error?: string }> {
  const session = await requireUser();
  const permissionError = requireAdmin(session);
  if (permissionError) return { error: permissionError };

  const name = input.name.trim();
  if (!name) return { error: "Template 이름을 입력해 주세요." };

  const validated = validateDocumentContent(parseDocumentContentInput(input.documentContent));
  if (!validated) return { error: "문서 내용이 올바르지 않습니다." };
  // createMeetingTemplateAction과 동일한 이유로 저장 직전에만 적용한다.
  // Step(파트 주간회의 Table UX + AUTO 필드 개편) — Table 라벨 셀의
  // semantic identity(attrs.fieldKey)도 heading과 같은 정책으로 저장 시
  // 자동 태깅한다(lib/meetingMinutes/fieldSemantics.ts).
  const tagged = attachMissingFieldKeyAttributes(attachMissingMeetingSectionAttributes(validated));

  try {
    const row = await prisma.meetingTemplate.update({
      where: { id },
      data: {
        name,
        meetingType: input.meetingType,
        templateSchema: "[]",
        documentContent: JSON.stringify(tagged),
        updatedBy: session.user.id,
      },
      include: { updater: { select: { name: true } } },
    });
    const info = toInfo(row);
    return info ? { template: info } : { error: "Template을 수정했지만 불러오지 못했습니다." };
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return { error: "Template을 수정하지 못했습니다. 같은 회의 유형에 같은 이름의 Template이 이미 있는지 확인해 주세요." };
    }
    console.error("[updateMeetingTemplateAction] 수정 실패", e);
    return { error: "Template을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
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
