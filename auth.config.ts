import type { NextAuthConfig } from "next-auth";

/**
 * Lightweight auth config — safe for the Next.js middleware runtime.
 * No bcrypt, no Prisma, no Node.js-only imports.
 * lib/auth.ts spreads this and adds the full Credentials provider.
 */
export const authConfig = {
  session: { strategy: "jwt" as const },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Disable NextAuth's built-in auto-redirect; our middleware callback handles all routing.
    authorized: () => true,
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session?.user) {
        session.user.id = ((token.id ?? token.sub) as string) ?? "";
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
