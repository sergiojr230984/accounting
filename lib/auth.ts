import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

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
