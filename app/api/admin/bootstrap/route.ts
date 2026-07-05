import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const BUILT_IN_ADMINS = [
  "admin@lacuevita.com",
  "sales@lacuevitafurniture.com",
];

/**
 * Public bootstrap endpoint. Promotes the hard-coded built-in admin emails
 * to ADMIN role using a case-insensitive email match. Safe to expose
 * publicly because it can only act on emails in BUILT_IN_ADMINS — a random
 * visitor cannot promote themselves.
 *
 * Hit this once if init-db missed the promotion (e.g., due to email
 * casing). After hitting it, sign out and sign back in so the new JWT
 * picks up the role — or just refresh the dashboard, since the session
 * callback re-reads role from the DB on every request.
 */
export async function GET() {
  const allUsers = await prisma.user.findMany({
    select: { id: true, email: true, role: true },
    orderBy: { email: "asc" },
  });

  const results: Array<{
    email: string;
    found: boolean;
    foundAs?: string;
    previousRole?: string;
    nowRole?: string;
    error?: string;
  }> = [];

  for (const email of BUILT_IN_ADMINS) {
    const match = allUsers.find(
      (u) => u.email.toLowerCase().trim() === email.toLowerCase().trim()
    );
    if (!match) {
      results.push({ email, found: false });
      continue;
    }
    if (match.role === "ADMIN") {
      results.push({
        email,
        found: true,
        foundAs: match.email,
        previousRole: "ADMIN",
        nowRole: "ADMIN",
      });
      continue;
    }
    try {
      await prisma.user.update({
        where: { id: match.id },
        data: { role: "ADMIN" },
      });
      results.push({
        email,
        found: true,
        foundAs: match.email,
        previousRole: match.role,
        nowRole: "ADMIN",
      });
    } catch (e) {
      results.push({
        email,
        found: true,
        foundAs: match.email,
        previousRole: match.role,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      promotedAdmins: results,
      allUsers: allUsers.map((u) => ({ email: u.email, role: u.role })),
      hint:
        "If your email appears in promotedAdmins with nowRole=ADMIN, hard-refresh the dashboard — the Settings link should appear. If found=false for your email, the account doesn't exist with any casing of that address; check allUsers for the actual stored email.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
