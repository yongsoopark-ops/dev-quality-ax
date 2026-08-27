"use client";

import { useState } from "react";
import { DashboardGrid, type DashboardKpiCard } from "@/components/dashboard/DashboardGrid";
import { KpiDrilldownModal } from "@/components/kpi/KpiDrilldownModal";
import { fetchKpiDrilldown } from "@/app/(shell)/home/actions";
import type { DrilldownResult } from "@/lib/kpiDrilldown";
import type { DashboardLayoutItem } from "@/lib/dashboardLayout/types";
import type { DashboardPeriod } from "@/lib/period";

interface ActiveDrilldown {
  kpiId: string;
  name: string;
  periodLabel: string;
  groupValue: string | null;
  loading: boolean;
  error: string | null;
  result: DrilldownResult | null;
}

/**
 * Home의 KPI Dashboard 영역 전체를 감싼다. Drill-down 상태(activeDrilldown)와 Modal은
 * 여기 단 한 곳에서만 소유한다 — DashboardGrid/KpiCard는 Drill-down을 열어 달라는 요청만
 * 콜백으로 올려보내고, Modal 자체는 Grid Item(react-grid-layout이 transform을 적용하는
 * DOM) 바깥에서 렌더링되므로 position:fixed Overlay가 항상 화면 전체를 덮는다.
 * 동시에 두 개 이상의 Drill-down이 뜰 수 없다: activeDrilldown은 한 번에 하나만 존재하고,
 * 다른 KPI를 클릭하면 그 값을 교체할 뿐이다.
 */
export function HomeDashboard({
  cards,
  initialLayout,
  isAdmin,
  period,
}: {
  cards: DashboardKpiCard[];
  initialLayout: DashboardLayoutItem[];
  isAdmin: boolean;
  period: DashboardPeriod;
}) {
  const [activeDrilldown, setActiveDrilldown] = useState<ActiveDrilldown | null>(null);

  async function openDrilldown(kpiId: string, groupValue?: string) {
    const card = cards.find((c) => c.id === kpiId);
    if (!card) return;

    setActiveDrilldown({
      kpiId,
      name: card.name,
      periodLabel: card.periodLabel,
      groupValue: groupValue ?? null,
      loading: true,
      error: null,
      result: null,
    });

    const res = await fetchKpiDrilldown({ kpiId, period, groupValue: groupValue ?? null });

    setActiveDrilldown((prev) => {
      // 조회 도중 다른 KPI를 클릭해 activeDrilldown이 이미 교체됐다면 이 응답은 버린다.
      if (!prev || prev.kpiId !== kpiId) return prev;
      if ("error" in res) return { ...prev, loading: false, error: res.error };
      return { ...prev, loading: false, result: res };
    });
  }

  return (
    <>
      <DashboardGrid
        cards={cards}
        initialLayout={initialLayout}
        isAdmin={isAdmin}
        onOpenDrilldown={openDrilldown}
      />

      <KpiDrilldownModal
        open={activeDrilldown !== null}
        onClose={() => setActiveDrilldown(null)}
        title={
          activeDrilldown
            ? activeDrilldown.groupValue
              ? `${activeDrilldown.name} — ${activeDrilldown.groupValue}`
              : activeDrilldown.name
            : ""
        }
        periodLabel={activeDrilldown?.periodLabel ?? ""}
        loading={activeDrilldown?.loading ?? false}
        error={activeDrilldown?.error ?? null}
        rows={activeDrilldown?.result?.rows ?? null}
        columns={activeDrilldown?.result?.columns ?? []}
      />
    </>
  );
}
