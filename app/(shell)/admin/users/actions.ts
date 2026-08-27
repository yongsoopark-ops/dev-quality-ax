"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return session;
}

export async function addUserAction(formData: FormData) {
  await requireAdmin();

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!email) return;

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: name || null,
      role: "MEMBER",
      status: "INVITED",
    },
  });

  revalidatePath("/admin/users");
}

export async function updateRoleAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!id || (role !== "ADMIN" && role !== "MEMBER")) return;

  await prisma.user.update({ where: { id }, data: { role } });

  revalidatePath("/admin/users");
}

export async function updateStatusAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || (status !== "ACTIVE" && status !== "DISABLED")) return;

  await prisma.user.update({ where: { id }, data: { status } });

  revalidatePath("/admin/users");
}
