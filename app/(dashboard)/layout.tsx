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

  const viewer = await resolveViewer();
  const role = viewer.role ?? "MANAGER";

  return (
    <Providers>
      <DashboardShell role={role} user={session.user ?? {}}>
        {children}
      </DashboardShell>
    </Providers>
  );
}
