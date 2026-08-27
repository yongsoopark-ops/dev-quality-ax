"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { extractSpreadsheetId } from "@/lib/googleSheets";
import { syncGoogleSheetSource } from "@/lib/googleSheetSync";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return session;
}

export async function createSourceAction(formData: FormData) {
  const session = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const sheetName = String(formData.get("sheetName") ?? "").trim();
  const headerRow = Math.max(1, Number(formData.get("headerRow") ?? 1) || 1);

  const spreadsheetId = extractSpreadsheetId(url);
  if (!name || !spreadsheetId || !sheetName) return;

  const source = await prisma.googleSheetSource.create({
    data: {
      name,
      spreadsheetId,
      spreadsheetUrl: url,
      sheetName,
      headerRow,
      syncStatus: "SYNCING",
      createdBy: session.user.id,
    },
  });

  await syncGoogleSheetSource(source.id).catch(() => {});

  revalidatePath("/admin/sources");
}

export async function refreshSourceAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await syncGoogleSheetSource(id).catch(() => {});

  revalidatePath("/admin/sources");
}

export async function deleteSourceAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.googleSheetSource.delete({ where: { id } });

  revalidatePath("/admin/sources");
}
