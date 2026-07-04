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

  // auth() may return a session with empty/stripped user fields (NextAuth v5-beta).
  // resolveViewer() decodes the JWT cookie directly — more reliable for getting
  // the user's id and email.
  const viewer = await resolveViewer();
  const su = session.user as { id?: string; email?: string; role?: string } | undefined;

  // Collect the best available identity from either source
  const userId = viewer.userId || su?.id || "";
  const userEmail = (viewer.email || su?.email || "").toLowerCase().trim();

  // If resolveViewer already determined the full role, trust it directly
  if (viewer.role === "ADMIN" || viewer.isAdmin) {
    return (
      <Providers>
        <DashboardShell role="ADMIN" user={session.user ?? {}}>
          {children}
        </DashboardShell>
      </Providers>
    );
  }

  if (viewer.role === "SALES") {
    return (
      <Providers>
        <DashboardShell role="SALES" user={session.user ?? {}}>
          {children}
        </DashboardShell>
      </Providers>
    );
  }

  // resolveViewer() didn't get a definitive role — fall back to DB lookup
  let role = "MANAGER";
  try {
    let dbUser: { role: string; email: string } | null = null;

    if (userId) {
      dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, email: true },
      });
    }
    if (!dbUser && userEmail) {
      dbUser = await prisma.user.findFirst({
        where: { email: { equals: userEmail, mode: "insensitive" } },
        select: { role: true, email: true },
      });
    }

    if (dbUser) {
      const dbEmail = dbUser.email.toLowerCase().trim();
      role = ADMIN_EMAILS.has(dbEmail) ? "ADMIN" : (dbUser.role ?? "MANAGER");
    } else if (userEmail && ADMIN_EMAILS.has(userEmail)) {
      role = "ADMIN";
    }
  } catch {
    if (userEmail && ADMIN_EMAILS.has(userEmail)) role = "ADMIN";
  }

  return (
    <Providers>
      <DashboardShell role={role} user={session.user ?? {}}>
        {children}
      </DashboardShell>
    </Providers>
  );
}
