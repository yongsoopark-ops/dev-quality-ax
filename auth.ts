import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "openid email profile",
        },
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      const email = user.email;
      if (!email) return false;

      const existing = await prisma.user.findUnique({ where: { email } });
      const isInitialAdmin = email === process.env.AX_INITIAL_ADMIN_EMAIL;

      if (!existing) {
        if (!isInitialAdmin) {
          return "/access-denied";
        }
        await prisma.user.create({
          data: {
            email,
            name: user.name,
            role: "ADMIN",
            status: "ACTIVE",
            lastLoginAt: new Date(),
          },
        });
        return true;
      }

      if (existing.status === "DISABLED") {
        return "/access-denied";
      }

      await prisma.user.update({
        where: { email },
        data: {
          status: "ACTIVE",
          lastLoginAt: new Date(),
          name: existing.name ?? user.name,
        },
      });

      return true;
    },
    async jwt({ token }: { token: JWT }) {
      if (!token.email) return token;

      const dbUser = await prisma.user.findUnique({
        where: { email: token.email },
      });

      if (dbUser) {
        token.id = dbUser.id;
        token.role = dbUser.role;
        token.status = dbUser.status;
      }

      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (session.user && token.id) {
        session.user.id = token.id;
        session.user.role = token.role ?? "MEMBER";
        session.user.status = token.status ?? "DISABLED";
      }
      return session;
    },
  },
});
