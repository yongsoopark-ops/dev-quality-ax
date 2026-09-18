import { getCommonTasks, getProgressAssigneeOptions, getRegularProjects, getSubProjects } from "@/lib/progress/queries";
import { ProgressClient } from "./ProgressClient";

/**
 * 진행 현황 — ZIP 디자인 레퍼런스("진행 현황 관리판 v2.dc.html")의 진행
 * 현황판을 그대로 재현한다. 값은 Server Action을 통해 실제 DB에 저장되고,
 * 성공하면 revalidatePath로 이 페이지의 initialRows가 최신화된다(설비
 * 관리와 동일한 관례 — 별도 optimistic mirror state를 두지 않는다).
 */
export default async function ProgressPage() {
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
