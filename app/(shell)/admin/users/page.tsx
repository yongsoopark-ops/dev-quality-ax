import { prisma } from "@/lib/prisma";
import { addUserAction, updateRoleAction, updateStatusAction } from "./actions";

export default async function AdminUsersPage() {
  // 전역 성능 Step(select 최소화): 화면에 실제로 쓰는 필드만 가져온다.
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
  });

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-navy-950">사용자 관리</h1>
      <p className="mt-1 text-sm text-navy-950/60">
        개발품질 AX에 접근 가능한 계정을 등록하고 권한을 관리합니다.
      </p>

      <form
        action={addUserAction}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-navy-100 p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60" htmlFor="email">
            이메일
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="user@example.com"
            className="rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-950/60" htmlFor="name">
            이름 (선택)
          </label>
          <input
            id="name"
            name="name"
            type="text"
            className="rounded-md border border-navy-100 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white"
        >
          사용자 추가
        </button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-xl border border-navy-100">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-navy-100/40 text-xs text-navy-950/60">
            <tr>
              <th className="px-4 py-2 font-medium">이름</th>
              <th className="px-4 py-2 font-medium">이메일</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">가입일</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-navy-100">
                <td className="px-4 py-2">{user.name ?? "-"}</td>
                <td className="px-4 py-2">{user.email}</td>
                <td className="px-4 py-2">
                  <form
                    action={updateRoleAction}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={user.id} />
                    <select
                      name="role"
                      defaultValue={user.role}
                      className="rounded-md border border-navy-100 px-2 py-1 text-xs"
                    >
                      <option value="MEMBER">MEMBER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                    <button
                      type="submit"
                      className="rounded-md border border-navy-100 px-2 py-1 text-xs transition-colors hover:bg-navy-100/40"
                    >
                      변경
                    </button>
                  </form>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{user.status}</span>
                    <form action={updateStatusAction}>
                      <input type="hidden" name="id" value={user.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={user.status === "DISABLED" ? "ACTIVE" : "DISABLED"}
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-navy-100 px-2 py-1 text-xs transition-colors hover:bg-navy-100/40"
                      >
                        {user.status === "DISABLED" ? "활성화" : "비활성화"}
                      </button>
                    </form>
                  </div>
                </td>
                <td className="px-4 py-2 text-navy-950/60">
                  {user.createdAt.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
