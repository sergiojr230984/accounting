import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const { handlers, auth: baseAuth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.sub = user.id;
        token.name = user.name ?? null;
        token.email = user.email ?? null;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (!token) return session;

      let role = (token.role as string) ?? "MANAGER";
      const id = (token.id as string) ?? (token.sub as string) ?? "";
      const tokenEmail = ((token.email as string) ?? "").toLowerCase().trim();

      const BUILT_IN_ADMINS = new Set([
        "admin@lacuevita.com",
        "sales@lacuevitafurniture.com",
      ]);

      try {
        let dbUser: { id: string; role: string; email: string } | null = null;
        if (id) {
          dbUser = await prisma.user.findUnique({
            where: { id },
            select: { id: true, role: true, email: true },
          });
        }
        if (!dbUser && tokenEmail) {
          dbUser = await prisma.user.findFirst({
            where: { email: { equals: tokenEmail, mode: "insensitive" } },
            select: { id: true, role: true, email: true },
          });
        }
        if (dbUser?.role) role = dbUser.role;

        const dbEmail = (dbUser?.email ?? tokenEmail).toLowerCase().trim();
        if (dbUser && role !== "ADMIN" && BUILT_IN_ADMINS.has(dbEmail)) {
          await prisma.user
            .update({ where: { id: dbUser.id }, data: { role: "ADMIN" } })
            .catch((e) => console.error("[auth] admin promote failed:", e));
          role = "ADMIN";
        }
      } catch (e) {
        console.error("[auth] session role lookup failed:", e);
      }

      // Mutate session.user in-place — the NextAuth v5-beta App Router path
      // discards a returned replacement object and only picks up mutations on
      // the existing session reference.
      const u = session.user as unknown as Record<string, unknown>;
      u.id    = id;
      u.email = tokenEmail || null;
      u.name  = (token.name as string | null | undefined) ?? null;
      u.image = null;
      u.role  = role;
      return session;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // Throttle both by IP (blocks one source hammering many accounts)
        // and by the submitted email (blocks distributed attempts against
        // one account) before ever touching the database or bcrypt.
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
          request.headers.get("x-real-ip") ||
          "unknown";
        const ipLimit = rateLimit(`login-ip:${ip}`, { windowMs: 15 * 60_000, max: 50 });
        const emailLimit = rateLimit(`login-email:${parsed.data.email.toLowerCase()}`, {
          windowMs: 15 * 60_000,
          max: 10,
        });
        if (!ipLimit.ok || !emailLimit.ok) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user) return null;
        if (user.active === false) return null; // deactivated account

        const valid = await bcrypt.compare(parsed.data.password, user.password);
        if (!valid) return null;

        await prisma.user
          .update({ where: { id: user.id }, data: { lastLogin: new Date() } })
          .catch(() => undefined);

        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
});

/**
 * Wraps NextAuth's own auth(). The session() callback above already
 * re-reads `role` from the database on every call, but NextAuth v5-beta's
 * App Router session handling only picks up in-place mutations to the
 * existing session object -- returning null from that callback (to reject
 * a deactivated user outright) is silently discarded, so `session` itself
 * always comes back truthy once the JWT is validly signed, regardless of
 * what the callback returns. Most routes in this app only check
 * `if (!session)`, not a field within it, so an in-place mutation alone
 * can't revoke a deactivated user's session for those callers. Checking
 * `active` here, on the actual return value every caller receives, closes
 * that gap for all of them in one place instead of editing ~30 routes.
 */
export async function auth(): Promise<Session | null> {
  const session = (await baseAuth()) as Session | null;
  if (!session?.user?.id) return session;
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { active: true },
  });
  if (dbUser?.active === false) return null;
  return session;
}

export { handlers, signIn, signOut };
