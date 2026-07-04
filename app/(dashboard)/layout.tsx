import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Providers from "@/components/Providers";
import DashboardShell from "@/components/DashboardShell";
import { resolveViewer } from "@/lib/viewer";
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

  // Cast session.user to access role and email fields that NextAuth v5-beta
  // sometimes strips from the inferred type but still populates at runtime.
  const su = session.user as { role?: string; email?: string } | undefined;
  const sessionRole = su?.role;
  const sessionEmail = (su?.email ?? "").toLowerCase().trim();

  let role: string;

  // 1. session.user.role — set by auth.ts session callback with DB lookup
  if (sessionRole && sessionRole !== "MANAGER") {
    role = sessionRole;
  }
  // 2. Known admin email — works even if session fields are stripped
  else if (sessionEmail && ADMIN_EMAILS.has(sessionEmail)) {
    role = "ADMIN";
  }
  // 3. resolveViewer() — decodes JWT cookie directly
  else {
    const viewer = await resolveViewer();
    if (viewer.role && viewer.role !== "MANAGER") {
      role = viewer.role;
    }
    // 4. DB lookup by email as final fallback
    else if (sessionEmail) {
      try {
        const dbUser = await prisma.user.findFirst({
          where: { email: { equals: sessionEmail, mode: "insensitive" } },
          select: { role: true, email: true },
        });
        if (dbUser) {
          const dbEmail = dbUser.email.toLowerCase().trim();
          role = ADMIN_EMAILS.has(dbEmail) ? "ADMIN" : (dbUser.role ?? "MANAGER");
        } else {
          role = viewer.role ?? sessionRole ?? "MANAGER";
        }
      } catch {
        role = viewer.role ?? sessionRole ?? "MANAGER";
      }
    } else {
      role = viewer.role ?? sessionRole ?? "MANAGER";
    }
  }

  return (
    <Providers>
      <DashboardShell role={role} user={session.user ?? {}}>
        {children}
      </DashboardShell>
    </Providers>
  );
}
