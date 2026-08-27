import { prisma } from "@/lib/prisma";
import {
  createSourceAction,
  deleteSourceAction,
  refreshSourceAction,
} from "./actions";

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: "CONNECTED",
  SYNCING: "SYNCING",
  ERROR: "ERROR",
};

const STATUS_CLASS: Record<string, string> = {
  CONNECTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  SYNCING: "bg-amber-50 text-amber-700 border-amber-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
};

function formatDateTime(date: Date | null) {
  if (!date) return "-";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export default async function AdminSourcesPage() {
  const sources = await prisma.googleSheetSource.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-navy-950">데이터 소스</h1>
      <p className="mt-1 text-sm text-navy-950/60">
        Google Sheet를 등록하고 동기화하면, 이후 여러 기능이 이 캐시 데이터를
        재사용합니다. Google Sheet 조회는 등록 시점과 Refresh를 눌렀을 때만
        발생합니다.
      </p>

      <form
        action={createSourceAction}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-navy-100 p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60" htmlFor="name">
            Source 이름
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="예: 품질 이슈 대장"
            className="rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60" htmlFor="url">
            Google Sheet URL
          </label>
          <input
            id="url"
            name="url"
            type="url"
            required
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-72 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60" htmlFor="sheetName">
            Sheet 이름
          </label>
          <input
            id="sheetName"
            name="sheetName"
            type="text"
            required
            placeholder="예: Sheet1"
            className="w-32 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60" htmlFor="headerRow">
            Header 행
          </label>
          <input
            id="headerRow"
            name="headerRow"
            type="number"
            min={1}
            defaultValue={1}
            className="w-20 rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white"
        >
          Source 등록
        </button>
      </form>

      <div className="mt-6 space-y-4">
        {sources.length === 0 && (
          <p className="text-sm text-navy-950/50">
            등록된 데이터 소스가 없습니다.
          </p>
        )}

        {sources.map((source) => {
          const headers: string[] = (() => {
            try {
              return JSON.parse(source.headers) as string[];
            } catch {
              return [];
            }
          })();

          return (
            <div
              key={source.id}
              className="rounded-xl border border-navy-100 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-navy-950">
                      {source.name}
                    </h2>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[source.syncStatus]}`}
                    >
                      {STATUS_LABEL[source.syncStatus]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-navy-950/50">
                    시트: {source.sheetName} · 행 {source.rowCount}개 ·
                    마지막 동기화: {formatDateTime(source.lastSyncedAt)}
                  </p>
                  <a
                    href={source.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-navy-950/40 underline"
                  >
                    {source.spreadsheetUrl}
                  </a>
                  {source.syncError && (
                    <p className="mt-1 text-xs text-red-600">
                      {source.syncError}
                    </p>
                  )}
                  {headers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {headers.map((header) => (
                        <span
                          key={header}
                          className="rounded-full bg-navy-100/60 px-2 py-0.5 text-[11px] text-navy-950/70"
                        >
                          {header}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <form action={refreshSourceAction}>
                    <input type="hidden" name="id" value={source.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-navy-100/40"
                    >
                      Refresh
                    </button>
                  </form>
                  <form action={deleteSourceAction}>
                    <input type="hidden" name="id" value={source.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-navy-100 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </form>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
