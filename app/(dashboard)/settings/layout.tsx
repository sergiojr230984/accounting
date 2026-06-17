import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HARD_CODED_ADMINS = new Set([
  "admin@lacuevita.com",
  "sales@lacuevitafurniture.com",
]);

/**
 * Settings is admin-only. We check admin status via three independent
 * paths, in order of cheapest first:
 *   1. session.user.role === "ADMIN"
 *   2. session.user.email is in HARD_CODED_ADMINS
 *   3. The DB row found by session.user.id (or email) has role=ADMIN
 *      OR has an email in HARD_CODED_ADMINS (we also force-promote)
 *
 * The triple check exists because various NextAuth-callback / JWT-staleness
 * bugs have caused session.user.role to come through as MANAGER for a
 * legitimate admin. The hard-coded email fallback is the safety net.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const u = (session.user ?? {}) as {
    id?: string;
    email?: string;
    role?: string;
  };

  // 1. Cheap check
  if (u.role === "ADMIN") return <>{children}</>;

  // 2. Session email in hard-coded list
  const sessionEmail = (u.email ?? "").toLowerCase().trim();
  if (sessionEmail && HARD_CODED_ADMINS.has(sessionEmail)) {
    return <>{children}</>;
  }

  // 3. DB lookup
  try {
    let dbUser: { id: string; email: string; role: string } | null = null;
    if (u.id) {
      dbUser = await prisma.user.findUnique({
        where: { id: u.id },
        select: { id: true, email: true, role: true },
      });
    }
    if (!dbUser && sessionEmail) {
      dbUser = await prisma.user.findFirst({
        where: { email: { equals: sessionEmail, mode: "insensitive" } },
        select: { id: true, email: true, role: true },
      });
    }
    if (dbUser) {
      if (dbUser.role === "ADMIN") return <>{children}</>;
      const dbEmail = dbUser.email.toLowerCase().trim();
      if (HARD_CODED_ADMINS.has(dbEmail)) {
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET "role" = 'ADMIN' WHERE "id" = $1;`,
          dbUser.id
        );
        return <>{children}</>;
      }
    }
  } catch {
    // ignore — fall through to redirect
  }

  redirect("/dashboard");
}
