"use client";

import { useState } from "react";
import { FACILITY_NAV_BUTTON_CLASS } from "@/lib/facility/constants";

/**
 * 사용 통계 — 차트/표 영역 접기·펼치기(가독성 개선 후속 요청). 순수 UI 상태만
 * 다룬다 — 통계 계산/DB 조회는 stats/page.tsx(Server Component)가 그대로
 * 수행하고, 이 컴포넌트는 이미 계산된 children(차트 카드 + 표 카드)을
 * 감싸 보이기/숨기기만 한다. 기본값은 펼침(true) — "기본 상태는 현재 화면
 * 구조를 최대한 유지" 요구사항대로 새로고침하면 항상 펼쳐진 상태로
 * 시작한다(별도 localStorage 등으로 상태를 영속화하지 않음). 기간
 * Filter(월간/분기별/연간)는 Link 기반 서버 네비게이션으로 이 컴포넌트
 * 바깥에서 동작하므로 이 접기 상태와 서로 간섭하지 않는다.
 */
export function StatsCollapsiblePanel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen((v) => !v)} className={FACILITY_NAV_BUTTON_CLASS} aria-expanded={open}>
          {open ? "통계 영역 접기 ▴" : "통계 영역 펼치기 ▾"}
        </button>
      </div>
      {open && <div className="flex flex-col gap-6">{children}</div>}
    </div>
  );
}
