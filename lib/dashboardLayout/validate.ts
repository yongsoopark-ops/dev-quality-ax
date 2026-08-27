import { GRID_COLS, type DashboardLayoutItem } from "@/lib/dashboardLayout/types";

const MIN_COORD = 0;
const MAX_COORD = 500; // 비정상적으로 먼 좌표를 막기 위한 여유 있는 상한
const MIN_SIZE = 1;
const MAX_SIZE = 24;

/**
 * Client가 보낸 layoutData를 신뢰하지 않고 서버에서 검증한다.
 * - kpiId가 문자열이고 현재 활성 KPI 목록에 실제로 존재하는지
 * - x/y가 0 이상의 정수인지
 * - w/h가 허용 범위의 정수이고, x+w가 Grid 폭(12)을 벗어나지 않는지
 * - kpiId 중복이 없는지
 * 하나라도 위반하면 전체를 거부한다(부분 저장하지 않음). 통과분은 kpiId/x/y/w/h
 * 5개 필드만 남긴 새 객체로 재구성해, Client가 보냈을 수 있는 불필요한 필드를 제거한다.
 */
export function validateLayoutData(
  raw: unknown,
  activeKpiIds: Set<string>,
): DashboardLayoutItem[] | null {
  if (!Array.isArray(raw)) return null;

  const seen = new Set<string>();
  const result: DashboardLayoutItem[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { kpiId, x, y, w, h } = entry as Record<string, unknown>;

    if (typeof kpiId !== "string" || kpiId.length === 0) return null;
    if (!activeKpiIds.has(kpiId)) return null;
    if (seen.has(kpiId)) return null;

    if (!isValidCoord(x) || !isValidCoord(y)) return null;
    if (!isValidSize(w) || !isValidSize(h)) return null;
    if ((x as number) + (w as number) > GRID_COLS) return null;

    seen.add(kpiId);
    result.push({ kpiId, x: x as number, y: y as number, w: w as number, h: h as number });
  }

  return result;
}

function isValidCoord(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_COORD &&
    value <= MAX_COORD
  );
}

function isValidSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SIZE &&
    value <= MAX_SIZE
  );
}
