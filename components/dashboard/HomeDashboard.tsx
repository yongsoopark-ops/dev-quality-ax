"use client";

import { useState, type ReactNode } from "react";
import { DashboardGrid, type DashboardKpiCard } from "@/components/dashboard/DashboardGrid";
import { KpiDrilldownModal } from "@/components/kpi/KpiDrilldownModal";
import { fetchKpiDrilldown, getHomeKpiCardsAction } from "@/app/(shell)/home/actions";
import PeriodSelector from "@/components/period/PeriodSelector";
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
 *
 * 전역 성능 Step(Home 월 이동 부분 갱신) — period/cards/years를 이제 이 컴포넌트가
 * Client State로 직접 소유한다. PeriodSelector가 월을 바꾸면 router.push(전체
 * Route 재요청) 대신 getHomeKpiCardsAction만 호출해 cards/years만 교체하고,
 * URL은 history.replaceState로만 동기화한다(Next 서버 재조회를 트리거하지 않음).
 * Sidebar/DashboardLayout/ACTIVE User/Presence는 이 흐름에서 전혀 다시 조회되지
 * 않는다 — sideCards(Presence/API 사용료)는 최초 1회만 서버에서 렌더링되어
 * children으로 그대로 전달된다.
 */
export function HomeDashboard({
  initialCards,
  initialYears,
  initialPeriod,
  initialLayout,
  isAdmin,
  sideCards,
}: {
  initialCards: DashboardKpiCard[];
  initialYears: number[];
  initialPeriod: DashboardPeriod;
  initialLayout: DashboardLayoutItem[];
  isAdmin: boolean;
  sideCards: ReactNode;
}) {
  const [period, setPeriod] = useState(initialPeriod);
  const [cards, setCards] = useState(initialCards);
  const [years, setYears] = useState(initialYears);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [activeDrilldown, setActiveDrilldown] = useState<ActiveDrilldown | null>(null);

  async function handlePeriodChange(nextPeriod: DashboardPeriod) {
    setPeriod(nextPeriod);
    setRefreshing(true);
    setRefreshError(null);

    const res = await getHomeKpiCardsAction(nextPeriod);

    setRefreshing(false);
    if ("error" in res) {
      setRefreshError(res.error);
      return;
    }
    setCards(res.cards);
    setYears(res.years);
  }

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
    <div className="p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PeriodSelector period={period} years={years} onChange={handlePeriodChange} />
          {refreshError && <p className="mt-1 text-xs text-red-600">{refreshError}</p>}
        </div>
        <div className="flex flex-wrap gap-4">{sideCards}</div>
      </div>

      {cards.length === 0 ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-sm text-navy-950/40">표시할 KPI가 없습니다.</p>
        </div>
      ) : (
        <div className={`mt-6 transition-opacity ${refreshing ? "pointer-events-none opacity-60" : ""}`}>
          <DashboardGrid
            cards={cards}
            initialLayout={initialLayout}
            isAdmin={isAdmin}
            onOpenDrilldown={openDrilldown}
          />
        </div>
      )}

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
    </div>
  );
}
