import { format } from "date-fns";

/**
 * Step 5B-9(주간 파트 회의록 Preview) — 이 파일은 순수 계산만 담당한다(DB/
 * React 의존 없음, lib/schedule/recurrence.ts와 같은 설계). Schedule에서 이미
 * 조회한 Task들을 업무 구분별 섹션으로 분류하고, 프로젝트성 업무는 동일
 * 그룹키(프로젝트명/목표명/업무명)로 그룹핑한다.
 *
 * Step 5B-9 보완(사용자 확인 반영) — "출장 업무"를 label 문자열로 찾지
 * 않는다. 각 TaskCategoryOption.meetingReportSection(label과 완전히 독립된
 * 별도 컬럼)이 있는 Task만 그 값 기준으로 분류한다.
 *
 * Step(파트 주간회의 Table UX + AUTO 필드 개편) — 프로젝트/업무별 AUTO
 * 영역이 "진행 현황: 업무명 / 업무명"처럼 업무명만 합쳐 보여주던 것에서
 * "업무명 | 진행 일정" Table(업무 1건당 1행)로 바뀌었다(요청사항: "업무명과
 * 진행일정은 반드시 같은 행에 묶어서 관계가 깨지지 않게"). 그래서
 * SectionGroup.items(문자열 배열)를 SectionGroup.tasks(업무명+기간 쌍의
 * 배열)로 바꾸고, WeeklyTaskInfo에도 개별 Task의 startDate/dueDate를 그대로
 * 남긴다(이전에는 겹침 필터링에만 쓰고 버렸다).
 *
 * Step(AUTO/작성 영역 분리 + 표 열 비율 조정) — 담당자를 "구분 | 내용"
 * Table의 행(그룹 전체 공통 값)에서 Schedule AUTO Table의 열로 옮겼다
 * (요청사항: "업무명 | 진행 일정 | 담당자 3열 표, 동일 Task 행 안에서 세
 * 값이 한 세트"). 담당자는 이제 그룹 단위가 아니라 Task 단위 값이므로
 * SectionGroup 레벨의 assignees(Set 집계)는 더 이상 쓰지 않고, 각
 * SectionTaskRow가 자기 Task의 assigneeNames를 그대로 갖는다.
 *
 * Step(회의록 Draft 저장/초기화 정책 + 담당자별 그룹핑) — 업무구분 →
 * 프로젝트 2단 구조를 업무구분 → 담당자 → 프로젝트 3단 구조로 바꾼다
 * (요청사항: "담당자가 자신의 업무를 찾기 위해 문서 전체를 오가야 하는
 * 문제 제거"). 그룹핑은 Task 단위로 먼저 담당자별로 나눈 뒤, 그 안에서
 * 기존과 동일한 프로젝트 키로 다시 묶는다.
 *
 * 다중 담당자 Task 처리: 담당자를 임의로 하나만 고르거나 제거하지 않는다
 * (요청사항). "중복 표시"(그 Task가 속한 모든 담당자의 그룹에 각각
 * 나타난다)를 선택했다 — "공동담당 블록"(담당자 조합별 새 그룹)보다
 * 안전한 이유는, 담당자가 자기 이름 섹션만 봐도 자신에게 배정된 모든
 * Task를 빠짐없이 찾을 수 있어야 한다는 이번 Step의 목적에 더 직접
 * 부합하기 때문이다 — 공동담당 블록이면 자기 이름이 아닌 조합 라벨
 * 아래에 있는 Task를 놓칠 수 있다. 각 Task 행의 "담당자" 열 값 자체는
 * (어느 그룹에 나타나든) 항상 그 Task의 담당자 전체를 보여준다 — 그룹
 * 소속이 목록을 자르지 않는다.
 *
 * 담당자 정렬: 하드코딩된 사람 이름 순서를 만들지 않는다(요청사항). 이미
 * 이 코드베이스가 쓰는 안정적 기준(app/(shell)/admin/users/page.tsx의
 * `orderBy: { createdAt: "asc" }`)을 그대로 재사용한다 — 호출부
 * (lib/meetingMinutes/actions.ts)가 Task 조회에 곁들여 담당자별
 * User.createdAt을 assigneeSortKeys로 함께 넘긴다. 담당자 없는 Task는
 * "담당자 미지정" 그룹으로 모으고 항상 맨 뒤에 둔다.
 */

export interface WeeklyTaskInfo {
  id: string;
  title: string;
  /** null이면 이번 자동화 대상 업무구분이 아니다(미팅/휴가/반차, 또는
   * meetingReportSection이 지정되지 않은 그 외 업무구분 전부). */
  meetingReportSection: "REGULAR_PROJECT" | "SUB_PROJECT" | "EXCEPTION" | "BUSINESS_TRIP" | "COMMON" | null;
  projectName: string | null;
  goalName: string | null;
  assigneeNames: string[];
  /** Step(V1 Fix — 회의록 공통 일정 그룹 분리) — Schedule의 "공통"
   * assigneeMode로 등록된 Task는 항상 assigneeNames가 비어 있지만(담당자
   * 미지정과 겉보기 동일), 의미는 다르다("특정 담당자 없이 공통 업무로
   * 등록" vs "아직 담당자를 못 정함"). visible label이 아니라 이 필드로만
   * 판별한다(요청사항 3). */
  isCommonAssignee: boolean;
  /** 이번 주 기준 "유효 일정"(Revision이 있으면 최신 Revision, 없으면 Task
   * 원본) — 진행 일정 Table의 "업무명 | 진행 일정" 한 행을 만드는 데 쓴다. */
  startDate: Date;
  dueDate: Date;
}

export interface SectionTaskRow {
  title: string;
  /** "yyyy.MM.dd ~ yyyy.MM.dd" 형태(요청사항 예시: "2026.09.02 ~
   * 2026.09.04") — Schedule 다른 화면의 하이픈 표기와는 별개로, 이 Table
   * 전용 표기다. */
  period: string;
  /** 이 Task 하나의 담당자 전체 — Schedule AUTO Table 3열(업무명 | 진행
   * 일정 | 담당자)의 세 번째 열 값이다. 이 Task가 여러 담당자 그룹에 중복
   * 표시되더라도 이 값은 항상 전체 목록 그대로다(그룹 소속이 목록을 자르지
   * 않는다). */
  assignees: string[];
}

export interface SectionGroup {
  /** PROJECT는 projectName, PERSONAL_GOAL은 goalName, 그 외(예외 업무/출장
   * 업무/공통 업무 — 전용 "이름" 필드가 스키마에 없다)는 업무명(title) 자체를
   * 그룹키로 쓴다. */
  title: string;
  /** Schedule AUTO Table(업무명 | 진행 일정 | 담당자)의 각 행 — Task 1건당
   * 1행이다(제목이 같아도 병합하지 않는다: 같은 프로젝트에 실제로 서로 다른
   * Task 여러 건이 있을 수 있고, 각각 자기 진행 일정·담당자를 가진다). */
  tasks: SectionTaskRow[];
}

/** 업무구분 안의 담당자 1명 구간 — 그 담당자에게 배정된 프로젝트/업무
 * 목록을 담는다. assigneeName이 null이면 "담당자 미지정" 또는 "공통"
 * 구간이다 — 어느 쪽인지는 isCommon으로 구분한다(Step(V1 Fix — 회의록
 * 공통 일정 그룹 분리): visible label만으로 판단하지 않는다, 요청사항 3).
 * isCommon이 true면 assigneeName은 항상 null이다. */
export interface AssigneeGroup {
  assigneeName: string | null;
  isCommon: boolean;
  groups: SectionGroup[];
}

export interface SectionResult {
  headingText: string;
  /** Step(Template/Preview 분리 검증 + Rich Text 매핑 안정화) — injectDocument.ts가
   * 이제 headingText 문자열이 아니라 이 semantic 값(heading node의
   * attrs.meetingSection 또는 그 legacy fallback)으로 Template의 실제 heading
   * 을 찾는다. headingText는 여전히 "못 찾았을 때 사용자에게 보여줄 이름"
   * 용도로만 남긴다. */
  section: NonNullable<WeeklyTaskInfo["meetingReportSection"]>;
  /** 담당자별로 그룹핑된 프로젝트/업무 목록(요청사항: "업무구분 → 담당자 →
   * 프로젝트 → 업무"). 정렬 순서: "공통"(있으면) 항상 맨 앞 → 담당자
   * 정렬 순서(assigneeSortKeys 기준) → "담당자 미지정"은 항상 맨 뒤
   * (Step(V1 Fix — 회의록 공통 일정 그룹 분리) 요청사항 5/6). */
  assigneeGroups: AssigneeGroup[];
}

interface SectionDef {
  headingText: string;
  section: NonNullable<WeeklyTaskInfo["meetingReportSection"]>;
  groupKey: (task: WeeklyTaskInfo) => string;
}

const SECTION_DEFS: SectionDef[] = [
  { headingText: "정규 프로젝트", section: "REGULAR_PROJECT", groupKey: (t) => t.projectName?.trim() || t.title },
  { headingText: "서브 프로젝트", section: "SUB_PROJECT", groupKey: (t) => t.goalName?.trim() || t.title },
  { headingText: "예외 업무", section: "EXCEPTION", groupKey: (t) => t.title },
  { headingText: "출장 업무", section: "BUSINESS_TRIP", groupKey: (t) => t.title },
  { headingText: "공통 업무", section: "COMMON", groupKey: (t) => t.title },
];

function formatTaskPeriod(start: Date, due: Date): string {
  return `${format(start, "yyyy.MM.dd")} ~ ${format(due, "yyyy.MM.dd")}`;
}

/** null(담당자 미지정)을 포함해 안정적으로 정렬한다 — assigneeSortKeys에
 * 없는 이름(이론상 없어야 하지만 방어적으로)은 정렬 순서상 맨 뒤로 민다. */
function sortAssigneeKeys(keys: (string | null)[], assigneeSortKeys: Map<string, number>): (string | null)[] {
  const withoutUnassigned = keys.filter((k): k is string => k !== null);
  withoutUnassigned.sort((a, b) => {
    const sa = assigneeSortKeys.get(a) ?? Number.MAX_SAFE_INTEGER;
    const sb = assigneeSortKeys.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b, "ko");
  });
  const result: (string | null)[] = [...withoutUnassigned];
  if (keys.includes(null)) result.push(null); // 담당자 미지정은 항상 맨 뒤
  return result;
}

/** 프로젝트/업무 키 → 그 안의 Task Row 목록을 순서대로 담는 버킷 —
 * "공통" 버킷과 담당자별 버킷이 내부적으로 완전히 같은 모양을 쓴다. */
interface TaskBucket {
  groupOrder: string[];
  groupsByKey: Map<string, SectionTaskRow[]>;
}

function pushIntoBucket(bucket: TaskBucket, projectKey: string, taskRow: SectionTaskRow): void {
  let rows = bucket.groupsByKey.get(projectKey);
  if (!rows) {
    rows = [];
    bucket.groupsByKey.set(projectKey, rows);
    bucket.groupOrder.push(projectKey);
  }
  // 업무명이 같아도 별도 행 — 각 Task가 자기 진행 일정·담당자를 갖는다
  // (요청사항: "동일 프로젝트에 여러 Schedule Task가 있으면 행을 추가한다",
  // "업무명/진행일정/담당자는 같은 행의 한 세트로 유지").
  rows.push(taskRow);
}

function bucketToGroups(bucket: TaskBucket): SectionGroup[] {
  return bucket.groupOrder.map((key) => ({ title: key, tasks: bucket.groupsByKey.get(key)! }));
}

export function buildWeeklySections(tasks: WeeklyTaskInfo[], assigneeSortKeys: Map<string, number>): SectionResult[] {
  return SECTION_DEFS.map((def) => {
    const matched = tasks.filter((t) => t.meetingReportSection === def.section);

    // Step(V1 Fix — 회의록 공통 일정 그룹 분리) — "공통"(isCommonAssignee)
    // Task는 담당자별/미배정 분류 로직을 아예 타지 않고 항상 이 전용
    // 버킷 하나로 간다(요청사항 1/3). Schedule의 assigneeMode=COMMON은
    // 저장 시 TaskAssignee를 만들지 않으므로(resolveAssigneeUserIds) 실제로
    // assigneeNames는 항상 비어 있다 — 그래도 값 자체(isCommonAssignee)로
    // 판별하고 "assigneeNames가 비었으니 미배정"이라고 추정하지 않는다.
    const commonBucket: TaskBucket = { groupOrder: [], groupsByKey: new Map() };
    let hasCommon = false;

    // 담당자별 버킷 — 담당자가 여러 명인 Task는 각 담당자의 버킷에 모두
    // 들어간다(중복 표시 — 위 파일 상단 주석 참고). 담당자가 없고 공통도
    // 아닌 Task만 null(담당자 미지정) 버킷으로 간다.
    const bucketOrder: (string | null)[] = [];
    const buckets = new Map<string | null, TaskBucket>();

    for (const task of matched) {
      const projectKey = def.groupKey(task);
      const taskRow: SectionTaskRow = {
        title: task.title,
        period: formatTaskPeriod(task.startDate, task.dueDate),
        assignees: task.assigneeNames,
      };

      if (task.isCommonAssignee) {
        hasCommon = true;
        pushIntoBucket(commonBucket, projectKey, taskRow);
        continue;
      }

      const assigneeKeys: (string | null)[] = task.assigneeNames.length > 0 ? task.assigneeNames : [null];
      for (const assigneeKey of assigneeKeys) {
        let bucket = buckets.get(assigneeKey);
        if (!bucket) {
          bucket = { groupOrder: [], groupsByKey: new Map() };
          buckets.set(assigneeKey, bucket);
          bucketOrder.push(assigneeKey);
        }
        pushIntoBucket(bucket, projectKey, taskRow);
      }
    }

    const orderedAssigneeKeys = sortAssigneeKeys(bucketOrder, assigneeSortKeys);
    const assigneeGroups: AssigneeGroup[] = [
      // "공통"은 있으면 항상 맨 앞이다(요청사항 5) — 담당자 정렬/미배정
      // 순서와 완전히 무관한 별도 규칙.
      ...(hasCommon ? [{ assigneeName: null, isCommon: true, groups: bucketToGroups(commonBucket) }] : []),
      ...orderedAssigneeKeys.map((assigneeName) => ({
        assigneeName,
        isCommon: false,
        groups: bucketToGroups(buckets.get(assigneeName)!),
      })),
    ];

    return { headingText: def.headingText, section: def.section, assigneeGroups };
  });
}
