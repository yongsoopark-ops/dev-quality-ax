/**
 * Tiptap Mention Node ↔ Notification 대상 User 목록을 연결하는 순수 함수들.
 * DB/Server Action에 의존하지 않아 Client(자동완성 필터링)와 Server(Notification
 * 생성 대상 계산) 양쪽에서 그대로 재사용한다. 이름을 문자열로만 저장하지 않고
 * Tiptap Mention Node의 attrs.id(userId 또는 "ALL")를 그대로 신뢰한다 —
 * AI로 이름을 추론/매칭하는 코드는 없다(요청사항 13).
 */

/** @All 전용 stable id. User.id와 절대 충돌하지 않는다(cuid는 이 형태로 생성되지 않음). */
export const MENTION_ALL_ID = "ALL";

interface TiptapNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
}

/** contentJson(Tiptap JSON Document 문자열) 안의 모든 mention node에서 attrs.id를
 * 모아 반환한다("ALL" 포함 가능) — 트리 전체를 재귀적으로 훑는다. */
export function extractMentionIds(contentJson: string): string[] {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(contentJson);
  } catch {
    return [];
  }

  const ids: string[] = [];
  function walk(node: TiptapNode | undefined) {
    if (!node) return;
    if (node.type === "mention" && typeof node.attrs?.id === "string") {
      ids.push(node.attrs.id);
    }
    node.content?.forEach(walk);
  }
  walk(doc);
  return ids;
}

/**
 * contentJson에서 실제로 Notification을 받아야 할 User id 목록을 계산한다.
 * - "ALL" mention은 activeUserIds 전체로 펼친다(요청사항 4).
 * - 같은 User를 여러 번 mention해도 결과는 1개만 남는다(Set으로 중복 제거).
 * - 작성자 본인은 항상 제외한다("ALL"에 포함되더라도 마찬가지, 요청사항 4).
 */
export function resolveMentionedUserIds(
  contentJson: string,
  activeUserIds: string[],
  authorId: string,
): string[] {
  const rawIds = extractMentionIds(contentJson);
  if (rawIds.length === 0) return [];

  const result = new Set<string>();
  const hasAll = rawIds.includes(MENTION_ALL_ID);
  if (hasAll) {
    for (const id of activeUserIds) result.add(id);
  }
  for (const id of rawIds) {
    if (id !== MENTION_ALL_ID) result.add(id);
  }
  result.delete(authorId);
  return [...result];
}
