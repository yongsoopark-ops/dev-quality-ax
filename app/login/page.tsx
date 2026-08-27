import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm rounded-2xl border border-navy-100 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900">
          <span className="text-sm font-semibold text-white">AX</span>
        </div>
        <h1 className="text-lg font-semibold text-navy-950">개발품질 AX</h1>
        <p className="mt-1 text-sm text-navy-950/60">Development Quality</p>

        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/home" });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-navy-100 bg-white px-4 py-2.5 text-sm font-medium text-navy-950 shadow-sm transition-colors hover:bg-navy-100/40"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4">
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.43 3.58v3h3.93c2.3-2.12 3.52-5.24 3.52-8.82z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.93-3c-1.09.73-2.48 1.16-4 1.16-3.08 0-5.69-2.08-6.62-4.87H1.32v3.09C3.29 21.3 7.31 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.38 14.38A7.2 7.2 0 0 1 5 12c0-.83.14-1.63.38-2.38V6.53H1.32A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.32 5.47l4.06-3.09z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.29 2.7 1.32 6.53l4.06 3.09C6.31 6.83 8.92 4.75 12 4.75z"
              />
            </svg>
            Google로 로그인
          </button>
        </form>
      </div>
    </div>
  );
}
