/**
 * Sidebar Drag & Drop의 순수 배열 재배치 로직. dnd-kit 이벤트에서 필요한 index만
 * 뽑아 이 함수들에 넘기면 되고, 여기에는 DOM/이벤트 관련 코드가 전혀 없다 —
 * 그래서 실제 Group이 하나뿐이라도(Cross-group 이동을 눈으로 볼 UI가 아직 없어도)
 * 순수 로직 테스트로 Cross-group 이동 자체를 검증할 수 있다.
 */

function moveWithinArray<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  const copy = [...array];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

/** Group Header Drag로 Group 전체의 표시 순서를 바꾼다. Group 내부 Menu는 그대로 함께 이동한다. */
export function moveGroups<G>(groups: G[], fromIndex: number, toIndex: number): G[] {
  return moveWithinArray(groups, fromIndex, toIndex);
}

/** 같은 Group 안에서 Menu 순서만 바꾼다. */
export function moveMenuWithinGroup<G extends { items: I[] }, I>(
  groups: G[],
  groupIndex: number,
  fromIndex: number,
  toIndex: number,
): G[] {
  const next = [...groups];
  const group = next[groupIndex];
  next[groupIndex] = { ...group, items: moveWithinArray(group.items, fromIndex, toIndex) };
  return next;
}

/** Menu를 다른 Group으로 옮긴다(권한 등 Menu 자체 속성은 전혀 건드리지 않고 위치만 이동). */
export function moveMenuAcrossGroups<G extends { items: I[] }, I>(
  groups: G[],
  fromGroupIndex: number,
  itemIndex: number,
  toGroupIndex: number,
  toIndex: number,
): G[] {
  const next = groups.map((g) => ({ ...g, items: [...g.items] }));
  const [moved] = next[fromGroupIndex].items.splice(itemIndex, 1);
  const boundedToIndex = Math.min(toIndex, next[toGroupIndex].items.length);
  next[toGroupIndex].items.splice(boundedToIndex, 0, moved);
  return next;
}
