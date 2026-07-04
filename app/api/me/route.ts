import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveViewer } from "@/lib/viewer";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint. Visit /api/me while logged in to see exactly what
 * NextAuth's auth() returns vs what resolveViewer() (direct JWT decode) sees.
 * Useful for debugging role/session issues on Railway.
 */
export async function GET() {
  const [session, viewer] = await Promise.all([auth(), resolveViewer()]);

  const u = session?.user as {
    id?: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  } | undefined;

  // DB lookup using whichever identity source we have
  const lookupId = viewer.userId || u?.id || "";
  const lookupEmail = viewer.email || u?.email || "";
  let dbUser: { id: string; email: string; role: string } | null = null;
  try {
    if (lookupId) {
      dbUser = await prisma.user.findUnique({
        where: { id: lookupId },
        select: { id: true, email: true, role: true },
      });
    }
    if (!dbUser && lookupEmail) {
      dbUser = await prisma.user.findFirst({
        where: { email: { equals: lookupEmail, mode: "insensitive" } },
        select: { id: true, email: true, role: true },
      });
    }
  } catch {
    // ignore — diagnostic only
  }

  const authSecretSet = !!process.env.AUTH_SECRET;
  const authSecretLength = process.env.AUTH_SECRET?.length ?? 0;

  return NextResponse.json(
    {
      // Whether auth() returned a session at all
      sessionExists: !!session,
      // What auth() put in session.user (often stripped in NextAuth v5-beta)
      sessionUser: {
        id: u?.id ?? null,
        name: u?.name ?? null,
        email: u?.email ?? null,
        role: u?.role ?? null,
      },
      // What resolveViewer() got by decoding the JWT cookie directly
      viewer: {
        signedIn: viewer.signedIn,
        email: viewer.email,
        role: viewer.role,
        isAdmin: viewer.isAdmin,
        userId: viewer.userId,
      },
      // DB row found with the best available identity
      dbUser,
      // Env diagnostics
      env: {
        authSecretSet,
        authSecretLength,
      },
      hint: viewer.signedIn
        ? `resolveViewer sees you as ${viewer.role} (${viewer.email}). This is what the dashboard uses.`
        : "resolveViewer could not decode the JWT — AUTH_SECRET may be wrong or cookie is missing.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
