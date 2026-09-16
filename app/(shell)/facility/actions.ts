"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseCalendarDateInput } from "@/lib/facility/date";
import { metricKindOf, isReservationEligibleGrade } from "@/lib/facility/constants";
import type { EquipmentMetricKind, EquipmentTeamLabel, EquipmentTimeHalf, EquipmentUsagePurpose } from "@/app/generated/prisma/enums";

/**
 * 설비 관리 — 모든 mutation은 이 파일 하나에 모은다(Schedule의 actions.ts와
 * 동일한 관례: read는 page.tsx/lib/facility/queries.ts, write는 여기).
 * 프로토타입(설비 관리.dc.html)의 Component 메서드(act/confirmReserve/
 * confirmUse/cancelReservation/confirmBreak/cancelUse/confirmFixed)를 실제
 * DB 트랜잭션으로 그대로 옮긴 것이다 — 정확한 대응 관계는 각 함수 주석 참고.
 */

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("FORBIDDEN");
  return session;
}

const FACILITY_PATHS = ["/facility/reservation", "/facility/calendar", "/facility/stats"] as const;
function revalidateFacility() {
  for (const path of FACILITY_PATHS) revalidatePath(path);
}

type ActionResult = { ok?: true; error?: string };

function parseDigits(input: string | undefined | null): number {
  if (!input) return 0;
  const digits = input.replace(/[^0-9]/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}

/** 예약 등록 표 "사용자" select onChange — README: "변경 즉시 해당 행 사용자
 * 갱신". 이후 예약을 확정할 때 이 값이 EquipmentReservation에 스냅샷으로
 * 복사된다(그 예약이 "누구 것"이었는지는 나중에 담당자가 바뀌어도 바뀌지
 * 않아야 하므로).
 *
 * Step(Preview 전 정리) — "NONE"(미지정)을 명시적으로 선택할 수 있게
 * 추가했다. 실제 운영에서 담당자를 잘못 지정했거나 재배정 전 잠시
 * 비워둬야 하는 경우가 있는데, 처음 구현에서는 select의 "미지정"이
 * disabled라 한번 지정하면 되돌릴 방법이 없었다(실제 smoke test로 발견) —
 * assignedUserId/assignedTeamLabel을 둘 다 null로 되돌리는 이 분기만
 * 추가하면 되므로 기존 두 분기(USER/TEAM)는 전혀 건드리지 않는다. */
export async function updateEquipmentAssignmentAction(
  equipmentId: string,
  assignee: { kind: "USER"; userId: string } | { kind: "TEAM"; team: EquipmentTeamLabel } | { kind: "NONE" },
): Promise<ActionResult> {
  await requireUser();
  await prisma.equipment.update({
    where: { id: equipmentId },
    data:
      assignee.kind === "USER"
        ? { assignedUserId: assignee.userId, assignedTeamLabel: null }
        : assignee.kind === "TEAM"
          ? { assignedUserId: null, assignedTeamLabel: assignee.team }
          : { assignedUserId: null, assignedTeamLabel: null },
  });
  revalidateFacility();
  return { ok: true };
}

/** 액션 버튼 "시작" — 프로토타입 act()의 status==='예약 완료' 분기. 다이얼로그
 * 없이 즉시 전환된다. */
export async function startUsingEquipmentAction(equipmentId: string): Promise<ActionResult> {
  await requireUser();
  const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!eq) return { error: "설비를 찾을 수 없습니다." };
  if (eq.status !== "RESERVED") return { error: "예약 완료 상태의 설비만 사용을 시작할 수 있습니다." };
  await prisma.equipment.update({ where: { id: equipmentId }, data: { status: "IN_USE" } });
  revalidateFacility();
  return { ok: true };
}

/** 액션 버튼 "종료" — act()의 status==='사용중' 분기. 이번 예약의 이력
 * (EquipmentReservation)은 지우지 않는다 — 이미 실제로 쓴 예약이라 캘린더에
 * 과거 일정으로 남아야 한다(README 실제 동작 기준). 설비의 "현재" 스냅샷만
 * 비운다. */
export async function endUsingEquipmentAction(equipmentId: string): Promise<ActionResult> {
  await requireUser();
  const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!eq) return { error: "설비를 찾을 수 없습니다." };
  if (eq.status !== "IN_USE") return { error: "사용중 상태의 설비만 종료할 수 있습니다." };
  await prisma.equipment.update({ where: { id: equipmentId }, data: { status: "AVAILABLE", currentStart: null, currentEnd: null, currentHalf: null } });
  revalidateFacility();
  return { ok: true };
}

export interface ReservationActionInput {
  equipmentId: string;
  start: string; // "2026.09.09"
  end: string;
  half: EquipmentTimeHalf;
  /** GENERAL_REPEAT 설비 예약에서만 의미 있음. */
  purpose?: EquipmentUsagePurpose;
  /** 아래 3개는 전부 원본 텍스트 입력값(콤마 등 포함 가능) — 서버에서 숫자만 추출한다. */
  cycles?: string;
  hours?: string;
  sampleCount?: string;
  editMode: boolean;
}

/**
 * 다이얼로그 A 확정("예약 등록"/"수정 저장") — confirmReserve()에 대응.
 *
 * 등급 상/중, 수리중이 아닌 설비만 대상이다. 신규(create)는 새
 * EquipmentReservation을 만들고, 수정(edit)은 해당 설비의 "최신" 예약 1건을
 * 찾아 그 자리에서 갱신한다(새 예약을 추가하지 않는다 — README "새 예약을
 * 추가하지 않고 해당 설비의 최신 예약을 갱신").
 *
 * 사용 통계에 반영되는 값(EquipmentUsageLog)은 설비 kind에 따라 다음 3가지
 * 경우에만 만든다(REVIEW: 디자인 레퍼런스 원본 프로토타입은 이 중 REPEAT의
 * cycles·ENVIRONMENT의 hours를 실제로는 어디에도 집계하지 않는 채로 뒀다 —
 * 화면(캘린더 note)에만 쓰고 통계(baseFor 더미 해시)에는 전혀 반영하지
 * 않는 구조였다. README가 "실제 구현에서는 예약/사용 기록 테이블 집계로
 * 대체"라고 명시한 만큼, 그 값이 그 설비 자신의 지표와 단위가 정확히
 * 일치하는 두 경우(REPEAT→사이클 수, ENVIRONMENT→사용 시간)는 실제로
 * 집계되도록 채워 넣었다):
 *   - REPEAT: cycles → CYCLE
 *   - ENVIRONMENT: hours → HOUR
 *   - GENERAL_REPEAT + 목적=ONE_OFF: sampleCount → COUNT (프로토타입에서도
 *     이미 실제로 집계되던 유일한 경로 — 그대로 유지)
 * GENERAL_REPEAT + 목적=CYCLE(반복 싸이클 사용)의 cycles 값은 집계하지
 * 않는다 — 이 설비의 통계 행은 kind 기준으로 항상 "사용 횟수(건)"로 고정
 * 표시되는데(README 사용 통계 표 "지표" 컬럼, 목적에 따라 바뀌지 않음),
 * 사이클 횟수를 그 "건" 단위에 억지로 합산하면 단위가 맞지 않아 오히려
 * 통계를 왜곡한다 — 캘린더 note 표시로만 남긴다(완료 보고 REVIEW 참고).
 */
export async function confirmReservationAction(input: ReservationActionInput): Promise<ActionResult> {
  await requireUser();
  const eq = await prisma.equipment.findUnique({ where: { id: input.equipmentId } });
  if (!eq) return { error: "설비를 찾을 수 없습니다." };
  if (!isReservationEligibleGrade(eq.grade)) return { error: "관리 대상 '상'/'중' 설비만 예약할 수 있습니다." };
  if (eq.status === "UNDER_REPAIR") return { error: "수리중인 설비는 예약할 수 없습니다." };

  const startDate = parseCalendarDateInput(input.start);
  const endDate = parseCalendarDateInput(input.end);
  if (!startDate || !endDate) return { error: "시작일과 마감일을 입력하세요." };

  const cycles = parseDigits(input.cycles) || null;
  const hours = parseDigits(input.hours) || null;
  const isOneOff = eq.kind === "GENERAL_REPEAT" && input.purpose === "ONE_OFF";
  const sampleCount = isOneOff ? parseDigits(input.sampleCount) || null : null;
  const purpose = eq.kind === "GENERAL_REPEAT" ? (input.purpose ?? null) : null;

  let loggableAmount: number | null = null;
  let loggableMetricKind: EquipmentMetricKind | null = null;
  if (eq.kind === "REPEAT" && cycles) {
    loggableAmount = cycles;
    loggableMetricKind = "CYCLE";
  } else if (eq.kind === "ENVIRONMENT" && hours) {
    loggableAmount = hours;
    loggableMetricKind = "HOUR";
  } else if (isOneOff && sampleCount) {
    loggableAmount = sampleCount;
    loggableMetricKind = "COUNT";
  }

  await prisma.$transaction(async (tx) => {
    const nextStatus = eq.status === "IN_USE" ? "IN_USE" : "RESERVED";
    await tx.equipment.update({
      where: { id: input.equipmentId },
      data: { status: nextStatus, currentStart: startDate, currentEnd: endDate, currentHalf: input.half },
    });

    const reservationData = {
      assignedUserId: eq.assignedUserId,
      assignedTeamLabel: eq.assignedTeamLabel,
      startDate,
      endDate,
      half: input.half,
      purpose,
      cycles,
      hours,
      sampleCount,
    };

    let reservationId: string;
    if (input.editMode) {
      const latest = await tx.equipmentReservation.findFirst({ where: { equipmentId: input.equipmentId }, orderBy: { createdAt: "desc" } });
      if (!latest) throw new Error("수정할 예약을 찾을 수 없습니다.");
      const updated = await tx.equipmentReservation.update({ where: { id: latest.id }, data: reservationData });
      reservationId = updated.id;
    } else {
      const created = await tx.equipmentReservation.create({ data: { equipmentId: input.equipmentId, ...reservationData } });
      reservationId = created.id;
    }

    const existingLog = await tx.equipmentUsageLog.findUnique({ where: { reservationId } });
    if (loggableAmount && loggableMetricKind) {
      if (existingLog) {
        await tx.equipmentUsageLog.update({ where: { id: existingLog.id }, data: { amount: loggableAmount, metricKind: loggableMetricKind, recordedAt: startDate } });
      } else {
        await tx.equipmentUsageLog.create({
          data: { equipmentId: input.equipmentId, reservationId, metricKind: loggableMetricKind, amount: loggableAmount, recordedAt: startDate },
        });
      }
    } else if (existingLog) {
      await tx.equipmentUsageLog.delete({ where: { id: existingLog.id } });
    }
  });

  revalidateFacility();
  return { ok: true };
}

/** 다이얼로그 A "예약 취소" — cancelReservation()에 대응. 해당 설비의 최신
 * 예약 1건을 완전히 삭제한다(연결된 EquipmentUsageLog도 cascade로 함께
 * 삭제 — 시료 건수 차감을 별도 계산할 필요가 없다, 실사용되지 않은
 * 예약이라 이력으로 남길 이유가 없다). */
export async function cancelReservationAction(equipmentId: string): Promise<ActionResult> {
  await requireUser();
  const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!eq) return { error: "설비를 찾을 수 없습니다." };
  const latest = await prisma.equipmentReservation.findFirst({ where: { equipmentId }, orderBy: { createdAt: "desc" } });
  if (!latest) return { error: "취소할 예약이 없습니다." };

  await prisma.$transaction(async (tx) => {
    await tx.equipmentReservation.delete({ where: { id: latest.id } });
    await tx.equipment.update({ where: { id: equipmentId }, data: { status: "AVAILABLE", currentStart: null, currentEnd: null, currentHalf: null } });
  });
  revalidateFacility();
  return { ok: true };
}

/**
 * 상태 배지 클릭(수리중이 아닌 설비) → 다이얼로그 D 확정 — confirmBreak()에
 * 대응. 진행 중인 예약을 취소 처리한다.
 *
 * REVIEW: 원본 프로토타입의 confirmBreak()는 설비의 현재 status와 무관하게
 * 항상 "해당 설비의 최신 예약 1건"을 삭제했다 — 그런데 다이얼로그 자체의
 * 안내 문구는 "예약 완료·사용중이면 진행 중인 예약이 취소된다" / "예약
 * 가능이면 그냥 수리중으로 전환한다"로 명확히 분기해서 설명한다. 즉 이미
 * 완료되어 예약 가능 상태로 돌아간 설비를 고장 신고하면, 그 문구가 약속한
 * 대로 아무 예약도 건드리지 않아야 하는데 실제 코드는 "가장 최근 이력"을
 * 잘못 지워버리는 모순이 있었다. 여기서는 다이얼로그 문구가 명시한 의도를
 * 따른다 — status가 RESERVED/IN_USE일 때만 최신 예약을 취소하고, AVAILABLE일
 * 때는 예약 이력에 손대지 않는다. */
export async function reportBreakdownAction(equipmentId: string, reason: string): Promise<ActionResult> {
  await requireUser();
  const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!eq) return { error: "설비를 찾을 수 없습니다." };
  if (eq.status === "UNDER_REPAIR") return { error: "이미 수리중인 설비입니다." };

  await prisma.$transaction(async (tx) => {
    if (eq.status === "RESERVED" || eq.status === "IN_USE") {
      const latest = await tx.equipmentReservation.findFirst({ where: { equipmentId }, orderBy: { createdAt: "desc" } });
      if (latest) await tx.equipmentReservation.delete({ where: { id: latest.id } });
    }
    await tx.equipment.update({
      where: { id: equipmentId },
      data: { status: "UNDER_REPAIR", currentStart: null, currentEnd: null, currentHalf: null, currentFaultNote: reason.trim() || null },
    });
  });
  revalidateFacility();
  return { ok: true };
}

/** 상태 배지 클릭(수리중인 설비) → 다이얼로그 C 확정, 또는 다이얼로그 C
 * 자체의 CTA — confirmFixed()에 대응. */
export async function completeRepairAction(equipmentId: string): Promise<ActionResult> {
  await requireUser();
  const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!eq) return { error: "설비를 찾을 수 없습니다." };
  if (eq.status !== "UNDER_REPAIR") return { error: "수리중 상태의 설비만 처리할 수 있습니다." };
  await prisma.equipment.update({ where: { id: equipmentId }, data: { status: "AVAILABLE", currentFaultNote: null } });
  revalidateFacility();
  return { ok: true };
}

/**
 * 다이얼로그 B 확정(등급 '하' 설비 "건수 등록"/"수정 저장") — confirmUse()에
 * 대응. 신규 등록은 새 EquipmentUsageLog를 만들고(월별 실 이력 누적),
 * 수정은 가장 최근 수동 등록 1건의 값을 그대로 덮어쓴다(프로토타입의
 * "재입력으로 중복 누적되지 않게" 정책을 그대로 따른다 — REVIEW: 등급 '하'
 * 설비는 프로토타입 자체가 "월별 이력"이 아니라 "평생 누적값 1개"라는
 * 단순한 모델이라, 실제 월별 집계 테이블로 옮기면서 "수정은 가장 최근 항목
 * 갱신, 신규 등록은 새 항목 추가"로 매핑했다 — 상세 근거는 완료 보고
 * 참고). */
export async function confirmSampleUsageAction(equipmentId: string, sampleCountInput: string, editMode: boolean): Promise<ActionResult> {
  await requireUser();
  const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!eq) return { error: "설비를 찾을 수 없습니다." };
  if (eq.grade !== "LOW") return { error: "관리 대상 '하' 설비만 이 방식으로 등록할 수 있습니다." };
  const sampleCount = parseDigits(sampleCountInput);
  if (!sampleCount) return { error: "시료 수량을 입력하세요." };

  const metricKind = metricKindOf(eq.kind);
  const now = new Date();
  const recordedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (editMode) {
    const latest = await prisma.equipmentUsageLog.findFirst({ where: { equipmentId, reservationId: null }, orderBy: { createdAt: "desc" } });
    if (!latest) return { error: "수정할 등록 내역을 찾을 수 없습니다." };
    await prisma.equipmentUsageLog.update({ where: { id: latest.id }, data: { amount: sampleCount, metricKind } });
  } else {
    await prisma.equipmentUsageLog.create({ data: { equipmentId, metricKind, amount: sampleCount, recordedAt } });
  }
  revalidateFacility();
  return { ok: true };
}

/** 다이얼로그 B "집계 취소" — cancelUse()에 대응. */
export async function cancelSampleUsageAction(equipmentId: string): Promise<ActionResult> {
  await requireUser();
  const latest = await prisma.equipmentUsageLog.findFirst({ where: { equipmentId, reservationId: null }, orderBy: { createdAt: "desc" } });
  if (!latest) return { error: "취소할 등록 내역이 없습니다." };
  await prisma.equipmentUsageLog.delete({ where: { id: latest.id } });
  revalidateFacility();
  return { ok: true };
}
