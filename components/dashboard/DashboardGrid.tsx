"use client";

import { useMemo, useState } from "react";
import { GridLayout, useContainerWidth, type Layout } from "react-grid-layout";
import { KpiCard } from "@/components/kpi/KpiCard";
import { saveDashboardLayout } from "@/lib/dashboardLayout/actions";
import { getDefaultDashboardLayout, getSizeSpec } from "@/lib/dashboardLayout/defaultLayout";
import { GRID_COLS, type DashboardLayoutItem } from "@/lib/dashboardLayout/types";
import type { ChartType, MetricType } from "@/lib/kpiCalculator";
import type { KpiComparison } from "@/lib/kpiComparison";

interface ResultDatum {
  label: string;
  value: number;
}

export interface DashboardKpiCard {
  id: string;
  name: string;
  metricType: MetricType;
  chartType: ChartType;
  value: number | null;
  resultData: ResultDatum[] | null;
  footerText?: string;
  periodLabel: string;
  comparison?: KpiComparison | null;
}

const ROW_HEIGHT = 56;
const GRID_MARGIN: readonly [number, number] = [16, 16];

function toRglLayout(
  items: DashboardLayoutItem[],
  cardsById: Map<string, DashboardKpiCard>,
): Layout {
  return items
    .filter((item) => cardsById.has(item.kpiId))
    .map((item) => {
      const spec = getSizeSpec(cardsById.get(item.kpiId)!.chartType);
      return {
        i: item.kpiId,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: spec.minW,
        minH: spec.minH,
        maxW: spec.maxW,
        maxH: spec.maxH,
      };
    });
}

function fromRglLayout(layout: Layout): DashboardLayoutItem[] {
  return layout.map((item) => ({ kpiId: item.i, x: item.x, y: item.y, w: item.w, h: item.h }));
}

/**
 * Home KPI Card 영역의 공통 Layout Grid. ADMIN만 편집(Drag/Resize/저장)할 수 있고,
 * MEMBER는 저장된 공통 Layout을 그대로 조회만 한다(개인별 Layout 없음).
 * 이 컴포넌트는 위치/크기/편집 상태만 관리한다 — KPI 값 계산(rows→period filter→
 * calculateKpi→comparison)에도, Drill-down Modal 상태/조회에도 관여하지 않는다.
 * Drill-down은 Card 클릭 시 onOpenDrilldown만 호출하고, 실제 Modal은 이 Grid 바깥의
 * 상위 컴포넌트가 Dashboard 전체 기준 단 하나만 소유·렌더링한다(Grid Item마다 Modal을
 * 중복 생성하면 react-grid-layout이 각 Item에 적용하는 CSS transform 때문에
 * position:fixed Overlay가 viewport가 아니라 그 Item 크기에 갇히는 문제가 생긴다).
 */
export function DashboardGrid({
  cards,
  initialLayout,
  isAdmin,
  onOpenDrilldown,
}: {
  cards: DashboardKpiCard[];
  initialLayout: DashboardLayoutItem[];
  isAdmin: boolean;
  onOpenDrilldown: (kpiId: string, groupValue?: string) => void;
}) {
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const [savedLayout, setSavedLayout] = useState<DashboardLayoutItem[]>(initialLayout);
  const [draftLayout, setDraftLayout] = useState<DashboardLayoutItem[]>(initialLayout);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { width, containerRef, mounted } = useContainerWidth();

  const activeLayout = (editMode ? draftLayout : savedLayout).filter((item) =>
    cardsById.has(item.kpiId),
  );
  const rglLayout = useMemo(() => toRglLayout(activeLayout, cardsById), [activeLayout, cardsById]);

  function startEdit() {
    setDraftLayout(savedLayout);
    setSaveError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    setDraftLayout(savedLayout);
    setSaveError(null);
    setEditMode(false);
  }

  function applyDefaultLayout() {
    const defaults = getDefaultDashboardLayout(
      cards.map((card, index) => ({ id: card.id, chartType: card.chartType, displayOrder: index })),
    );
    // 기본 배치는 Preview일 뿐이며, "저장"을 눌러야 실제로 반영된다.
    setDraftLayout(defaults);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const res = await saveDashboardLayout(draftLayout);
    setSaving(false);
    if ("error" in res) {
      setSaveError(res.error);
      return;
    }
    setSavedLayout(draftLayout);
    setEditMode(false);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-navy-950/70">Dashboard</h2>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {editMode && saveError && <span className="text-xs text-rose-600">{saveError}</span>}
            {editMode ? (
              <>
                <button
                  type="button"
                  onClick={applyDefaultLayout}
                  disabled={saving}
                  className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium text-navy-950/70 transition-colors hover:bg-navy-100/40 disabled:opacity-50"
                >
                  기본 배치
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium text-navy-950/70 transition-colors hover:bg-navy-100/40 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-navy-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-navy-900 disabled:opacity-50"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium text-navy-950/70 transition-colors hover:bg-navy-100/40"
              >
                대시보드 편집
              </button>
            )}
          </div>
        )}
      </div>

      {editMode && (
        <p className="mb-3 text-xs text-navy-700">
          편집 중 — Card를 드래그해 위치를 옮기고, 우측 하단 모서리로 크기를 조절하세요.
        </p>
      )}

      <div ref={containerRef}>
        {mounted && (
          <GridLayout
            width={width}
            layout={rglLayout}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: ROW_HEIGHT,
              margin: GRID_MARGIN,
              containerPadding: null,
              maxRows: Infinity,
            }}
            dragConfig={{ enabled: editMode }}
            resizeConfig={{ enabled: editMode }}
            onLayoutChange={(layout) => {
              if (editMode) setDraftLayout(fromRglLayout(layout));
            }}
          >
            {activeLayout.map((item) => {
              const card = cardsById.get(item.kpiId)!;
              return (
                <div key={card.id} className="h-full">
                  <KpiCard
                    name={card.name}
                    metricType={card.metricType}
                    chartType={card.chartType}
                    value={card.value}
                    resultData={card.resultData}
                    footerText={card.footerText}
                    comparison={card.comparison}
                    editMode={editMode}
                    onOpenDrilldown={(groupValue) => onOpenDrilldown(card.id, groupValue)}
                  />
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>
    </div>
  );
}
