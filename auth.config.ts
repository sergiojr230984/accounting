import type { NextAuthConfig } from "next-auth";

/**
 * Lightweight auth config — safe for the Next.js middleware runtime.
 * No bcrypt, no Prisma, no Node.js-only imports.
 * lib/auth.ts spreads this and adds the full Credentials provider.
 */
export const authConfig = {
  // Railway (and most PaaS) terminate TLS in front of the app and proxy over
  // an internal host, so NextAuth's own Host-header check must be disabled —
  // otherwise every request 500s with "UntrustedHost".
  trustHost: true,
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
