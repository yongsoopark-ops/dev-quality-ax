import type { Role } from "@/app/generated/prisma/enums";
import type { RecurrenceRule, Weekday } from "@/lib/schedule/recurrence";

export interface ScheduleUser {
  id: string;
  name: string | null;
  email: string;
}

/** Step 5B-4(사용자 정의 상태/업무구분) — TaskCategoryOption/TaskStatusOption
 * 조회 결과가 Client로 내려가는 모양. 둘 다 필드가 완전히 같아 하나의 타입을
 * 공유한다. id는 시스템 예약 7종/4종은 "PROJECT"처럼 고정 문자열, 사용자가
 * 새로 추가한 옵션은 cuid다 — 어느 쪽이든 Task.categoryOptionId/statusOptionId가
 * 그대로 참조한다. */
export interface ScheduleOptionInfo {
  id: string;
  label: string;
  color: string;
  order: number;
  active: boolean;
}

/** 로그인한 현재 User — Update/Reply/Revision의 수정·삭제 버튼을 보여줄지
 * Client에서 판단하는 데만 쓴다("작성자 본인 또는 ADMIN"). 실제 권한 검증은
 * 항상 Server Action이 Session에서 다시 확인한다(요청사항 27) — 이 값을 그대로
 * 서버에 believe-worthy한 근거로 보내는 곳은 없다. */
export interface ScheduleCurrentUser {
  id: string;
  role: Role;
}

export interface ProjectCategoryOption {
  id: string;
  name: string;
  active: boolean;
  /** Step 5B-4(색상 관리) — 기존 Row는 마이그레이션 기본값(중립 회색)으로 채워진다. */
  color: string;
  /** Step 5B-4(Drag & Drop 순서) — 기존 Row는 전부 0으로 시작한다. */
  order: number;
  /** Step 5B-5(2단계 계층화) — 이 중분류가 속한 대분류(ProjectCategoryGroup.id).
   * Task는 이 categoryId만 저장하고 groupId는 저장하지 않는다 — 대분류는
   * 항상 이 필드로 역산한다(요청사항: "Task에 별도로 대분류 값을 중복 저장할
   * 필요는 없다"). */
  groupId: string;
}

/** Step 5B-5(프로젝트 카테고리 2단계 계층화) — "대분류". ProjectCategoryOption과
 * 필드 이름 스타일(label 대신 name)을 맞춘다 — 같은 계층의 형제 개념이라서다. */
export interface ProjectCategoryGroupOption {
  id: string;
  name: string;
  order: number;
  active: boolean;
}

/** 메모 하단 "일정 변경 이력"과 + 일정 변경 블록에 그대로 쓰는, 공식 일정 변경 1건. */
export interface TaskScheduleRevisionInfo {
  id: string;
  revisionNo: number;
  startDate: string;
  dueDate: string;
  /** 공식 변경 사유 — "+ 일정 변경" 입력 블록에서만 채워진다(Drag/Resize는 절대
   * 건드리지 않는다). 이 기능 이전 Revision이나 아직 입력하지 않은 경우 null. */
  reasonText: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

/**
 * Task 상세의 말풍선형 Comment/Update 1건. parentId가 null이면 원문(최상위)이고,
 * 값이 있으면 그 Comment에 달린 답변이다 — 답변은 1단계로 제한되어(답변의 답변
 * 없음) replies는 항상 최상위 Comment에만 채워진다.
 */
export interface TaskCommentInfo {
  id: string;
  authorId: string;
  authorName: string | null;
  parentId: string | null;
  /** Tiptap JSON Document를 그대로 문자열로 저장한 것 — 읽기 전용 렌더링에 쓴다. */
  contentJson: string;
  /** contentJson과 같은 내용의 순수 텍스트 — 목록 미리보기/검색용. */
  plainText: string;
  createdAt: string;
  updatedAt: string;
  replies: TaskCommentInfo[];
}

/**
 * page.tsx가 Prisma Task(+관계)를 Client Component에 넘기기 전 만드는 직렬화
 * 가능한 모양. 성능 개선(초기 /schedule 조회 경량화)에 따라 이 shape 전체가
 * 처음부터 채워져 오지 않는다 — page.tsx의 초기 목록 조회는 Calendar/Filter가
 * 실제로 쓰는 필드만 채우고, 아래 필드들은 "가벼운 기본값"으로 시작해 필요한
 * 시점에만 lazy load로 채워진다(기존 코드가 그대로 쓸 수 있도록 shape 자체는
 * 유지하고, 값을 채우는 시점만 나눈다):
 *
 * - memo/halfDayPeriod/originalStartDate/originalDueDate/projectDetail.categoryId/
 *   meetingDetail/scheduleRevisions: Task Modal을 열 때 getTaskDetailAction으로
 *   채워진다(그 전까지는 originalStartDate/DueDate=startDate/dueDate와 동일한
 *   임시값, 나머지는 null/[] 기본값).
 * - comments: Update Modal을 열 때 getTaskCommentsAction으로 채워진다(그 전까지는
 *   []) — "💬 업데이트 N" 배지는 그 전까지 아래 commentCount(가벼운 _count 조회)를
 *   대신 쓴다.
 */
export interface TaskWithRelations {
  id: string;
  title: string;
  /** Step 5B-4부터 TaskCategoryOption.id(시스템 예약 7종은 "PROJECT" 같은
   * 고정 문자열, 사용자가 추가한 업무구분은 cuid). 예전엔 Prisma TaskCategory
   * enum이었지만, 사용자가 새 업무구분을 추가할 수 있어야 해서(고정 enum은
   * 런타임에 값을 늘릴 수 없다) 문자열로 바뀌었다 — lib/schedule/constants.ts의
   * TASK_CATEGORY_KEY로 예약 7종만 비교한다. */
  category: string;
  /** "최신 유효 일정" — Revision이 있으면 최신 Revision, 없으면 원본(Task 컬럼)과
   * 동일하다. Calendar/Drag/Resize는 항상 이 값만 본다. */
  startDate: string;
  dueDate: string;
  /** Task 원본(불변) — "+ 일정 변경"이 생겨도 절대 덮어쓰지 않는 "최초 일정" 표시용.
   * Task Modal을 열기 전까지는 startDate/dueDate와 같은 임시값이다. */
  originalStartDate: string;
  originalDueDate: string;
  /** Step 5B-4부터 TaskStatusOption.id — category와 동일한 이유로 문자열이다. */
  status: string;
  memo: string | null;
  goalName: string | null;
  halfDayPeriod: string | null;
  /** Week View 담당자 Swimlane 배치에 쓴다 — 신규 생성 시 기본값은 로그인
   * 계정이지만(내 일정), 담당 방식(내 일정/공통/직접 지정)에 따라 달라진다. */
  assigneeIds: string[];
  /** Step(담당자 UX 개선) — "공통"(의도적으로 특정 개인 담당자 없음)과
   * "담당자 미지정"(assigneeIds가 비어 있지만 그 의미가 없는 예외 상태)을
   * 구분하는 필드. assigneeIds.length === 0 인 Task를 Week View에서 어느
   * row(공통 vs 미배정)에 넣을지 이 값으로 판단한다. */
  isCommonAssignee: boolean;
  /** projectName은 Calendar Title 생성에 필요해 초기 조회에도 항상 포함되지만,
   * categoryId는 Task Modal을 열 때만(getTaskDetailAction) 채워진다 — 그 전까지 null. */
  projectDetail: { projectName: string; categoryId: string | null } | null;
  meetingDetail: {
    department: string | null;
    time: string | null;
    /** Step 5B-7(시작/종료시간) — 회차별 자동 상태 계산에 쓴다. time과 함께
     * 초기 조회에도 항상 포함된다(department/location/attendeeIds와 달리
     * Calendar가 모든 MEETING 회차의 상태를 매번 계산해야 하므로). */
    endTime: string | null;
    location: string | null;
    attendeeIds: string[];
  } | null;
  /** revisionNo 오름차순(1차, 2차, ...) — 마지막 원소가 항상 최신 Revision이다. */
  scheduleRevisions: TaskScheduleRevisionInfo[];
  /** 최상위 Comment만(오래된 순) — 각 원소의 replies에 그 답변들이 들어있다. */
  comments: TaskCommentInfo[];
  /** Update/Reply를 합친 총 개수 — 초기 조회 시 Prisma `_count`(가벼운 COUNT만,
   * 본문/작성자 조인 없음)로 채워진다. Update Modal을 한 번이라도 열어
   * comments가 실제로 채워지면 그 이후에는 comments 기준으로 다시 계산한다. */
  commentCount: number;
  /** Step 5B-1(반복 일정) — recurrenceType이 "NONE"이면 기존과 동일한 1회성
   * 일정이다. scalar 필드라 가벼워 다른 lazy 필드와 달리 초기 조회에 항상
   * 포함된다(Calendar가 모든 Task를 대상으로 매번 반복 회차를 계산해야 하므로). */
  recurrence: RecurrenceRule;
}

/** Task Modal을 열 때 getTaskDetailAction으로 조회하는 Lazy 상세 — TaskWithRelations의
 * 일부 필드와 정확히 대응된다. */
export interface TaskDetailInfo {
  originalStartDate: string;
  originalDueDate: string;
  memo: string | null;
  halfDayPeriod: string | null;
  projectDetail: { projectName: string; categoryId: string | null } | null;
  meetingDetail: {
    department: string | null;
    time: string | null;
    endTime: string | null;
    location: string | null;
    attendeeIds: string[];
  } | null;
  scheduleRevisions: TaskScheduleRevisionInfo[];
}

/** Step(담당자 UX 개선) — "내 일정"(로그인 사용자 자동 담당) / "공통"(특정
 * 개인 담당자 없음) / "직접 지정"(1명 또는 복수 담당자 선택) 3가지. DB에는
 * ME/CUSTOM 구분이 별도로 저장되지 않는다(둘 다 결국 assigneeIds로 귀결) —
 * isCommonAssignee만 저장되고, ME/CUSTOM은 저장 시점에 "누구를 선택했는가"의
 * UI 표현 차이일 뿐이다. */
export type AssigneeMode = "ME" | "COMMON" | "CUSTOM";

/**
 * Task Form(생성/수정 공용)이 Server Action으로 그대로 넘기는 입력 모양.
 */
export interface TaskFormInput {
  title: string;
  /** TaskCategoryOption.id — TaskWithRelations.category 주석 참고. */
  category: string;
  startDate: string;
  dueDate: string;
  /** TaskStatusOption.id — TaskWithRelations.status 주석 참고. */
  status: string;
  memo: string;
  goalName: string;
  halfDayPeriod: string;
  projectName: string;
  categoryId: string;
  department: string;
  attendeeIds: string[];
  meetingDate: string;
  meetingStartTime: string;
  /** Step 5B-7(시작/종료 시간) — 시작 시간과 짝을 이루는 종료 시간. 회차별
   * 자동 상태 계산과 "종료 시간은 시작 시간보다 이후여야 함" 검증에 쓰인다. */
  meetingEndTime: string;
  location: string;
  /** Step(담당자 UX 개선) — "내 일정/공통/직접 지정" 선택. CUSTOM일 때만
   * assigneeIds를 실제로 사용한다("내 일정"은 서버가 항상 로그인 사용자로
   * 강제, "공통"은 항상 빈 배열 + isCommonAssignee=true). */
  assigneeMode: AssigneeMode;
  assigneeIds: string[];
  /** Step 5B-1(반복 일정) — 기본값 "NONE"(반복 없음, 기존과 동일). Form 입력
   * 편의를 위해 monthDay/monthlyWeekOrdinal/interval/count는 문자열로 두고
   * (select/input value), 실제 저장 직전(actions.ts)에 숫자로 변환한다.
   * Step(반복 일정 UX 개선)에서 DAILY/YEARLY를 추가했다. */
  recurrenceType: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  /** DAILY/WEEKLY/MONTHLY/YEARLY 공용 — "N일/주/개월/년마다"의 N. 항상
   * 1 이상의 정수 문자열이어야 한다(빈 문자열이면 저장 시 1로 취급). */
  recurrenceInterval: string;
  recurrenceWeekdays: Weekday[];
  recurrenceMonthlyRuleType: "DAY_OF_MONTH" | "NTH_WEEKDAY";
  recurrenceMonthDay: string;
  recurrenceMonthlyWeekOrdinal: string;
  recurrenceMonthlyWeekday: Weekday;
  /** 반복 종료 조건 선택 — "종료일 지정/N회 반복/무한 반복" 중 하나. 실제
   * 저장되는 값(recurrenceEndDate/recurrenceCount)은 이 값에 따라 서버가
   * 한쪽만 채운다. */
  recurrenceEndType: "NONE" | "DATE" | "COUNT";
  /** ""이면 종료일 없음. recurrenceEndType이 "DATE"일 때만 쓰인다. */
  recurrenceEndDate: string;
  /** recurrenceEndType이 "COUNT"일 때만 쓰인다 — 양의 정수 문자열. */
  recurrenceCount: string;
}
