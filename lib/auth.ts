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
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
        token.companyId = user.companyId;
      }

      // Fires when the client calls `update({ companyId })` to switch the
      // active company. Re-verify membership server-side rather than
      // trusting the client-supplied companyId directly.
      if (trigger === "update" && session?.companyId && token.id) {
        const membership = await prisma.companyMember.findUnique({
          where: { companyId_userId: { companyId: session.companyId, userId: token.id } },
        });
        if (membership) {
          token.companyId = session.companyId;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.companyId = token.companyId;
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

        const valid = await bcrypt.compare(parsed.data.password, user.password);
        if (!valid) return null;

        // Home company defaults to the user's oldest membership, falling
        // back to their companyId column for pre-CompanyMember accounts.
        const homeMembership = await prisma.companyMember.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyId: homeMembership?.companyId ?? user.companyId,
        };
      },
    }),
  ],
});
