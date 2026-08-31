"use client";

import { useState } from "react";
import type { MeetingTemplateInfo } from "@/lib/meetingTemplates/actions";
import { TemplateEditor } from "./TemplateEditor";
import { TemplateList } from "./TemplateList";

type View = { mode: "list" } | { mode: "edit"; template: MeetingTemplateInfo | null };

/**
 * Step 5B-3 — "Template 목록 → 새 양식 생성 또는 기존 양식 선택 → Editor
 * 진입" 흐름 자체를 이 Component가 소유한다. 실제 CRUD는 TemplateEditor가
 * Server Action을 직접 호출하고, 그 결과만 이 Component의 templates 배열에
 * 반영한다(서버에서 다시 전체 목록을 불러오지 않고 낙관적으로 병합) — 목록
 * 화면으로 돌아왔을 때 방금 한 변경이 그대로 보이게 하기 위함.
 */
export function MeetingTemplateManager({
  initialTemplates,
  initialError,
}: {
  initialTemplates: MeetingTemplateInfo[];
  initialError: string | null;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [view, setView] = useState<View>({ mode: "list" });

  /** 생성/수정/활성 전환 성공 후 공통으로 부른다. 활성 전환은 서버가 같은
   * meetingType의 다른 Row를 이미 비활성화했으므로, Client 상태도 같은
   * meetingType의 다른 Row를 함께 비활성화해 다시 조회하지 않아도 목록이
   * 항상 "실제 활성 Template 1개"를 정확히 반영하게 한다. */
  function upsertTemplate(saved: MeetingTemplateInfo) {
    setTemplates((prev) => {
      const exists = prev.some((t) => t.id === saved.id);
      const merged = exists ? prev.map((t) => (t.id === saved.id ? saved : t)) : [...prev, saved];
      return merged.map((t) => (t.id !== saved.id && t.meetingType === saved.meetingType && saved.isActive ? { ...t, isActive: false } : t));
    });
  }

  function removeTemplate(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  if (view.mode === "edit") {
    return (
      <TemplateEditor
        template={view.template}
        onSaved={(saved) => {
          upsertTemplate(saved);
          setView({ mode: "edit", template: saved });
        }}
        onActivated={(saved) => {
          upsertTemplate(saved);
          setView({ mode: "edit", template: saved });
        }}
        onDeleted={(id) => {
          removeTemplate(id);
          setView({ mode: "list" });
        }}
        onClose={() => setView({ mode: "list" })}
      />
    );
  }

  return (
    <TemplateList
      templates={templates}
      loadError={initialError}
      onSelect={(template) => setView({ mode: "edit", template })}
      onCreateNew={() => setView({ mode: "edit", template: null })}
    />
  );
}
