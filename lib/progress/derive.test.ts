import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentStageIndex,
  currentStageText,
  effectiveRounds,
  isCommonTaskDone,
  isRepeatDueDayPassed,
  isSubProjectDone,
  pw8ReviewBadge,
  releaseDday,
  sampleDday,
  subProjectItemSpan,
} from "./derive";

/**
 * 진행 현황 — 순수 파생값 테스트(DB 의존 없음). "오늘"을 쓰는 함수가
 * 많아(D-day류) 시스템 시각을 고정해 재현 가능하게 만든다 — KST 기준
 * 2026-09-16이 되도록 UTC 02:00으로 고정한다(lib/kst.ts의 toKstParts는
 * UTC+9만 더하므로).
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T02:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("currentStageIndex / currentStageText — ZIP curStage: run 중 최댓값", () => {
  it("run이 없으면 -1/미착수", () => {
    expect(currentStageIndex([])).toBe(-1);
    expect(currentStageText([])).toBe("미착수");
  });
  it("run이 여러 개면 최댓값이 현재 단계", () => {
    expect(currentStageIndex([0, 1, 3])).toBe(3);
    expect(currentStageText([0, 1, 3])).toBe("PW4 개선 효력 검증");
  });
});

describe("effectiveRounds — 현재 단계가 PW4(index 3)일 때만 노출(ZIP effRounds)", () => {
  it("PW4가 현재 단계면 저장값과 1 중 큰 값", () => {
    expect(effectiveRounds([0, 1, 2, 3], 0)).toBe(1);
    expect(effectiveRounds([0, 1, 2, 3], 2)).toBe(2);
  });
  it("PW4가 아니면 저장값과 무관하게 0", () => {
    expect(effectiveRounds([0, 1, 2, 3, 4], 3)).toBe(0);
  });
});

describe("releaseDday — ZIP §6", () => {
  it("목표/실제 둘 다 없으면 미정", () => {
    expect(releaseDday("", "")).toEqual({ text: "출시일 미정", tone: "none", tooltip: "목표/실제 출시일이 아직 등록되지 않았습니다" });
  });
  it("목표만 있고 남았으면 D-n/ok 또는 soon", () => {
    const r = releaseDday("2026-10-16", "");
    expect(r.text).toBe("D-30");
    expect(r.tone).toBe("soon");
  });
  it("목표만 있고 지났으면 D+n/late", () => {
    const r = releaseDday("2026-09-10", "");
    expect(r.text).toBe("D+6");
    expect(r.tone).toBe("late");
  });
  it("목표 당일이면 D-DAY/late", () => {
    const r = releaseDday("2026-09-16", "");
    expect(r.text).toBe("D-DAY");
    expect(r.tone).toBe("late");
  });
  it("실제 출시가 있으면 D+경과일, 목표 대비 지연/단축 문구", () => {
    const r = releaseDday("2026-09-10", "2026-09-16");
    expect(r.text).toBe("출시 D+0");
    expect(r.tooltip).toContain("목표 대비 6일 지연");
  });
});

describe("pw8ReviewBadge — 실제 출시 + 3개월(ZIP §2)", () => {
  it("실제 출시가 없으면 null", () => expect(pw8ReviewBadge("")).toBeNull());
  it("실제 출시 + 3개월 날짜를 계산한다(핸드오프 §4.5: 잔여 일수 포함)", () => {
    const badge = pw8ReviewBadge("2026-09-16");
    expect(badge?.text).toBe("PW8 검토 2026.12.16 D-91");
  });
  it("검토일 당일이면 D-DAY, 지나면 D+N이고 tone은 soon(주황)이다", () => {
    expect(pw8ReviewBadge("2026-06-16")?.text).toBe("PW8 검토 2026.09.16 D-DAY");
    expect(pw8ReviewBadge("2026-06-16")?.tone).toBe("soon");
    expect(pw8ReviewBadge("2026-06-01")?.text).toBe("PW8 검토 2026.09.01 D+15");
    expect(pw8ReviewBadge("2026-06-01")?.tone).toBe("soon");
  });
});

describe("sampleDday — PW3/PW4 전용(ZIP §2)", () => {
  it("현재 단계가 PW3/PW4가 아니면 null", () => expect(sampleDday([0, 1], "2026-09-20", "")).toBeNull());
  it("PW3가 현재 단계면 samplePw3Date를 쓴다", () => {
    const badge = sampleDday([0, 1, 2], "2026-09-20", "2026-11-01");
    expect(badge?.text).toBe("샘플 D-4");
  });
  it("PW4가 현재 단계면 samplePw4Date를 쓴다", () => {
    const badge = sampleDday([0, 1, 2, 3], "2026-09-20", "2026-09-10");
    expect(badge?.text).toBe("샘플 D+6");
    expect(badge?.tone).toBe("late");
  });
});

describe("isSubProjectDone / isCommonTaskDone", () => {
  it("서브 프로젝트는 status=DONE이거나 항목 전부 완료면 완료", () => {
    expect(isSubProjectDone({ status: "DONE", items: [] })).toBe(true);
    expect(isSubProjectDone({ status: "IN_PROGRESS", items: [{ status: "DONE" }, { status: "DONE" }] })).toBe(true);
    expect(isSubProjectDone({ status: "IN_PROGRESS", items: [{ status: "DONE" }, { status: "WAITING" }] })).toBe(false);
    expect(isSubProjectDone({ status: "PLANNED", items: [] })).toBe(false);
  });
  it("공통 업무는 항목이 1개 이상이고 전부 완료해야 완료(그룹 자체 status 없음)", () => {
    expect(isCommonTaskDone({ items: [] })).toBe(false);
    expect(isCommonTaskDone({ items: [{ status: "DONE" }] })).toBe(true);
    expect(isCommonTaskDone({ items: [{ status: "DONE" }, { status: "WAITING" }] })).toBe(false);
  });
});

describe("subProjectItemSpan — 항목들의 실제 min~max 분기(ZIP qSpan)", () => {
  it("항목이 없으면 null", () => expect(subProjectItemSpan([])).toBeNull());
  it("여러 분기에 걸친 항목의 min/max를 구한다", () => {
    const span = subProjectItemSpan([
      { quarterYear: 2026, quarterNum: 3 },
      { quarterYear: 2027, quarterNum: 1 },
      { quarterYear: 2026, quarterNum: 4 },
    ]);
    expect(span).toEqual({ start: { year: 2026, q: 3 }, end: { year: 2027, q: 1 } });
  });
});

describe("isRepeatDueDayPassed — 반복 업무 기준일 경과 강조(핸드오프 §4.10)", () => {
  // 고정된 오늘: 2026-09-16
  it("보고 있는 달이 실제 오늘이 속한 달이 아니면 항상 false", () => {
    expect(isRepeatDueDayPassed("1", { year: 2026, month: 10 })).toBe(false);
    expect(isRepeatDueDayPassed("31", { year: 2026, month: 8 })).toBe(false);
  });
  it("이번 달이고 오늘이 기준일보다 뒤면 true", () => {
    expect(isRepeatDueDayPassed("10", { year: 2026, month: 9 })).toBe(true);
  });
  it("이번 달이고 오늘이 기준일 이전/당일이면 false", () => {
    expect(isRepeatDueDayPassed("16", { year: 2026, month: 9 })).toBe(false);
    expect(isRepeatDueDayPassed("20", { year: 2026, month: 9 })).toBe(false);
  });
  it("말일 기준은 그 달의 마지막 날로 계산한다(9월=30일, 아직 안 지남)", () => {
    expect(isRepeatDueDayPassed("last", { year: 2026, month: 9 })).toBe(false);
  });
});
