import type { Role, TaskCategory, TaskStatus } from "@/app/generated/prisma/enums";
import type { RecurrenceRule, Weekday } from "@/lib/schedule/recurrence";

export interface ScheduleUser {
  id: string;
  name: string | null;
  email: string;
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
  category: TaskCategory;
  /** "최신 유효 일정" — Revision이 있으면 최신 Revision, 없으면 원본(Task 컬럼)과
   * 동일하다. Calendar/Drag/Resize는 항상 이 값만 본다. */
  startDate: string;
  dueDate: string;
  /** Task 원본(불변) — "+ 일정 변경"이 생겨도 절대 덮어쓰지 않는 "최초 일정" 표시용.
   * Task Modal을 열기 전까지는 startDate/dueDate와 같은 임시값이다. */
  originalStartDate: string;
  originalDueDate: string;
  status: TaskStatus;
  memo: string | null;
  goalName: string | null;
  halfDayPeriod: string | null;
  /** Week View 담당자 Swimlane 배치에 쓴다 — 신규 생성 시 로그인 계정으로 자동 지정된다. */
  assigneeIds: string[];
  /** projectName은 Calendar Title 생성에 필요해 초기 조회에도 항상 포함되지만,
   * categoryId는 Task Modal을 열 때만(getTaskDetailAction) 채워진다 — 그 전까지 null. */
  projectDetail: { projectName: string; categoryId: string | null } | null;
  meetingDetail: {
    department: string | null;
    time: string | null;
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
    location: string | null;
    attendeeIds: string[];
  } | null;
  scheduleRevisions: TaskScheduleRevisionInfo[];
}

/**
 * Task Form(생성/수정 공용)이 Server Action으로 그대로 넘기는 입력 모양. 담당자는
 * 더 이상 Client가 지정하지 않는다(요청사항 7) — 생성 시 서버가 로그인 계정으로
 * 자동 지정하고, 수정 화면에서도 담당자 변경 UI를 두지 않는다.
 */
export interface TaskFormInput {
  title: string;
  category: TaskCategory;
  startDate: string;
  dueDate: string;
  status: TaskStatus;
  memo: string;
  goalName: string;
  halfDayPeriod: string;
  projectName: string;
  categoryId: string;
  department: string;
  attendeeIds: string[];
  meetingDate: string;
  meetingStartTime: string;
  location: string;
  /** Step 5B-1(반복 일정) — 기본값 "NONE"(반복 없음, 기존과 동일). Form 입력
   * 편의를 위해 monthDay/monthlyWeekOrdinal은 문자열로 두고(select value), 실제
   * 저장 직전(actions.ts)에 숫자로 변환한다. */
  recurrenceType: "NONE" | "WEEKLY" | "MONTHLY";
  recurrenceWeekdays: Weekday[];
  recurrenceMonthlyRuleType: "DAY_OF_MONTH" | "NTH_WEEKDAY";
  recurrenceMonthDay: string;
  recurrenceMonthlyWeekOrdinal: string;
  recurrenceMonthlyWeekday: Weekday;
  /** ""이면 종료일 없음(무기한 반복). */
  recurrenceEndDate: string;
}
