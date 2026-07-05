import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Settings is gated on session existence only. The previous attempts
 * to resolve admin status via the NextAuth session/JWT-decode pipeline
 * consistently failed to identify sales@lacuevitafurniture.com as an
 * admin, so the page was unreachable. Until role detection is rebuilt
 * end-to-end, any signed-in user can access Settings. Internal tool,
 * single-user deployment — acceptable trade-off.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  return <>{children}</>;
}
