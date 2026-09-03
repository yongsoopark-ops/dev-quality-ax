/**
 * 1회성 데이터 이관 스크립트 — 로컬 SQLite 백업 파일의 모든 실제 데이터를
 * Supabase PostgreSQL로 그대로 옮긴다. ID/생성일/수정일을 전부 원본 그대로
 * 보존하며(Prisma의 @default(now())/@updatedAt이 새 값으로 덮어쓰지 않도록
 * 모든 필드를 명시적으로 넘긴다), FK 의존 순서(User → ... → Notification)를
 * 지켜 하나의 트랜잭션 안에서 삽입한다 — 중간에 실패하면 전부 롤백된다.
 *
 * 실행: npx tsx scripts/migrate-to-postgres.ts <sqlite backup 파일 경로>
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

const backupPath = process.argv[2];
if (!backupPath) {
  console.error("사용법: npx tsx scripts/migrate-to-postgres.ts <sqlite backup 파일 경로>");
  process.exit(1);
}

const sqlite = createClient({ url: `file:${backupPath}` });

async function selectAll(table: string): Promise<Record<string, unknown>[]> {
  const res = await sqlite.execute(`SELECT * FROM "${table}"`);
  return res.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    res.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  return new Date(v as string);
}

function toBool(v: unknown): boolean {
  return v === 1 || v === true;
}

async function main() {
  console.log(`SQLite 백업(${backupPath})에서 읽어 Supabase Postgres로 이관합니다...`);

  const [
    users,
    sheetSources,
    sheetRows,
    kpiDefs,
    kpiResults,
    aiUsages,
    dashboardLayouts,
    sidebarLayouts,
    projectCategories,
    tasks,
    taskAssignees,
    taskProjectDetails,
    taskMeetingDetails,
    taskMeetingAttendees,
    taskRevisions,
    taskComments,
    notifications,
  ] = await Promise.all([
    selectAll("User"),
    selectAll("GoogleSheetSource"),
    selectAll("GoogleSheetSourceRow"),
    selectAll("KPIDefinition"),
    selectAll("KPIResult"),
    selectAll("AIUsage"),
    selectAll("DashboardLayout"),
    selectAll("SidebarLayout"),
    selectAll("ProjectCategory"),
    selectAll("Task"),
    selectAll("TaskAssignee"),
    selectAll("TaskProjectDetail"),
    selectAll("TaskMeetingDetail"),
    selectAll("TaskMeetingAttendee"),
    selectAll("TaskScheduleRevision"),
    selectAll("TaskComment"),
    selectAll("Notification"),
  ]);

  console.log(
    JSON.stringify(
      {
        users: users.length,
        sheetSources: sheetSources.length,
        sheetRows: sheetRows.length,
        kpiDefs: kpiDefs.length,
        kpiResults: kpiResults.length,
        aiUsages: aiUsages.length,
        dashboardLayouts: dashboardLayouts.length,
        sidebarLayouts: sidebarLayouts.length,
        projectCategories: projectCategories.length,
        tasks: tasks.length,
        taskAssignees: taskAssignees.length,
        taskProjectDetails: taskProjectDetails.length,
        taskMeetingDetails: taskMeetingDetails.length,
        taskMeetingAttendees: taskMeetingAttendees.length,
        taskRevisions: taskRevisions.length,
        taskComments: taskComments.length,
        notifications: notifications.length,
      },
      null,
      2,
    ),
  );

  await prisma.$transaction(
    async (tx) => {
      for (const u of users) {
        await tx.user.create({
          data: {
            id: u.id as string,
            email: u.email as string,
            name: u.name as string | null,
            role: u.role as never,
            status: u.status as never,
            createdAt: toDate(u.createdAt)!,
            lastLoginAt: toDate(u.lastLoginAt),
            lastActiveAt: toDate(u.lastActiveAt),
            lastHeartbeatAt: toDate(u.lastHeartbeatAt),
          },
        });
      }

      for (const s of sheetSources) {
        await tx.googleSheetSource.create({
          data: {
            id: s.id as string,
            name: s.name as string,
            spreadsheetId: s.spreadsheetId as string,
            spreadsheetUrl: s.spreadsheetUrl as string,
            sheetName: s.sheetName as string,
            headerRow: s.headerRow as number,
            headers: s.headers as string,
            rowCount: s.rowCount as number,
            lastSyncedAt: toDate(s.lastSyncedAt),
            lastModifiedAt: toDate(s.lastModifiedAt),
            syncStatus: s.syncStatus as never,
            syncError: s.syncError as string | null,
            createdBy: s.createdBy as string,
            createdAt: toDate(s.createdAt)!,
            updatedAt: toDate(s.updatedAt)!,
          },
        });
      }

      for (const r of sheetRows) {
        await tx.googleSheetSourceRow.create({
          data: {
            id: r.id as string,
            sourceId: r.sourceId as string,
            rowIndex: r.rowIndex as number,
            data: r.data as string,
            contentHash: r.contentHash as string,
            updatedAt: toDate(r.updatedAt)!,
          },
        });
      }

      for (const k of kpiDefs) {
        await tx.kPIDefinition.create({
          data: {
            id: k.id as string,
            name: k.name as string,
            sourceId: k.sourceId as string,
            metricType: k.metricType as never,
            filterConfig: k.filterConfig as string,
            denominatorFilterConfig: k.denominatorFilterConfig as string | null,
            groupByHeader: k.groupByHeader as string | null,
            sumHeader: k.sumHeader as string | null,
            dateHeader: k.dateHeader as string | null,
            chartType: k.chartType as never,
            displayOrder: k.displayOrder as number,
            enabled: toBool(k.enabled),
            createdBy: k.createdBy as string,
            createdAt: toDate(k.createdAt)!,
            updatedAt: toDate(k.updatedAt)!,
          },
        });
      }

      for (const r of kpiResults) {
        await tx.kPIResult.create({
          data: {
            id: r.id as string,
            kpiId: r.kpiId as string,
            value: r.value as number | null,
            resultData: r.resultData as string,
            calculatedAt: toDate(r.calculatedAt)!,
            sourceSyncedAt: toDate(r.sourceSyncedAt),
          },
        });
      }

      for (const a of aiUsages) {
        await tx.aIUsage.create({
          data: {
            id: a.id as string,
            userId: a.userId as string,
            projectId: a.projectId as string | null,
            taskType: a.taskType as never,
            provider: a.provider as never,
            model: a.model as string,
            inputTokens: a.inputTokens as number,
            outputTokens: a.outputTokens as number,
            cacheReadTokens: a.cacheReadTokens as number,
            cacheWriteTokens: a.cacheWriteTokens as number,
            calculatedCostUsd: a.calculatedCostUsd as number | null,
            status: a.status as never,
            errorCode: a.errorCode as string | null,
            createdAt: toDate(a.createdAt)!,
          },
        });
      }

      for (const d of dashboardLayouts) {
        await tx.dashboardLayout.create({
          data: {
            id: d.id as string,
            key: d.key as string,
            layoutData: d.layoutData as string,
            updatedBy: d.updatedBy as string,
            createdAt: toDate(d.createdAt)!,
            updatedAt: toDate(d.updatedAt)!,
          },
        });
      }

      for (const s of sidebarLayouts) {
        await tx.sidebarLayout.create({
          data: {
            id: s.id as string,
            key: s.key as string,
            layoutData: s.layoutData as string,
            updatedBy: s.updatedBy as string,
            createdAt: toDate(s.createdAt)!,
            updatedAt: toDate(s.updatedAt)!,
          },
        });
      }

      // Step 5B-5(프로젝트 카테고리 2단계 계층화) — groupId가 새 필수 컬럼이
      // 됐다. SQLite 백업에는 대분류 개념이 없으므로(이 스크립트가 다시
      // 실행될 일은 없지만 컴파일이 깨지지 않도록), migration의 기본 "미분류"
      // Group을 이름으로 찾아 그대로 배치한다 — 실제 이관 대상 데이터는 이미
      // Supabase에 있으므로 이 분기가 실행될 일은 없다.
      let defaultGroupId: string | null = null;
      if (projectCategories.length > 0) {
        const defaultGroup = await tx.projectCategoryGroup.findFirst({ where: { name: "미분류" } });
        if (!defaultGroup) throw new Error('"미분류" ProjectCategoryGroup을 찾을 수 없습니다 — 먼저 schedule_custom_options 계열 migration이 적용됐는지 확인하세요.');
        defaultGroupId = defaultGroup.id;
      }

      for (const c of projectCategories) {
        await tx.projectCategory.create({
          data: {
            id: c.id as string,
            name: c.name as string,
            active: toBool(c.active),
            groupId: defaultGroupId!,
            createdAt: toDate(c.createdAt)!,
            updatedAt: toDate(c.updatedAt)!,
          },
        });
      }

      for (const t of tasks) {
        await tx.task.create({
          data: {
            id: t.id as string,
            title: t.title as string,
            category: t.category as never,
            // Step 5B-4(사용자 정의 상태/업무구분) — categoryOptionId/
            // statusOptionId가 새 필수 컬럼이 됐다. 이 1회성 스크립트가 다시
            // 실행될 일은 없지만(SQLite 원본은 이미 이관 완료), 컴파일이
            // 깨지지 않도록 예전 enum 값과 동일한 문자열을 그대로 넣는다 —
            // 시스템 예약 7종/4종은 TaskCategoryOption/TaskStatusOption의 id도
            // 이 문자열과 같게 seed돼 있어(prisma migration) FK가 그대로 맞는다.
            categoryOptionId: t.category as string,
            statusOptionId: t.status as string,
            startDate: toDate(t.startDate)!,
            dueDate: toDate(t.dueDate)!,
            status: t.status as never,
            memo: t.memo as string | null,
            createdBy: t.createdBy as string,
            createdAt: toDate(t.createdAt)!,
            updatedAt: toDate(t.updatedAt)!,
            goalName: t.goalName as string | null,
            nextTaskName: t.nextTaskName as string | null,
            nextTaskStartDate: toDate(t.nextTaskStartDate),
            nextTaskDueDate: toDate(t.nextTaskDueDate),
            halfDayPeriod: t.halfDayPeriod as string | null,
            lastRevisionNo: t.lastRevisionNo as number,
          },
        });
      }

      for (const a of taskAssignees) {
        await tx.taskAssignee.create({
          data: {
            id: a.id as string,
            taskId: a.taskId as string,
            userId: a.userId as string,
            createdAt: toDate(a.createdAt)!,
          },
        });
      }

      for (const d of taskProjectDetails) {
        await tx.taskProjectDetail.create({
          data: {
            taskId: d.taskId as string,
            projectName: d.projectName as string,
            pwStage: d.pwStage as string | null,
            categoryId: d.categoryId as string | null,
          },
        });
      }

      for (const d of taskMeetingDetails) {
        await tx.taskMeetingDetail.create({
          data: {
            taskId: d.taskId as string,
            department: d.department as string | null,
            time: toDate(d.time),
            location: d.location as string | null,
          },
        });
      }

      for (const a of taskMeetingAttendees) {
        await tx.taskMeetingAttendee.create({
          data: {
            id: a.id as string,
            meetingTaskId: a.meetingTaskId as string,
            userId: a.userId as string,
          },
        });
      }

      for (const r of taskRevisions) {
        await tx.taskScheduleRevision.create({
          data: {
            id: r.id as string,
            taskId: r.taskId as string,
            revisionNo: r.revisionNo as number,
            startDate: toDate(r.startDate)!,
            dueDate: toDate(r.dueDate)!,
            reasonText: r.reasonText as string | null,
            createdBy: r.createdBy as string,
            createdAt: toDate(r.createdAt)!,
            updatedAt: toDate(r.updatedAt)!,
          },
        });
      }

      // 자기참조(parentId) FK 순서 보장 — 원문(parentId IS NULL)을 답변보다 먼저 넣는다.
      const sortedComments = [...taskComments].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
      for (const c of sortedComments) {
        await tx.taskComment.create({
          data: {
            id: c.id as string,
            taskId: c.taskId as string,
            authorId: c.authorId as string,
            parentId: c.parentId as string | null,
            contentJson: c.contentJson as string,
            plainText: c.plainText as string,
            createdAt: toDate(c.createdAt)!,
            updatedAt: toDate(c.updatedAt)!,
          },
        });
      }

      for (const n of notifications) {
        await tx.notification.create({
          data: {
            id: n.id as string,
            userId: n.userId as string,
            type: n.type as never,
            taskId: n.taskId as string | null,
            commentId: n.commentId as string | null,
            actorId: n.actorId as string | null,
            title: n.title as string,
            message: n.message as string,
            isRead: toBool(n.isRead),
            createdAt: toDate(n.createdAt)!,
            readAt: toDate(n.readAt),
          },
        });
      }
    },
    { timeout: 60_000 },
  );

  console.log("이관 완료.");
  await prisma.$disconnect();
  sqlite.close();
}

main().catch(async (e) => {
  console.error("이관 실패 — 트랜잭션 전체가 롤백되었습니다:", e);
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    console.error("code:", e.code, "meta:", e.meta);
  }
  await prisma.$disconnect();
  process.exit(1);
});
