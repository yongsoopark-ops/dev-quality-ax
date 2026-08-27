"use client";

import { useEffect, useState } from "react";
import { fetchTeamPresence } from "@/lib/presence/actions";
import { PRESENCE_LABEL, type PresenceStatus } from "@/lib/presence/presence";
import type { TeamPresenceEntry } from "@/lib/presence/presenceSummary";

const REFRESH_INTERVAL_MS = 60_000;

const STATUS_DOT_CLASS: Record<PresenceStatus, string> = {
  ACTIVE: "bg-emerald-500",
  AWAY: "bg-amber-500",
  OFFLINE: "bg-navy-950/25",
};

export function TeamPresenceCard({ initialEntries }: { initialEntries: TeamPresenceEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);

  // Home 전체(KPI 등)를 다시 렌더링하지 않고, Presence만 독립적으로 주기 갱신한다.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTeamPresence()
        .then(setEntries)
        .catch(() => {});
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full shrink-0 rounded-xl border border-navy-100 p-4 sm:w-64">
      <p className="text-xs font-medium text-navy-950/60">팀원 연결 상태</p>

      <div className="mt-2 space-y-1.5">
        {entries.length === 0 && (
          <p className="text-sm text-navy-950/40">표시할 팀원이 없습니다.</p>
        )}
        {entries.map((entry) => (
          <div key={entry.userId} className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[entry.status]}`}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-navy-950/80">
              {entry.displayName}
            </span>
            <span className="shrink-0 text-xs text-navy-950/50">
              {PRESENCE_LABEL[entry.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
