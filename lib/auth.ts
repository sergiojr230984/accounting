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
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      // Force-rebuild session.user from the JWT every call. NextAuth v5-beta
      // sometimes hands back a session without (or with an immutable empty)
      // user object, so we return a brand-new object rather than mutating.
      if (!token) return session;

      // Re-read the role from the database every time so role promotions /
      // demotions take effect immediately, without needing the user to sign
      // out and back in. Cheap query, small table, internal tool — the
      // ~1ms overhead is fine. Falls back to the token's cached role if
      // the lookup fails for any reason. We deliberately do NOT enforce the
      // `active` flag here: authorize() already rejects deactivated users
      // at sign-in, and the boolean has produced false-negatives that strip
      // session.user from legitimately-active accounts.
      let role = (token.role as string) ?? "MANAGER";
      const id = (token.id as string) ?? (token.sub as string) ?? "";
      if (id) {
        try {
          const u = await prisma.user.findUnique({
            where: { id },
            select: { role: true, email: true },
          });
          if (u?.role) role = u.role;

          // Safety net: auto-promote built-in admins on every session
          // resolution. Catches accounts that init-db missed (e.g., due to
          // email casing) and means the promotion takes effect on the next
          // request without needing a server restart.
          const builtInAdmins = [
            "admin@lacuevita.com",
            "sales@lacuevitafurniture.com",
          ];
          const userEmail = (u?.email ?? (token.email as string) ?? "").toLowerCase();
          if (role !== "ADMIN" && builtInAdmins.includes(userEmail)) {
            await prisma.user
              .update({ where: { id }, data: { role: "ADMIN" } })
              .catch(() => undefined);
            role = "ADMIN";
          }
        } catch {
          // keep token role on transient DB failure
        }
      }

      const user = {
        id,
        name: (token.name as string | null | undefined) ?? null,
        email: (token.email as string | null | undefined) ?? null,
        image: null,
        role,
      };
      return { ...session, user } as unknown as typeof session;
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
