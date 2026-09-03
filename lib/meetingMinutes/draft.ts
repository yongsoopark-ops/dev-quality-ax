"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getActiveMeetingTemplateAction } from "@/lib/meetingTemplates/actions";
import { MEETING_TEMPLATE_TYPE_LABELS } from "@/lib/meetingTemplates/constants";
import { parseDocumentContentInput, validateDocumentContent } from "@/lib/meetingTemplates/richText";
import type { MeetingTemplateType } from "@/app/generated/prisma/enums";
import type { JSONContent } from "@tiptap/core";

/**
 * Step(회의록 Workspace 회의유형 공통화) — 회의 유형마다 "회의록 작성본을
 * 어떻게 만드는지"가 다르다. 이 차이를 app/(shell)/meeting-minutes의
 * page.tsx나 Client Component에 if문으로 흩어놓지 않고, 이 파일의 Builder
 * map 하나로 모은다.
 *
 * Step(회의록 Draft 저장/초기화 정책 + 담당자별 그룹핑) — "화면 진입/
 * 새로고침 시 항상 Template을 다시 clone"하던 이전 동작을 바꾼다
 * (요청사항: "새로고침으로 작성내용이 초기화되지 않게"). MeetingMinutesDraft
 * 테이블에 meetingType당 정확히 1개의 Row(팀 공용 단일 작성본)를 두고:
 *
 *   - 화면 진입/새로고침: 저장된 Draft Row가 있으면 그대로 반환한다(Template을
 *     다시 조회/clone하지 않는다). 없으면(이 meetingType으로 한 번도 저장된
 *     적 없음) 활성 Template을 clone해 그 결과를 Draft Row로 "최초 저장"한
 *     뒤 반환한다 — 그래야 다음 새로고침부터 곧바로 저장된 Draft를 쓴다.
 *   - 자동저장(saveMeetingMinutesDraftAction): 편집 중 debounce된 변경사항을
 *     그대로 Draft Row에 덮어쓴다. Template Row는 절대 건드리지 않는다.
 *   - 초기화(resetMeetingMinutesDraftAction): 활성 Template을 다시 clone해
 *     Draft Row를 덮어쓴다 — "초기화 후 화면은 활성 Template만 적용된 빈
 *     회의록"(요청사항)이 되는 유일한 경로다.
 *
 * `일정 불러오기`는 여전히 별도 사용자 Trigger다(lib/meetingMinutes/actions.ts
 * loadWeeklyScheduleIntoDraftAction) — 이 파일은 그 결과를 Draft Row에
 * 자동저장하지 않는다. 저장은 항상 Client의 자동저장 debounce가 "지금
 * 화면에 있는 문서"를 명시적으로 넘길 때만 일어난다(요청사항: 세 동작 —
 * 새로고침/초기화/일정 불러오기 — 을 완전히 분리).
 *
 * Step(Draft/Template 버전 비교 + 양식 변경 안내) — 실제로 재현/확인한 문제:
 * 위 "Template을 고쳐도 Draft는 절대 자동으로 안 바뀐다" 정책 그대로 동작한
 * 것이었다(DB 확인 결과 — 완료 보고 참고) — 버그가 아니라 "Template이
 * 바뀌었다는 사실을 사용자에게 전혀 알려주지 않은 것"이 진짜 문제였다.
 * 그래서 자동 반영(요청사항이 명시적으로 금지)이 아니라 "안내 + 사용자가
 * 직접 초기화" 흐름을 추가한다. Draft가 어느 Template 버전을 기준으로
 * 만들어졌는지(sourceTemplateId/sourceTemplateUpdatedAt, prisma/schema.prisma
 * MeetingMinutesDraft 모델 주석 참고)를 저장해 두고, 조회 시 지금 활성
 * Template과 비교해서만 판별한다 — 화면 텍스트 비교가 아니라 DB 값 비교다.
 */

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("FORBIDDEN");
  return session;
}

/** Workspace(Client)가 회의 유형과 무관하게 공통으로 다루는 작성본 모양. */
export interface MeetingMinutesDraft {
  meetingType: MeetingTemplateType;
  templateName: string | null;
  /** 저장된 Draft(또는 방금 Template에서 clone한 결과)를 deep clone한 결과 —
   * 이 객체를 고쳐도 Template 원본은 절대 바뀌지 않는다. templateMissing이
   * true면 항상 null. */
  document: JSONContent | null;
  /** true면 이 유형에 활성 Template이 아예 없다 — "사용 중인 양식이
   * 없습니다" 안내만 보여주고 문서를 임의로 만들지 않는다(요청사항). */
  templateMissing: boolean;
  /** true면 지금 활성 Template이 이 Draft가 만들어진(또는 마지막으로
   * 초기화된) 시점보다 이후에 바뀌었다 — Client가 "양식이 변경되었습니다"
   * 안내를 보여주는 유일한 근거다. Draft 내용 자체는 이 값과 무관하게
   * 절대 자동으로 바뀌지 않는다(요청사항: "자동 덮어쓰기 금지"). */
  templateOutdated: boolean;
  /** Step(V1 코드 건강도 / 안정화 점검) — 낙관적 동시성 제어 기준값. Client는
   * 이 값을 그대로 들고 있다가 다음 저장/초기화 요청에 baseVersion으로
   * 실어 보낸다. 서버는 "지금 DB의 version과 baseVersion이 같을 때만" 저장을
   * 반영한다 — 다른 사용자가 그 사이에 먼저 저장했다면(version이 이미
   * 올라갔다면) 조용히 덮어쓰지 않고 충돌로 처리한다(saveMeetingMinutesDraftAction
   * 참고). 실시간 공동 편집이 아니라 "마지막에 저장을 시도한 쪽이 무조건
   * 이기는" 사고를 막는 최소한의 안전장치다. */
  version: number;
}

interface ActiveTemplateVersion {
  id: string;
  updatedAt: string;
  name: string;
}

async function getActiveTemplateVersion(meetingType: MeetingTemplateType): Promise<{ version?: ActiveTemplateVersion | null; error?: string }> {
  const templateRes = await getActiveMeetingTemplateAction(meetingType);
  if (templateRes.error) return { error: templateRes.error };
  if (!templateRes.template) return { version: null };
  return { version: { id: templateRes.template.id, updatedAt: templateRes.template.updatedAt, name: templateRes.template.name } };
}

/** DB 값만으로 판별한다(요청사항: "단순 화면 텍스트 비교 금지") — Draft가
 * 기록해 둔 sourceTemplateId/sourceTemplateUpdatedAt과 지금 활성 Template의
 * id/updatedAt을 비교한다. 마이그레이션 이전에 만들어진 Row는 두 값이
 * null인데, "기준을 알 수 없음"을 "최신인지 확인 불가"로 보고 안내를
 * 보여주는 쪽(더 안전한 기본값)으로 처리한다. Template이 아예 없어졌으면
 * (activeVersion null) 비교할 대상이 없으므로 false. */
function isTemplateOutdated(draft: { sourceTemplateId: string | null; sourceTemplateUpdatedAt: Date | null }, activeVersion: ActiveTemplateVersion | null): boolean {
  if (!activeVersion) return false;
  if (!draft.sourceTemplateId || !draft.sourceTemplateUpdatedAt) return true;
  if (draft.sourceTemplateId !== activeVersion.id) return true;
  return draft.sourceTemplateUpdatedAt.getTime() < new Date(activeVersion.updatedAt).getTime();
}

/** 활성 Template을 clone해 "빈 회의록" 문서를 만든다 — 초기화와 최초 진입
 * (아직 저장된 Draft가 없을 때) 양쪽에서 공유하는 로직이다. Template DB는
 * 절대 수정하지 않는다(deep clone만). */
async function cloneFromActiveTemplate(
  meetingType: MeetingTemplateType,
): Promise<{ document?: JSONContent; templateId?: string; templateUpdatedAt?: string; templateName?: string; templateMissing?: boolean; error?: string }> {
  const templateRes = await getActiveMeetingTemplateAction(meetingType);
  if (templateRes.error) return { error: templateRes.error };

  if (!templateRes.template) {
    return { templateMissing: true };
  }
  if (!templateRes.template.documentContent) {
    return {
      error: `활성 ${MEETING_TEMPLATE_TYPE_LABELS[meetingType]} Template에 아직 문서 내용이 없습니다. 양식 설정에서 Rich Text Editor로 먼저 저장해 주세요.`,
    };
  }

  const document: JSONContent = JSON.parse(JSON.stringify(templateRes.template.documentContent));
  return {
    document,
    templateId: templateRes.template.id,
    templateUpdatedAt: templateRes.template.updatedAt,
    templateName: templateRes.template.name,
    templateMissing: false,
  };
}

/** 이번 Step 대상 3종만 등록한다. EXECUTIVE_WEEKLY_REPORT는 의도적으로
 * 빼둔다(요청사항: 후순위) — Workspace UI도 이 유형을 선택 불가로 비활성화
 * 하므로 정상 경로로는 호출되지 않지만, 혹시 호출돼도 아래
 * getMeetingMinutesDraftAction이 "아직 지원하지 않는 회의 유형입니다"로
 * 안전하게 처리한다. */
const SUPPORTED_TYPES: readonly MeetingTemplateType[] = ["PART_WEEKLY_MEETING", "KICK_OFF", "GATE_REVIEW"];

/** app/(shell)/meeting-minutes가 초기 진입 시(Server Component)와 회의 유형을
 * 바꿀 때(Client → Server Action 직접 호출) 공통으로 쓰는 단일 진입점.
 * 저장된 Draft가 있으면 그것을(내용은 절대 건드리지 않고, activeTemplate과
 * 비교해 templateOutdated만 계산), 없으면 Template을 clone해 최초 저장한 뒤
 * 그것을 반환한다(요청사항: "새로고침 → 저장된 Draft 재로드"). */
export async function getMeetingMinutesDraftAction(meetingType: MeetingTemplateType): Promise<{ draft?: MeetingMinutesDraft; error?: string }> {
  const session = await requireUser();
  if (!SUPPORTED_TYPES.includes(meetingType)) return { error: "아직 지원하지 않는 회의 유형입니다." };

  const existing = await prisma.meetingMinutesDraft.findUnique({ where: { meetingType } });
  if (existing) {
    // Template 이름/버전은 "지금 활성 Template이 무엇인지, 그리고 이
    // Draft보다 최신인지" 안내용으로만 쓴다 — Draft 내용 자체는 절대 건드리지
    // 않는다(요청사항: "Template 변경 시 기존 Draft 자동 덮어쓰기 금지").
    const { version: activeVersion, error } = await getActiveTemplateVersion(meetingType);
    if (error) return { error };
    return {
      draft: {
        meetingType,
        templateName: activeVersion?.name ?? null,
        document: JSON.parse(existing.documentContent) as JSONContent,
        templateMissing: false,
        templateOutdated: isTemplateOutdated(existing, activeVersion ?? null),
        version: existing.version,
      },
    };
  }

  // 이 meetingType으로 한 번도 저장된 적 없다 — Template을 clone해 "최초
  // Draft"로 저장한다.
  const cloned = await cloneFromActiveTemplate(meetingType);
  if (cloned.error) return { error: cloned.error };
  if (cloned.templateMissing || !cloned.document) {
    return { draft: { meetingType, templateName: null, document: null, templateMissing: true, templateOutdated: false, version: 0 } };
  }

  const createData = {
    meetingType,
    documentContent: JSON.stringify(cloned.document),
    sourceTemplateId: cloned.templateId,
    sourceTemplateUpdatedAt: cloned.templateUpdatedAt ? new Date(cloned.templateUpdatedAt) : null,
    updatedBy: session.user.id,
  };

  try {
    const created = await prisma.meetingMinutesDraft.create({ data: createData });
    return {
      draft: {
        meetingType,
        templateName: cloned.templateName ?? null,
        document: cloned.document,
        templateMissing: false,
        templateOutdated: false,
        version: created.version,
      },
    };
  } catch {
    // 동시에 두 요청이 "아직 없다"를 보고 동시에 create를 시도하면(@unique
    // 위반) 둘 중 하나만 성공한다 — 실패한 쪽은 에러로 처리하지 않고, 이미
    // 만들어진 Row를 그대로 다시 읽어 반환한다(사용자에게는 어차피 같은
    // 결과 — 방금 Template을 clone한 빈 회의록).
    const race = await prisma.meetingMinutesDraft.findUnique({ where: { meetingType } });
    if (race) {
      return {
        draft: {
          meetingType,
          templateName: cloned.templateName ?? null,
          document: JSON.parse(race.documentContent) as JSONContent,
          templateMissing: false,
          templateOutdated: false, // 방금 만들어진 Row이므로 이 시점엔 항상 최신
          version: race.version,
        },
      };
    }
    return { error: "회의록을 초기 생성하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** 자동저장 — Client가 debounce된 변경사항을 그대로 넘긴다. Server Action
 * 인자 직렬화 문제를 피하려고 문자열로 받는다(다른 회의록 Server Action과
 * 동일한 우회, lib/meetingMinutes/actions.ts documentJson 주석 참고). 자동
 * 저장은 sourceTemplateId/sourceTemplateUpdatedAt을 절대 건드리지 않는다 —
 * "이 Draft가 어느 Template 버전을 기준으로 만들어졌는지"는 초기 생성/
 * 초기화 시점에만 정해진다.
 *
 * Step(V1 코드 건강도 / 안정화 점검) — "다중 사용자 last-write-wins" 위험
 * (여러 사용자가 같은 team-common Draft를 동시에 편집하면 서로 덮어씀,
 * 그리고 reset 직전 pending autosave가 방금 초기화한 내용을 다시 덮어쓸
 * 가능성)에 대한 최소 안전장치 — baseVersion(Client가 마지막으로 읽은
 * version)이 지금 DB의 version과 같을 때만 저장을 반영하고 version을 1
 * 올린다. 일치하지 않으면(그 사이 다른 저장/초기화가 먼저 반영됨) 조용히
 * 덮어쓰지 않고 conflict:true로 알린다 — 실시간 병합은 구현하지 않는다
 * (요청사항 범위 밖), 사고를 막는 것이 목적이다. */
export async function saveMeetingMinutesDraftAction(
  meetingType: MeetingTemplateType,
  documentContent: unknown,
  baseVersion: number,
): Promise<{ savedAt?: string; version?: number; conflict?: true; error?: string }> {
  const session = await requireUser();
  if (!SUPPORTED_TYPES.includes(meetingType)) return { error: "아직 지원하지 않는 회의 유형입니다." };

  const validated = validateDocumentContent(parseDocumentContentInput(documentContent));
  if (!validated) return { error: "저장할 회의록 문서 내용이 올바르지 않습니다." };

  const updateResult = await prisma.meetingMinutesDraft.updateMany({
    where: { meetingType, version: baseVersion },
    data: { documentContent: JSON.stringify(validated), updatedBy: session.user.id, version: { increment: 1 } },
  });

  if (updateResult.count === 1) {
    const updated = await prisma.meetingMinutesDraft.findUniqueOrThrow({ where: { meetingType } });
    return { savedAt: updated.updatedAt.toISOString(), version: updated.version };
  }

  // 조건에 맞는 Row가 없다 — 이 meetingType Draft가 아직 없거나(정상 경로로는
  // 거의 없다 — Workspace는 항상 먼저 getMeetingMinutesDraftAction으로 Row를
  // 만든다), 다른 사용자/reset이 그 사이 먼저 저장해 version이 이미 올라간
  // 상태(진짜 충돌)다. 두 경우를 구분해서 처리한다.
  const current = await prisma.meetingMinutesDraft.findUnique({ where: { meetingType } });
  if (!current) {
    const created = await prisma.meetingMinutesDraft.create({
      data: { meetingType, documentContent: JSON.stringify(validated), updatedBy: session.user.id },
    });
    return { savedAt: created.updatedAt.toISOString(), version: created.version };
  }
  return { conflict: true, version: current.version };
}

/** 초기화 — 활성 Template을 다시 clone해 Draft Row를 덮어쓴다(요청사항:
 * "현재 최신 활성 Template.documentContent를 다시 clone, Schedule AUTO
 * 데이터는 넣지 않음 — 이후 사용자가 일정 불러오기로 다시 생성"). 이
 * clone 시점의 Template id/updatedAt을 sourceTemplateId/
 * sourceTemplateUpdatedAt으로 함께 저장한다 — 그래야 이 초기화 이후에는
 * 다시 최신 상태로 판별된다(templateOutdated: false). Template DB 원본은
 * 조회(clone)만 하고 전혀 수정하지 않는다.
 *
 * Step(V1 코드 건강도 / 안정화 점검) — 초기화는 사용자가 방금 명시적으로
 * 누른 동작이라 baseVersion 없이 항상 반영하지만(버전 충돌로 막지 않는다),
 * version은 반드시 올린다 — 그래야 "초기화 직전에 이미 예약돼 있던 pending
 * autosave"가 나중에 도착해도(옛 baseVersion을 들고 있으므로)
 * saveMeetingMinutesDraftAction의 버전 검사에 걸려 방금 초기화한 내용을
 * 덮어쓰지 못한다. */
export async function resetMeetingMinutesDraftAction(meetingType: MeetingTemplateType): Promise<{ draft?: MeetingMinutesDraft; error?: string }> {
  const session = await requireUser();
  if (!SUPPORTED_TYPES.includes(meetingType)) return { error: "아직 지원하지 않는 회의 유형입니다." };

  const cloned = await cloneFromActiveTemplate(meetingType);
  if (cloned.error) return { error: cloned.error };
  if (cloned.templateMissing || !cloned.document) {
    return { draft: { meetingType, templateName: null, document: null, templateMissing: true, templateOutdated: false, version: 0 } };
  }

  const data = {
    meetingType,
    documentContent: JSON.stringify(cloned.document),
    sourceTemplateId: cloned.templateId,
    sourceTemplateUpdatedAt: cloned.templateUpdatedAt ? new Date(cloned.templateUpdatedAt) : null,
    updatedBy: session.user.id,
  };

  const saved = await prisma.meetingMinutesDraft.upsert({
    where: { meetingType },
    create: { ...data, version: 0 },
    update: { ...data, version: { increment: 1 } },
  });

  return {
    draft: {
      meetingType,
      templateName: cloned.templateName ?? null,
      document: cloned.document,
      templateMissing: false,
      templateOutdated: false,
      version: saved.version,
    },
  };
}
