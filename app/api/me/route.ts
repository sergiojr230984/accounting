import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Returns the current viewer's session so the frontend (and you) can verify
 * who is logged in and what role they hold. No body, just hit the URL.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { authenticated: false, hint: "No session cookie or it expired. Sign in again." },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
  const u = session.user as {
    id?: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
  return NextResponse.json(
    {
      authenticated: true,
      id: u.id ?? null,
      name: u.name ?? null,
      email: u.email ?? null,
      role: u.role ?? null,
      hint:
        u.role === "ADMIN"
          ? "You are an admin. Settings, taxes, employees, and invoice delete will all work."
          : u.role
            ? "You are not an admin. Settings/taxes/credit-card-fee changes require an ADMIN role."
            : "Your session has no role attached — sign out and back in to refresh the JWT.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
