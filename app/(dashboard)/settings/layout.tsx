import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Settings is admin-only. The Sidebar already hides the link for managers,
 * but anyone who types /settings into the URL bar would still hit the page
 * without this guard. We redirect them to /dashboard instead of showing a
 * 403 — feels less aggressive for an internal tool, and matches the
 * Sidebar behaviour where the link doesn't exist at all.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = ((session?.user as { role?: string }) ?? {}).role;
  if (role !== "ADMIN") redirect("/dashboard");
  return <>{children}</>;
}
