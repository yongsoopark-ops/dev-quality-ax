import { getCommonTasks, getProgressAssigneeOptions, getRegularProjects, getSubProjects } from "@/lib/progress/queries";
import { extendRepeatingCommonTasksToCurrentMonth } from "./actions";
import { ProgressClient } from "./ProgressClient";

/**
 * 진행 현황 — ZIP 디자인 레퍼런스("진행 현황 관리판 v2.dc.html")의 진행
 * 현황판을 그대로 재현한다. 값은 Server Action을 통해 실제 DB에 저장되고,
 * 성공하면 revalidatePath로 이 페이지의 initialRows가 최신화된다(설비
 * 관리와 동일한 관례 — 별도 optimistic mirror state를 두지 않는다).
 */
export default async function ProgressPage() {
  // "매월 반복" 공통 업무는 등록/수정 시점의 monthEnd가 그 뒤로 저절로
  // 넓어지지 않아, 새 달이 실제로 와도 항목이 생기지 않는 버그가 있었다
  // (extendRepeatingCommonTasksToCurrentMonth 주석 참고) — 조회 전에 먼저
  // 채워 넣어야 아래 getCommonTasks()가 이번 달 항목을 바로 돌려준다.
  await extendRepeatingCommonTasksToCurrentMonth();

  const [regularProjects, subProjects, commonTasks, assigneeOptions] = await Promise.all([
    getRegularProjects(),
    getSubProjects(),
    getCommonTasks(),
    getProgressAssigneeOptions(),
  ]);

  return (
    <ProgressClient
      initialRegularProjects={regularProjects}
      initialSubProjects={subProjects}
      initialCommonTasks={commonTasks}
      assigneeOptions={assigneeOptions}
    />
  );
}
