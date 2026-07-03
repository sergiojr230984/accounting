import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Providers from "@/components/Providers";
import DashboardShell from "@/components/DashboardShell";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  // session.user.role is reliably set by the auth.ts session callback (DB lookup
  // + BUILT_IN_ADMINS auto-promote). Fall back to resolveViewer() only if the
  // session doesn't carry the role (v5-beta edge case).
  const sessionRole = ((session.user as { role?: string }).role) as string | undefined;
  let role: string = sessionRole ?? "MANAGER";
  if (!sessionRole) {
    const viewer = await resolveViewer();
    role = viewer.role ?? "MANAGER";
  }

  return (
    <Providers>
      <DashboardShell role={role} user={session.user ?? {}}>
        {children}
      </DashboardShell>
    </Providers>
  );
}
