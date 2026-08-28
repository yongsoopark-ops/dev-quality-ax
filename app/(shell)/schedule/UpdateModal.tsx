"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ScheduleCurrentUser, ScheduleUser, TaskCommentInfo } from "@/lib/schedule/types";
import { EMPTY_DOC_JSON, renderCommentHtml } from "@/lib/schedule/richText";
import {
  createTaskCommentAction,
  createTaskCommentReplyAction,
  deleteTaskCommentAction,
  updateTaskCommentAction,
} from "./actions";
import { RichTextEditor } from "./RichTextEditor";

/** "방금" / "10:42" / "2026.08.27 12:07" — 스펙 예시와 동일한 표기. */
function formatCommentTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (now.getTime() - d.getTime() < 60_000 && now.getTime() >= d.getTime()) return "방금";
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function canModify(currentUser: ScheduleCurrentUser, authorId: string): boolean {
  return currentUser.id === authorId || currentUser.role === "ADMIN";
}

/**
 * contentJson(Tiptap JSON)을 Editor 인스턴스 없이 가볍게 HTML로 렌더링한다 —
 * 목록에 여러 개 있어도 Editor를 여러 개 띄우지 않는다.
 *
 * renderCommentHtml은 ProseMirror의 DOMSerializer(브라우저 DOM 전용)를 쓰기
 * 때문에 Server Component 렌더링(SSR) 중에는 항상 실패해 빈 문자열로 남는다 —
 * 평소엔 Update Modal이 클릭 후에만(hydrate 완료 뒤) 열려 드러나지 않았지만,
 * Notification Deep Link로 Update Modal이 처음부터 열린 채 SSR되는 경우(요청사항
 * 9) 이 초기 SSR 결과가 그대로 굳어버려 본문이 영구적으로 빈 채 남는 문제가
 * 있었다. useSyncExternalStore로 "hydrate 완료 여부"를 구독해 Server/최초 Client
 * 렌더는 항상 똑같이 빈 값을 쓰고, hydrate 이후 리렌더에서만 실제 브라우저에서
 * 다시 계산한다 — React 공식 권장 방식이라 hydration mismatch도, effect 안에서
 * setState하는 것도 없다.
 */
const subscribeNoop = () => () => {};
function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

function CommentBody({ contentJson }: { contentJson: string }) {
  const mounted = useHasMounted();
  const html = mounted ? renderCommentHtml(contentJson) : "";
  return <div className="tiptap-content text-sm text-navy-950" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 새 작성/답변 작성/기존 내용 수정에 공용으로 쓰는 Rich Text + 등록·취소 버튼 묶음. */
function Composer({
  initialContentJson = EMPTY_DOC_JSON,
  initialPlainText = "",
  placeholder,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
  cancelLabel = "취소",
  mentionUsers,
}: {
  initialContentJson?: string;
  initialPlainText?: string;
  placeholder: string;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (contentJson: string, plainText: string) => Promise<string | null | undefined>;
  onCancel?: () => void;
  cancelLabel?: string;
  /** "@" 자동완성에 노출할 ACTIVE User 목록(요청사항 2: @All 포함은 RichTextEditor가 처리). */
  mentionUsers: ScheduleUser[];
}) {
  const [content, setContent] = useState(initialContentJson);
  const [plainText, setPlainText] = useState(initialPlainText);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!plainText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const err = await onSubmit(content, plainText);
      if (err) setError(err);
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <RichTextEditor
        value={content}
        onChange={(json, text) => { setContent(json); setPlainText(text); }}
        placeholder={placeholder}
        mentionUsers={mentionUsers}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !plainText.trim()}
          className="rounded-md bg-navy-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-navy-100 px-3 py-1 text-xs text-navy-950/70 hover:bg-navy-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

/** Notification Deep Link(요청사항 9~10)로 들어온 focusId와 자기 id가 같으면
 * 살짝 스크롤+하이라이트하고 몇 초 뒤 원래대로 되돌린다 — 과도한 애니메이션은
 * 두지 않는다. */
function useFocusHighlight(id: string, focusId: string | undefined) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isTarget = focusId === id;
  const [highlighted, setHighlighted] = useState(isTarget);

  useEffect(() => {
    if (!isTarget) return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setHighlighted(false), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { rootRef, highlighted };
}

function ReplyCard({
  reply,
  currentUser,
  mentionUsers,
  focusCommentId,
  onUpdated,
  onDeleted,
}: {
  reply: TaskCommentInfo;
  currentUser: ScheduleCurrentUser;
  mentionUsers: ScheduleUser[];
  focusCommentId?: string;
  onUpdated: (updated: TaskCommentInfo) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = canModify(currentUser, reply.authorId);
  const { rootRef, highlighted } = useFocusHighlight(reply.id, focusCommentId);

  async function handleDelete() {
    if (!window.confirm("이 답변을 삭제하시겠습니까?")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteTaskCommentAction(reply.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      onDeleted(reply.id);
    } catch {
      setError("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <div ref={rootRef} className="border-l-2 border-navy-100 pl-3">
        <Composer
          initialContentJson={reply.contentJson}
          initialPlainText={reply.plainText}
          placeholder="답변을 입력하세요"
          submitLabel="수정 저장"
          submittingLabel="저장 중..."
          cancelLabel="취소"
          mentionUsers={mentionUsers}
          onCancel={() => setEditing(false)}
          onSubmit={async (json, text) => {
            const res = await updateTaskCommentAction(reply.id, json, text);
            if (res.error || !res.comment) return res.error ?? "수정하지 못했습니다.";
            onUpdated(res.comment);
            setEditing(false);
            return null;
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`border-l-2 pl-3 transition-colors duration-700 ${highlighted ? "border-amber-400 bg-amber-50/60" : "border-navy-100"}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-navy-950">
          {reply.authorName ?? "알 수 없음"} · {formatCommentTime(reply.createdAt)}
          {reply.updatedAt !== reply.createdAt && <span className="ml-1 text-navy-950/40">(수정됨)</span>}
        </p>
        {editable && (
          <div className="flex items-center gap-2 text-[11px]">
            <button type="button" onClick={() => setEditing(true)} className="text-navy-950/50 hover:text-navy-950">
              수정
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="text-red-600 hover:underline disabled:opacity-50">
              {deleting ? "삭제 중..." : "삭제"}
            </button>
          </div>
        )}
      </div>
      <CommentBody contentJson={reply.contentJson} />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function CommentCard({
  comment,
  currentUser,
  mentionUsers,
  focusCommentId,
  onUpdated,
  onDeleted,
  onReplyAdded,
  onReplyUpdated,
  onReplyDeleted,
}: {
  comment: TaskCommentInfo;
  currentUser: ScheduleCurrentUser;
  mentionUsers: ScheduleUser[];
  focusCommentId?: string;
  onUpdated: (updated: TaskCommentInfo) => void;
  onDeleted: (id: string) => void;
  onReplyAdded: (parentId: string, reply: TaskCommentInfo) => void;
  onReplyUpdated: (parentId: string, reply: TaskCommentInfo) => void;
  onReplyDeleted: (parentId: string, replyId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = canModify(currentUser, comment.authorId);
  const { rootRef, highlighted } = useFocusHighlight(comment.id, focusCommentId);

  async function handleDelete() {
    if (!window.confirm("이 업데이트를 삭제하시겠습니까? 달려있는 답변도 함께 삭제됩니다.")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteTaskCommentAction(comment.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      onDeleted(comment.id);
    } catch {
      setError("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`space-y-2 rounded-md border p-3 transition-colors duration-700 ${highlighted ? "border-amber-400 bg-amber-50/60" : "border-navy-100"}`}
    >
      {editing ? (
        <Composer
          initialContentJson={comment.contentJson}
          initialPlainText={comment.plainText}
          placeholder="업데이트를 입력하세요"
          submitLabel="수정 저장"
          submittingLabel="저장 중..."
          cancelLabel="취소"
          mentionUsers={mentionUsers}
          onCancel={() => setEditing(false)}
          onSubmit={async (json, text) => {
            const res = await updateTaskCommentAction(comment.id, json, text);
            if (res.error || !res.comment) return res.error ?? "수정하지 못했습니다.";
            onUpdated(res.comment);
            setEditing(false);
            return null;
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-navy-950">
              {comment.authorName ?? "알 수 없음"} · {formatCommentTime(comment.createdAt)}
              {comment.updatedAt !== comment.createdAt && <span className="ml-1 text-navy-950/40">(수정됨)</span>}
            </p>
            {editable && (
              <div className="flex items-center gap-2 text-[11px]">
                <button type="button" onClick={() => setEditing(true)} className="text-navy-950/50 hover:text-navy-950">
                  수정
                </button>
                <button type="button" onClick={handleDelete} disabled={deleting} className="text-red-600 hover:underline disabled:opacity-50">
                  {deleting ? "삭제 중..." : "삭제"}
                </button>
              </div>
            )}
          </div>
          <CommentBody contentJson={comment.contentJson} />
        </>
      )}

      {!editing && (
        <button
          type="button"
          onClick={() => setReplying((v) => !v)}
          className="text-[11px] font-medium text-navy-950/50 hover:text-navy-950"
        >
          답변{comment.replies.length > 0 ? ` (${comment.replies.length})` : ""}
        </button>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {comment.replies.length > 0 && (
        <div className="space-y-2 pl-4 pt-1">
          {comment.replies.map((r) => (
            <ReplyCard
              key={r.id}
              reply={r}
              currentUser={currentUser}
              mentionUsers={mentionUsers}
              focusCommentId={focusCommentId}
              onUpdated={(updated) => onReplyUpdated(comment.id, updated)}
              onDeleted={(id) => onReplyDeleted(comment.id, id)}
            />
          ))}
        </div>
      )}

      {replying && (
        <div className="pl-4 pt-1">
          <Composer
            placeholder="답변을 입력하세요"
            submitLabel="답변 등록"
            submittingLabel="등록 중..."
            cancelLabel="취소"
            mentionUsers={mentionUsers}
            onCancel={() => setReplying(false)}
            onSubmit={async (json, text) => {
              const res = await createTaskCommentReplyAction(comment.id, json, text);
              if (res.error || !res.comment) return res.error ?? "답변을 등록하지 못했습니다.";
              onReplyAdded(comment.id, res.comment);
              setReplying(false);
              return null;
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Task 상세 Modal에서 분리된, 업무 협업 기록(Update/Reply) 전용 Overlay(요청사항
 * 2~4) — Task 상세는 "💬 업데이트 N" 버튼만 보여주고, 목록/작성/답변은 전부
 * 여기서 처리한다. TaskDetailPanel 위에 겹쳐 뜨며 별도 페이지로 이동하지 않는다.
 *
 * comments/onCommentsChange는 TaskDetailPanel이 들고 있는 state를 그대로
 * 제어한다 — 이 Modal을 닫아도 "💬 업데이트 N" 카운트가 최신 상태를 반영한다.
 */
export function UpdateModal({
  taskTitle,
  comments,
  onCommentsChange,
  taskId,
  currentUser,
  users,
  focusCommentId,
  loading,
  loadError,
  onClose,
}: {
  taskTitle: string;
  comments: TaskCommentInfo[];
  onCommentsChange: (updater: (prev: TaskCommentInfo[]) => TaskCommentInfo[]) => void;
  taskId: string;
  currentUser: ScheduleCurrentUser;
  /** "@" 자동완성 후보(ACTIVE User) — page.tsx가 이미 ACTIVE로 필터링해 내려준 값. */
  users: ScheduleUser[];
  /** Notification Deep Link로 열렸을 때 스크롤+하이라이트할 대상 Comment/Reply id. */
  focusCommentId?: string;
  /** 성능 개선: comments는 이 Modal을 열 때 처음으로 Lazy 조회된다(TaskDetailPanel) —
   * 조회가 끝나기 전까지는 목록이 비어 있는 게 아니라 "불러오는 중"임을 구분해서 보여준다. */
  loading?: boolean;
  loadError?: string | null;
  onClose: () => void;
}) {
  const totalCount = comments.reduce((sum, c) => sum + 1 + c.replies.length, 0);
  // 새 업데이트 Composer는 항상 마운트돼 있어(리스트처럼 조건부로 사라지지
  // 않음) "취소"나 "등록 성공"으로 내용을 비우려면 key를 바꿔 강제로 다시
  // 마운트하는 수밖에 없다 — Composer 내부 상태(Tiptap Editor 포함)를 밖에서
  // 직접 건드리지 않고 가장 단순하게 초기화하는 방법이다.
  const [composerKey, setComposerKey] = useState(0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // TaskDetailPanel과 동일한 이유로 onMouseDown이 아닌 onClick을 쓴다 —
        // 통과 클릭으로 뒤(Task 상세 Modal)의 다른 조작이 실행되는 것을 막는다.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-xl border border-navy-100 bg-white shadow-lg">
        <style>{`
          .tiptap-content ul { list-style: disc; padding-left: 1.25rem; }
          .tiptap-content ol { list-style: decimal; padding-left: 1.25rem; }
          .tiptap-content a { color: #2563eb; text-decoration: underline; }
          .tiptap-content p { margin: 0; }
          .tiptap-content p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: rgb(15 23 42 / 0.35);
            pointer-events: none;
            height: 0;
          }
          .tiptap-content .mention {
            color: #2563eb;
            background: rgb(37 99 235 / 0.08);
            border-radius: 4px;
            padding: 0 2px;
            font-weight: 500;
          }
        `}</style>

        <div className="flex items-center justify-between border-b border-navy-100 px-5 py-3">
          <div>
            <p className="font-semibold text-navy-950">{taskTitle || "(제목 없음)"}</p>
            <p className="text-xs text-navy-950/50">업데이트 {totalCount}건</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-navy-950/50 hover:text-navy-950">
            닫기
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {loading ? (
            // 목록을 아직 Lazy 조회 중일 때는 새 Update 등록도 잠시 막는다 — 조회가
            // 끝나기 전에 등록하면, 뒤이어 도착하는 목록 조회 결과가 방금 등록한
            // 내용을 덮어써 화면에서 사라져 보일 수 있는 경합을 원천 차단한다.
            <p className="py-6 text-center text-xs text-navy-950/40">불러오는 중...</p>
          ) : loadError ? (
            <p className="py-6 text-center text-xs text-red-600">{loadError}</p>
          ) : (
            <>
              <Composer
                key={composerKey}
                placeholder="새 업데이트를 입력하세요"
                submitLabel="업데이트 등록"
                submittingLabel="등록 중..."
                cancelLabel="입력 취소"
                mentionUsers={users}
                onCancel={() => setComposerKey((k) => k + 1)}
                onSubmit={async (json, text) => {
                  const res = await createTaskCommentAction(taskId, json, text);
                  if (res.error || !res.comment) return res.error ?? "업데이트를 등록하지 못했습니다.";
                  const created = res.comment;
                  onCommentsChange((prev) => [...prev, created]);
                  setComposerKey((k) => k + 1);
                  return null;
                }}
              />

              {comments.length > 0 ? (
                <div className="space-y-2">
                  {comments.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      currentUser={currentUser}
                      mentionUsers={users}
                      focusCommentId={focusCommentId}
                      onUpdated={(updated) =>
                        onCommentsChange((prev) => prev.map((p) => (p.id === updated.id ? { ...updated, replies: p.replies } : p)))
                      }
                      onDeleted={(id) => onCommentsChange((prev) => prev.filter((p) => p.id !== id))}
                      onReplyAdded={(parentId, reply) =>
                        onCommentsChange((prev) => prev.map((p) => (p.id === parentId ? { ...p, replies: [...p.replies, reply] } : p)))
                      }
                      onReplyUpdated={(parentId, reply) =>
                        onCommentsChange((prev) =>
                          prev.map((p) =>
                            p.id === parentId ? { ...p, replies: p.replies.map((r) => (r.id === reply.id ? reply : r)) } : p,
                          ),
                        )
                      }
                      onReplyDeleted={(parentId, replyId) =>
                        onCommentsChange((prev) =>
                          prev.map((p) => (p.id === parentId ? { ...p, replies: p.replies.filter((r) => r.id !== replyId) } : p)),
                        )
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-navy-950/40">아직 업데이트가 없습니다.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
