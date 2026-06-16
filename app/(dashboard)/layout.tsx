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

  // Look up user in DB by id first (most reliable — set from token.sub),
  // fall back to case-insensitive email match. Use the DB's canonical
  // email for the admin check, since session.user.email can be null on
  // JWTs minted before the explicit-email JWT callback shipped.
  let role: string = "MANAGER";
  try {
    let dbUser: { id: string; email: string; role: string } | null = null;
    if (u.id) {
      dbUser = await prisma.user.findUnique({
        where: { id: u.id },
        select: { id: true, email: true, role: true },
      });
    }
    if (!dbUser && u.email) {
      dbUser = await prisma.user.findFirst({
        where: { email: { equals: u.email, mode: "insensitive" } },
        select: { id: true, email: true, role: true },
      });
    }

    if (dbUser) {
      role = dbUser.role;
      const dbEmail = dbUser.email.toLowerCase().trim();
      if (HARD_CODED_ADMINS.has(dbEmail)) {
        if (dbUser.role !== "ADMIN") {
          await prisma.$executeRawUnsafe(
            `UPDATE "User" SET "role" = 'ADMIN' WHERE "id" = $1;`,
            dbUser.id
          );
        }
        role = "ADMIN";
      }
    } else {
      role = u.role ?? "MANAGER";
    }
  } catch {
    role = u.role ?? "MANAGER";
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
