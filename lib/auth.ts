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
      const user = {
        id: (token.id as string) ?? (token.sub as string) ?? "",
        name: (token.name as string | null | undefined) ?? null,
        email: (token.email as string | null | undefined) ?? null,
        image: null,
        role: (token.role as string) ?? "MANAGER",
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
