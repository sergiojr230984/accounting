import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

const HARD_CODED_ADMINS = new Set([
  "admin@lacuevita.com",
  "sales@lacuevitafurniture.com",
]);

/**
 * Decode the NextAuth session JWT directly from the request cookies.
 * Uses next-auth/jwt's getToken which mirrors NextAuth's own cookie/salt
 * logic exactly — so it works regardless of whether Railway uses the
 * __Secure- prefix (HTTPS) or the plain name (HTTP behind a proxy).
 */
async function getJwtPayload(): Promise<Record<string, unknown> | null> {
  const secrets = [
    process.env.AUTH_SECRET,
    process.env.NEXTAUTH_SECRET,
  ].filter(Boolean) as string[];
  if (secrets.length === 0) return null;

  try {
    const { getToken } = await import("next-auth/jwt");

    // Build a Request-compatible object from the incoming Cookie header.
    // getToken reads the cookie header to find the session token, then
    // decodes it with the same salt logic NextAuth uses internally.
    const headerStore = await headers();
    const cookieHeader = headerStore.get("cookie") ?? "";
    const req = { headers: { cookie: cookieHeader } } as unknown as Request;

    // Try every combination of secret × secureCookie flag.
    // Railway terminates TLS at its proxy, so the Next.js process may see the
    // request as HTTP even though clients connect over HTTPS. NextAuth picks
    // the cookie name based on this flag, so we must try both.
    for (const secret of secrets) {
      for (const secureCookie of [true, false]) {
        try {
          const token = await getToken({ req, secret, secureCookie });
          if (token) return token as Record<string, unknown>;
        } catch {
          // try next combination
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

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

  // Quick wins — hard-coded admin email or ADMIN role in the JWT
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

  // DB lookup for role
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
