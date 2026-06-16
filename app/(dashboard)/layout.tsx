import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Providers from "@/components/Providers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HARD_CODED_ADMINS = new Set([
  "admin@lacuevita.com",
  "sales@lacuevitafurniture.com",
]);

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const u = (session.user ?? {}) as { id?: string; email?: string; role?: string };

  // Last-line-of-defense role detection. Read role straight from the DB
  // every render (no cache), and if the signed-in email is in the
  // hard-coded admin list, force-promote it via raw SQL so this request's
  // role is correct even if every other promotion path silently failed.
  let role = u.role ?? "MANAGER";
  const sessionEmail = (u.email ?? "").toLowerCase().trim();
  try {
    if (sessionEmail && HARD_CODED_ADMINS.has(sessionEmail)) {
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "role" = 'ADMIN' WHERE LOWER("email") = LOWER($1);`,
        sessionEmail
      );
      role = "ADMIN";
    } else {
      const dbUser = u.id
        ? await prisma.user.findUnique({ where: { id: u.id }, select: { role: true } })
        : sessionEmail
          ? await prisma.user.findFirst({
              where: { email: { equals: sessionEmail, mode: "insensitive" } },
              select: { role: true },
            })
          : null;
      if (dbUser?.role) role = dbUser.role;
    }
  } catch {
    // keep session role on transient DB failure
  }

  return (
    <Providers>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar role={role} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar user={session.user ?? {}} />
          <main className="flex-1 overflow-y-auto p-8">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
