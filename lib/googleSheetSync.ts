import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSheetValues, getSpreadsheetMetadata } from "@/lib/googleSheets";
import { recalculateKpisForSource } from "@/lib/kpiEngine";

function hashRow(row: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

/**
 * Google Sheet의 최신 데이터를 조회해 내부 캐시(GoogleSheetSourceRow)와 비교하고,
 * 변경된 행만 갱신한다. KPI 등 다른 기능은 이 캐시만 읽으면 되므로
 * 소스별로 Google API를 반복 호출할 필요가 없다.
 */
export async function syncGoogleSheetSource(sourceId: string) {
  const source = await prisma.googleSheetSource.findUniqueOrThrow({
    where: { id: sourceId },
  });

  await prisma.googleSheetSource.update({
    where: { id: sourceId },
    data: { syncStatus: "SYNCING" },
  });

  try {
    const metadata = await getSpreadsheetMetadata(source.spreadsheetId);
    if (!metadata.sheetNames.includes(source.sheetName)) {
      throw new Error(`시트 "${source.sheetName}"를 찾을 수 없습니다.`);
    }

    const { headers, rows } = await getSheetValues(
      source.spreadsheetId,
      source.sheetName,
      source.headerRow,
    );

    const existingRows = await prisma.googleSheetSourceRow.findMany({
      where: { sourceId },
    });
    const existingByIndex = new Map(existingRows.map((row) => [row.rowIndex, row]));

    let changed = false;
    const seenIndexes = new Set<number>();

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      seenIndexes.add(rowIndex);

      const record: Record<string, string> = {};
      headers.forEach((header, colIndex) => {
        if (header) record[header] = rows[rowIndex][colIndex] ?? "";
      });
      const contentHash = hashRow(record);
      const existing = existingByIndex.get(rowIndex);

      if (!existing) {
        await prisma.googleSheetSourceRow.create({
          data: {
            sourceId,
            rowIndex,
            data: JSON.stringify(record),
            contentHash,
          },
        });
        changed = true;
      } else if (existing.contentHash !== contentHash) {
        await prisma.googleSheetSourceRow.update({
          where: { id: existing.id },
          data: { data: JSON.stringify(record), contentHash },
        });
        changed = true;
      }
    }

    const staleRows = existingRows.filter((row) => !seenIndexes.has(row.rowIndex));
    if (staleRows.length > 0) {
      await prisma.googleSheetSourceRow.deleteMany({
        where: { id: { in: staleRows.map((row) => row.id) } },
      });
      changed = true;
    }

    const now = new Date();
    await prisma.googleSheetSource.update({
      where: { id: sourceId },
      data: {
        headers: JSON.stringify(headers.filter(Boolean)),
        rowCount: rows.length,
        syncStatus: "CONNECTED",
        syncError: null,
        lastSyncedAt: now,
        lastModifiedAt: changed ? now : source.lastModifiedAt,
      },
    });

    // Source 동기화가 성공하면 이 Source를 참조하는 KPI만 캐시 데이터로 재계산한다.
    // 다른 Source의 KPI, Google API 호출은 발생하지 않는다.
    await recalculateKpisForSource(sourceId).catch(() => {});
  } catch (err) {
    await prisma.googleSheetSource.update({
      where: { id: sourceId },
      data: {
        syncStatus: "ERROR",
        syncError: err instanceof Error ? err.message : "알 수 없는 오류",
      },
    });
    throw err;
  }
}
