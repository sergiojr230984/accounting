import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Providers from "@/components/Providers";
import DashboardShell from "@/components/DashboardShell";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADMIN_EMAILS = new Set([
  "sales@lacuevitafurniture.com",
  "admin@lacuevita.com",
  "admin@bizledger.com",
]);

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const su = session.user as { id?: string; email?: string; role?: string } | undefined;
  const userId = su?.id ?? "";
  const sessionEmail = (su?.email ?? "").toLowerCase().trim();

  // Always look up the DB directly — session.user.role is unreliable in
  // NextAuth v5-beta (often stripped or missing). session.user.id is the
  // one field NextAuth reliably carries.
  let role = "MANAGER";
  try {
    let dbUser: { role: string; email: string } | null = null;

    if (userId) {
      dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, email: true },
      });
    }
    if (!dbUser && sessionEmail) {
      dbUser = await prisma.user.findFirst({
        where: { email: { equals: sessionEmail, mode: "insensitive" } },
        select: { role: true, email: true },
      });
    }

    if (dbUser) {
      const dbEmail = dbUser.email.toLowerCase().trim();
      // ADMIN_EMAILS is the override — these addresses are always ADMIN
      role = ADMIN_EMAILS.has(dbEmail) ? "ADMIN" : (dbUser.role ?? "MANAGER");
    } else if (sessionEmail && ADMIN_EMAILS.has(sessionEmail)) {
      // No DB row found but email is a known admin — still grant ADMIN
      role = "ADMIN";
    }
  } catch {
    // DB lookup failed — fall back to session email check
    if (sessionEmail && ADMIN_EMAILS.has(sessionEmail)) role = "ADMIN";
  }

  return (
    <Providers>
      <DashboardShell role={role} user={session.user ?? {}}>
        {children}
      </DashboardShell>
    </Providers>
  );
}
