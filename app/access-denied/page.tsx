import { signOut } from "@/auth";

export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm rounded-2xl border border-navy-100 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900">
          <span className="text-sm font-semibold text-white">AX</span>
        </div>
        <h1 className="text-lg font-semibold text-navy-950">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-navy-950/60">
          이 계정은 개발품질 AX에 등록되어 있지 않거나 비활성화되었습니다.
          관리자에게 계정 등록을 요청해 주세요.
        </p>

        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg border border-navy-100 bg-white px-4 py-2.5 text-sm font-medium text-navy-950 shadow-sm transition-colors hover:bg-navy-100/40"
          >
            다른 계정으로 로그인
          </button>
        </form>
      </div>
    </div>
  );
}
