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
      // Force-rebuild session.user from the JWT every call. Earlier versions
      // of the callback assumed session.user was always pre-populated by
      // NextAuth, but in some v5-beta paths it can come back as undefined or
      // as an empty object, leaving requireAuth() without an id or role.
      if (token) {
        const rebuilt = {
          id: (token.id as string) ?? (token.sub as string) ?? "",
          name: (token.name as string | null | undefined) ?? null,
          email: (token.email as string | null | undefined) ?? null,
          role: (token.role as string) ?? "MANAGER",
        };
        (session as unknown as { user: typeof rebuilt }).user = rebuilt;
      }
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
