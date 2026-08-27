import type { DefaultSession } from "next-auth";
import type { Role, UserStatus } from "@/app/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: UserStatus;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    status?: UserStatus;
  }
}
