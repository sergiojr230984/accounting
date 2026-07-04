import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

/**
 * Emergency password reset for the built-in admin accounts.
 *
 * Usage:
 *   GET /api/admin/reset-admin-password?token=<AUTH_SECRET value from Railway>
 *
 * The `token` parameter must exactly match the AUTH_SECRET env variable.
 * If it matches, the admin password is reset to a temporary value that is
 * returned in the response. Log in with that password, then change it in
 * Settings → Users immediately.
 *
 * Only acts on the hard-coded admin emails — cannot affect any other account.
 */

const BUILT_IN_ADMINS = [
  "sales@lacuevitafurniture.com",
  "admin@lacuevita.com",
];

const TEMP_PASSWORD = "LaCuevita2024!";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "AUTH_SECRET is not configured on this server." },
      { status: 500 }
    );
  }

  if (!token || token !== secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Invalid or missing token. Pass ?token=<AUTH_SECRET value from Railway Variables>.",
      },
      { status: 401 }
    );
  }

  const hash = await bcrypt.hash(TEMP_PASSWORD, 12);

  const results: Array<{
    email: string;
    found: boolean;
    reset: boolean;
    error?: string;
  }> = [];

  const allUsers = await prisma.user.findMany({
    select: { id: true, email: true },
  });

  for (const adminEmail of BUILT_IN_ADMINS) {
    const match = allUsers.find(
      (u) => u.email.toLowerCase().trim() === adminEmail.toLowerCase().trim()
    );
    if (!match) {
      results.push({ email: adminEmail, found: false, reset: false });
      continue;
    }
    try {
      await prisma.user.update({
        where: { id: match.id },
        data: { password: hash, role: "ADMIN", active: true },
      });
      results.push({ email: adminEmail, found: true, reset: true });
    } catch (e) {
      results.push({
        email: adminEmail,
        found: true,
        reset: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      results,
      temporaryPassword: TEMP_PASSWORD,
      nextStep:
        "Sign in with the email that shows reset=true and the temporaryPassword above. Then go to Settings → Users and change the password immediately.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
