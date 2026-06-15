import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  // Look up the DB row directly so we can compare what NextAuth sees vs
  // what's actually persisted. Helps diagnose why a built-in admin is
  // still showing as MANAGER in the sidebar.
  let dbById: { id: string; email: string; role: string } | null = null;
  let dbByEmail: { id: string; email: string; role: string } | null = null;
  try {
    if (u.id) {
      dbById = await prisma.user.findUnique({
        where: { id: u.id },
        select: { id: true, email: true, role: true },
      });
    }
    if (u.email) {
      dbByEmail = await prisma.user.findFirst({
        where: { email: { equals: u.email, mode: "insensitive" } },
        select: { id: true, email: true, role: true },
      });
    }
  } catch {
    // ignore — diagnostic only
  }

  return NextResponse.json(
    {
      authenticated: true,
      session: {
        id: u.id ?? null,
        name: u.name ?? null,
        email: u.email ?? null,
        role: u.role ?? null,
      },
      dbLookupById: dbById,
      dbLookupByEmail: dbByEmail,
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
