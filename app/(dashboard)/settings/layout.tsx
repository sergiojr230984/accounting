import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Settings is admin-only. Admin status is resolved via the JWT-decoder
 * helper (resolveViewer) which:
 *   - decodes the session cookie directly (bypasses broken NextAuth
 *     session callbacks)
 *   - checks role, hard-coded admin emails, and DB rows
 *   - force-promotes hard-coded admin emails
 *
 * If resolveViewer comes back signed-in but not admin, redirect to
 * /dashboard.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const viewer = await resolveViewer();
  if (!viewer.isAdmin) redirect("/dashboard");

  return <>{children}</>;
}
