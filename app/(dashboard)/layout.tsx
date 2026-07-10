import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session;
  try {
    session = await auth();
  } catch {
    redirect("/login");
  }
  if (!session?.user) redirect("/login");

  const role = (session.user as { role?: string }).role;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar user={session.user ?? {}} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
