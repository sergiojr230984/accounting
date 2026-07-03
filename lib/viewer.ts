import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const HARD_CODED_ADMINS = new Set([
  "admin@lacuevita.com",
  "sales@lacuevitafurniture.com",
]);

/**
 * Decode the NextAuth JWT cookie directly. We bypass auth()/session()
 * because the session callback chain in v5-beta has been stripping
 * fields (id, email) inconsistently, which broke every downstream
 * role/admin check. The raw JWT payload is the source of truth.
 */
async function getJwtPayload(): Promise<Record<string, unknown> | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const { decode } = await import("@auth/core/jwt");
    const cookieStore = await cookies();
    const cookieNames = [
      "__Secure-authjs.session-token",
      "authjs.session-token",
      "__Secure-next-auth.session-token",
      "next-auth.session-token",
    ];
    for (const name of cookieNames) {
      const c = cookieStore.get(name);
      if (!c?.value) continue;
      try {
        const decoded = await decode({ token: c.value, secret, salt: name });
        if (decoded) return decoded as Record<string, unknown>;
      } catch {
        // try next cookie name
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Returns true if the currently signed-in viewer should have admin
 * privileges. Checks (in order):
 *   1. JWT payload role === "ADMIN"
 *   2. JWT payload email in HARD_CODED_ADMINS (case-insensitive)
 *   3. DB row found by payload sub/id has role=ADMIN OR admin email
 *      (and force-promotes if it's an admin email but role isn't)
 *
 * Returns the resolved role and whether the viewer is admin.
 */
export async function resolveViewer(): Promise<{
  signedIn: boolean;
  isAdmin: boolean;
  email: string | null;
  role: "ADMIN" | "MANAGER" | "SALES" | null;
  userId: string | null;
}> {
  const payload = await getJwtPayload();
  if (!payload) {
    return { signedIn: false, isAdmin: false, email: null, role: null, userId: null };
  }

  const payloadEmail = ((payload.email as string) ?? "").toLowerCase().trim();
  const payloadRole = (payload.role as string) ?? null;
  const payloadId =
    (payload.sub as string) ?? (payload.id as string) ?? null;

  // Quick wins
  if (payloadRole === "ADMIN") {
    return {
      signedIn: true,
      isAdmin: true,
      email: payloadEmail || null,
      role: "ADMIN",
      userId: payloadId,
    };
  }
  if (payloadEmail && HARD_CODED_ADMINS.has(payloadEmail)) {
    return {
      signedIn: true,
      isAdmin: true,
      email: payloadEmail,
      role: "ADMIN",
      userId: payloadId,
    };
  }

  // DB lookup
  try {
    let dbUser: { id: string; email: string; role: string } | null = null;
    if (payloadId) {
      dbUser = await prisma.user.findUnique({
        where: { id: payloadId },
        select: { id: true, email: true, role: true },
      });
    }
    if (!dbUser && payloadEmail) {
      dbUser = await prisma.user.findFirst({
        where: { email: { equals: payloadEmail, mode: "insensitive" } },
        select: { id: true, email: true, role: true },
      });
    }
    if (dbUser) {
      const dbEmail = dbUser.email.toLowerCase().trim();
      const isHardCoded = HARD_CODED_ADMINS.has(dbEmail);
      if (isHardCoded && dbUser.role !== "ADMIN") {
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET "role" = 'ADMIN' WHERE "id" = $1;`,
          dbUser.id
        );
      }
      const finalRole =
        isHardCoded || dbUser.role === "ADMIN"
          ? "ADMIN"
          : dbUser.role === "SALES"
          ? "SALES"
          : "MANAGER";
      return {
        signedIn: true,
        isAdmin: finalRole === "ADMIN",
        email: dbUser.email,
        role: finalRole,
        userId: dbUser.id,
      };
    }
  } catch {
    // ignore — fall through
  }

  return {
    signedIn: true,
    isAdmin: false,
    email: payloadEmail || null,
    role: (payloadRole as "ADMIN" | "MANAGER" | "SALES" | null) ?? "MANAGER",
    userId: payloadId,
  };
}
