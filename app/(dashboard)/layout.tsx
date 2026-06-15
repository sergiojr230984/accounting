import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Providers from "@/components/Providers";
import { prisma } from "@/lib/prisma";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; email?: string; role?: string };
  // Always fetch role from the DB so ADMIN promotions show up immediately
  // and we don't depend on session.user.role being populated correctly by
  // the NextAuth v5-beta callback chain (it sometimes isn't).
  let role = u.role ?? "MANAGER";
  try {
    const dbUser = u.id
      ? await prisma.user.findUnique({ where: { id: u.id }, select: { role: true } })
      : u.email
        ? await prisma.user.findUnique({ where: { email: u.email }, select: { role: true } })
        : null;
    if (dbUser?.role) role = dbUser.role;
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
