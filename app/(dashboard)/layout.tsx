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

async function resolveRole(session: Awaited<ReturnType<typeof auth>>): Promise<string> {
  // 1. Try session.user.role (set by auth.ts session callback)
  const sessionUser = session?.user as { role?: string; email?: string; id?: string } | undefined;
  if (sessionUser?.role && sessionUser.role !== "MANAGER") {
    return sessionUser.role;
  }

  // 2. Check email against known admin list (works even if session is stripped)
  const email = (sessionUser?.email ?? "").toLowerCase().trim();
  if (email && ADMIN_EMAILS.has(email)) return "ADMIN";

  // 3. Try resolveViewer() which decodes the JWT cookie directly
  try {
    const viewer = await resolveViewer();
    if (viewer.role) return viewer.role;
  } catch {
    // ignore
  }

  // 4. DB lookup by email as final fallback
  if (email) {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { role: true, email: true },
      });
      if (dbUser) {
        const dbEmail = dbUser.email.toLowerCase().trim();
        if (ADMIN_EMAILS.has(dbEmail)) return "ADMIN";
        return dbUser.role ?? "MANAGER";
      }
    } catch {
      // ignore
    }
  }

  // 5. Use session role even if it's MANAGER, or default
  return sessionUser?.role ?? "MANAGER";
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const role = await resolveRole(session);

  return (
    <Providers>
      <DashboardShell role={role} user={session.user ?? {}}>
        {children}
      </DashboardShell>
    </Providers>
  );
}
