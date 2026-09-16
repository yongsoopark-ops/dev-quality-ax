import { describe, expect, it } from "vitest";
import {
  metricKindOf,
  isReservationEligibleGrade,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_GRADE_LABEL,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_LOCATION_LABEL,
  EQUIPMENT_TIME_HALF_LABEL,
  EQUIPMENT_TEAM_LABEL,
  EQUIPMENT_USAGE_PURPOSE_LABEL,
  EQUIPMENT_METRIC_LABEL,
  EQUIPMENT_METRIC_UNIT,
  EQUIPMENT_GRADE_TAG,
  EQUIPMENT_STATUS_TAG,
  EQUIPMENT_ACTION_TAG,
  EQUIPMENT_EVENT_COLOR,
  EQUIPMENT_GRADE_SORT_ORDER,
  FACILITY_LANE_THEME_BY_NAME,
  FACILITY_PART_MEMBER_NAMES,
} from "./constants";
import { EquipmentGrade, EquipmentKind, EquipmentStatus } from "@/app/generated/prisma/enums";

/**
 * 설비 관리 — 순수 상수/판정 함수 테스트(DB 의존 없음). 디자인
 * 레퍼런스(README "파생 규칙"/"핵심 규칙")가 명시한 매핑을 그대로
 * 검증한다.
 */

describe("metricKindOf — README 파생 규칙: 환경 → 사용 시간 · 반복 → 사이클 수 · 그 외 → 사용 횟수", () => {
  it("ENVIRONMENT → HOUR", () => expect(metricKindOf("ENVIRONMENT")).toBe("HOUR"));
  it("REPEAT → CYCLE", () => expect(metricKindOf("REPEAT")).toBe("CYCLE"));
  it("GENERAL → COUNT", () => expect(metricKindOf("GENERAL")).toBe("COUNT"));
  it("GENERAL_REPEAT → COUNT(목적과 무관하게 이 설비 자신의 통계 지표는 항상 사용 횟수)", () => expect(metricKindOf("GENERAL_REPEAT")).toBe("COUNT"));
});

describe("isReservationEligibleGrade — README 핵심 규칙: 상/중만 예약(캘린더) 대상", () => {
  it("HIGH/MID는 예약 대상이다", () => {
    expect(isReservationEligibleGrade("HIGH")).toBe(true);
    expect(isReservationEligibleGrade("MID")).toBe(true);
  });
  it("LOW는 예약 대상이 아니다(시료 수량 집계 전용)", () => {
    expect(isReservationEligibleGrade("LOW")).toBe(false);
  });
});

/** enum의 모든 값이 라벨/색상 맵에 빠짐없이 있는지 — 향후 enum에 값이
 * 추가됐는데 맵을 갱신하지 않으면 런타임에 undefined가 나오는 사고를
 * 컴파일 타임이 아니라 최소한 테스트 타임에는 잡는다. */
function keysOf<T extends string>(map: Record<T, unknown>): T[] {
  return Object.keys(map) as T[];
}

describe("라벨/색상 맵 완결성", () => {
  const KIND_VALUES: EquipmentKind[] = ["GENERAL", "REPEAT", "ENVIRONMENT", "GENERAL_REPEAT"];
  const GRADE_VALUES: EquipmentGrade[] = ["HIGH", "MID", "LOW"];
  const STATUS_VALUES: EquipmentStatus[] = ["AVAILABLE", "RESERVED", "IN_USE", "UNDER_REPAIR"];

  it("EQUIPMENT_KIND_LABEL은 4개 kind를 전부 포함한다", () => {
    expect(keysOf(EQUIPMENT_KIND_LABEL).sort()).toEqual([...KIND_VALUES].sort());
  });
  it("EQUIPMENT_GRADE_LABEL/TAG는 3개 grade를 전부 포함한다", () => {
    expect(keysOf(EQUIPMENT_GRADE_LABEL).sort()).toEqual([...GRADE_VALUES].sort());
    expect(keysOf(EQUIPMENT_GRADE_TAG).sort()).toEqual([...GRADE_VALUES].sort());
  });
  it("EQUIPMENT_STATUS_LABEL/TAG/EVENT_COLOR는 4개 status를 전부 포함한다", () => {
    expect(keysOf(EQUIPMENT_STATUS_LABEL).sort()).toEqual([...STATUS_VALUES].sort());
    expect(keysOf(EQUIPMENT_STATUS_TAG).sort()).toEqual([...STATUS_VALUES].sort());
    expect(keysOf(EQUIPMENT_EVENT_COLOR).sort()).toEqual([...STATUS_VALUES].sort());
  });
  it("EQUIPMENT_METRIC_LABEL/UNIT은 3개 metricKind(COUNT/CYCLE/HOUR)를 전부 포함한다", () => {
    expect(keysOf(EQUIPMENT_METRIC_LABEL).sort()).toEqual(["COUNT", "CYCLE", "HOUR"]);
    expect(keysOf(EQUIPMENT_METRIC_UNIT).sort()).toEqual(["COUNT", "CYCLE", "HOUR"]);
  });
  it("EQUIPMENT_ACTION_TAG는 README의 5개 액션 라벨을 전부 포함한다", () => {
    expect(keysOf(EQUIPMENT_ACTION_TAG).sort()).toEqual(["사용", "시작", "예약", "예약 불가", "종료"].sort());
  });
  it("EQUIPMENT_LOCATION_LABEL/TIME_HALF_LABEL/TEAM_LABEL/USAGE_PURPOSE_LABEL 완결성", () => {
    expect(keysOf(EQUIPMENT_LOCATION_LABEL).sort()).toEqual(["HYANGDONG", "NURIKKUM"]);
    expect(keysOf(EQUIPMENT_TIME_HALF_LABEL).sort()).toEqual(["AM", "PM"]);
    expect(keysOf(EQUIPMENT_TEAM_LABEL).sort()).toEqual(["TEAM_1", "TEAM_2"]);
    expect(keysOf(EQUIPMENT_USAGE_PURPOSE_LABEL).sort()).toEqual(["CYCLE", "ONE_OFF"]);
  });
  it("FACILITY_LANE_THEME_BY_NAME은 파트원 4명 이름을 전부 포함한다(README 캘린더 레인 표)", () => {
    expect(Object.keys(FACILITY_LANE_THEME_BY_NAME).sort()).toEqual([...FACILITY_PART_MEMBER_NAMES].sort());
  });
});

describe("정확한 hex 값 — README \"Fidelity: High-fidelity\" 확정 값 재검증", () => {
  it("상태 배지 색", () => {
    expect(EQUIPMENT_STATUS_TAG.AVAILABLE).toEqual({ bg: "#dcfce7", text: "#166534" });
    expect(EQUIPMENT_STATUS_TAG.RESERVED).toEqual({ bg: "#1d4ed8", text: "#ffffff" });
    expect(EQUIPMENT_STATUS_TAG.IN_USE).toEqual({ bg: "#fed7aa", text: "#9a3412" });
    expect(EQUIPMENT_STATUS_TAG.UNDER_REPAIR).toEqual({ bg: "#b91c1c", text: "#ffffff" });
  });
  it("관리 대상 배지 색", () => {
    expect(EQUIPMENT_GRADE_TAG.HIGH).toEqual({ bg: "#1d4ed8", text: "#ffffff" });
    expect(EQUIPMENT_GRADE_TAG.MID).toEqual({ bg: "#e9d5ff", text: "#6b21a8" });
    expect(EQUIPMENT_GRADE_TAG.LOW).toEqual({ bg: "#dcfce7", text: "#166534" });
  });
  it("일정 막대 색은 설비 현재 상태를 따른다", () => {
    expect(EQUIPMENT_EVENT_COLOR.UNDER_REPAIR).toEqual({ bg: "#fef2f2", bar: "#dc2626", ink: "#991b1b" });
  });
});

/**
 * 설비 목록 정렬(관리대상 등급 정렬 개선) — EQUIPMENT_GRADE_SORT_ORDER 값
 * 자체와, lib/facility/queries.ts의 getEquipmentRows가 실제로 쓰는 것과
 * 동일한 패턴(관리번호 오름차순으로 이미 정렬된 배열을 이 순위표로 안정
 * 정렬)을 순수 함수 수준에서 재현해 검증한다. Prisma 의존이 없는 순수
 * 정렬 로직만 떼어내 테스트하므로 DB 없이 실행 가능하다.
 */
describe("EQUIPMENT_GRADE_SORT_ORDER — 관리대상 등급 정렬(상 → 중 → 하)", () => {
  it("HIGH=0, MID=1, LOW=2 — 문자열 alphabetic 순서(HIGH<LOW<MID)가 아니라 이 명시적 순위를 쓴다", () => {
    expect(EQUIPMENT_GRADE_SORT_ORDER.HIGH).toBe(0);
    expect(EQUIPMENT_GRADE_SORT_ORDER.MID).toBe(1);
    expect(EQUIPMENT_GRADE_SORT_ORDER.LOW).toBe(2);
  });

  it("getEquipmentRows와 동일한 방식(관리번호 오름차순 → grade 안정 정렬)으로 정렬하면 상→중→하, 각 등급 내 관리번호 오름차순이 나온다", () => {
    // 일부러 등급이 뒤섞이고 관리번호도 뒤섞인 입력 — DB가 실제로 반환하는
    // "관리번호 오름차순"을 흉내내기 위해 먼저 id로 정렬한 뒤(queries.ts와
    // 동일), grade로 안정 정렬한다.
    const input = [
      { id: "QA-TEQ-003", grade: "HIGH" as const },
      { id: "QA-TEQ-010", grade: "LOW" as const },
      { id: "QA-TEQ-001", grade: "HIGH" as const },
      { id: "QA-TEQ-005", grade: "MID" as const },
      { id: "QA-TEQ-002", grade: "HIGH" as const },
      { id: "QA-TEQ-004", grade: "MID" as const },
      { id: "QA-TEQ-009", grade: "LOW" as const },
    ];
    const sortedById = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    sortedById.sort((a, b) => EQUIPMENT_GRADE_SORT_ORDER[a.grade] - EQUIPMENT_GRADE_SORT_ORDER[b.grade]);

    expect(sortedById.map((r) => r.id)).toEqual([
      "QA-TEQ-001", // HIGH
      "QA-TEQ-002", // HIGH
      "QA-TEQ-003", // HIGH
      "QA-TEQ-004", // MID
      "QA-TEQ-005", // MID
      "QA-TEQ-009", // LOW
      "QA-TEQ-010", // LOW
    ]);
  });

  it("검색/구분 Filter처럼 배열 순서를 보존하는 filter()를 거쳐도 정렬이 그대로 유지된다", () => {
    const sorted = [
      { id: "QA-TEQ-001", grade: "HIGH" as const, kind: "REPEAT" as const },
      { id: "QA-TEQ-004", grade: "MID" as const, kind: "REPEAT" as const },
      { id: "QA-TEQ-002", grade: "HIGH" as const, kind: "GENERAL" as const },
      { id: "QA-TEQ-009", grade: "LOW" as const, kind: "REPEAT" as const },
    ];
    const filtered = sorted.filter((r) => r.kind === "REPEAT");
    expect(filtered.map((r) => r.id)).toEqual(["QA-TEQ-001", "QA-TEQ-004", "QA-TEQ-009"]);
  });
});
