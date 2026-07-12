import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { decode } from "@auth/core/jwt";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { rateLimit, type RateLimitOptions } from "./rate-limit";

export type Role = "ADMIN" | "MANAGER" | "SALES";

export interface AuthedSession extends Session {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: Role;
  };
}

const COOKIE_CANDIDATES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

type JwtFallback =
  | { ok: true; user: { id: string; role: Role; name: string | null; email: string | null } }
  | { ok: false; error: string; cookiesPresent: string[] };

/**
 * Direct JWT-cookie fallback for cases where `auth()` returns a session but
 * NextAuth v5-beta strips session.user. We decode the cookie with the same
 * AUTH_SECRET and reconstruct the user from the raw token claims. Handles
 * chunked cookies (NextAuth splits JWTs > 4KB into `name.0`, `name.1`...).
 */
async function readJwtUser(): Promise<JwtFallback> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { ok: false, error: "no AUTH_SECRET", cookiesPresent: [] };
  try {
    const store = await cookies();
    const cookiesPresent = store.getAll().map((c) => c.name);
    let lastDecodeError: string | null = null;
    for (const name of COOKIE_CANDIDATES) {
      let value = store.get(name)?.value;
      if (!value) {
        // Try chunked variant.
        const chunks: string[] = [];
        for (let i = 0; i < 20; i++) {
          const chunk = store.get(`${name}.${i}`)?.value;
          if (!chunk) break;
          chunks.push(chunk);
        }
        if (chunks.length > 0) value = chunks.join("");
      }
      if (!value) continue;
      try {
        const token = await decode({ token: value, secret, salt: name });
        if (!token) continue;
        const id = (token.id as string) ?? (token.sub as string) ?? "";
        if (!id) continue;

        // This path decodes the JWT directly rather than going through
        // lib/auth.ts's session() callback, so it needs its own check that
        // the account hasn't been deactivated since the token was issued --
        // otherwise a deactivated user's session would keep working through
        // this fallback even after the primary path revokes it.
        const dbUser = await prisma.user.findUnique({ where: { id }, select: { active: true } });
        if (dbUser?.active === false) continue;

        const role = ((token.role as string) ?? "MANAGER") as Role;
        return {
          ok: true,
          user: {
            id,
            role,
            name: (token.name as string | null | undefined) ?? null,
            email: (token.email as string | null | undefined) ?? null,
          },
        };
      } catch (e) {
        lastDecodeError = (e as Error).message;
      }
    }
    return {
      ok: false,
      error: lastDecodeError ?? "no matching session cookie found",
      cookiesPresent,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, cookiesPresent: [] };
  }
}

export async function requireAuth(): Promise<AuthedSession | NextResponse> {
  let session: AuthedSession | null = null;
  let authError: string | null = null;
  try {
    session = (await auth()) as AuthedSession | null;
  } catch (e) {
    authError = (e as Error).message;
  }

  // Happy path: NextAuth returned a session with a real user id.
  if (session?.user?.id) return session;

  // First fallback: decode the JWT cookie directly.
  const fallback = await readJwtUser();
  if (fallback.ok) {
    return {
      ...(session ?? {}),
      expires: session?.expires ?? new Date(Date.now() + 86400_000).toISOString(),
      user: {
        id: fallback.user.id,
        name: fallback.user.name,
        email: fallback.user.email,
        role: fallback.user.role,
      },
    } as AuthedSession;
  }

  return NextResponse.json(
    {
      error: "Your session has expired or wasn't recognized. Sign out and sign back in.",
      code: "auth_required",
      debug: {
        hasSession: false,
        hasUser: false,
        userKeys: [] as string[],
        fallbackUsed: false,
        fallbackError: fallback.error,
        cookiesPresent: fallback.cookiesPresent,
        authError,
      },
    },
    { status: 401 }
  );
}

/**
 * Role guard. Pass one role or an array. Returns NextResponse on failure.
 */
export async function requireRole(
  ...roles: Role[]
): Promise<AuthedSession | NextResponse> {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  const role = guard.user.role;

  // An authenticated session with no determinable role cannot satisfy any
  // role requirement -- reject rather than treating it as authorized.
  if (!role || !roles.includes(role)) {
    return NextResponse.json(
      {
        error: `Forbidden — your role "${role}" cannot do this. Required: ${roles.join(" or ")}.`,
        code: "forbidden",
        currentRole: role,
        requiredRoles: roles,
      },
      { status: 403 }
    );
  }
  return guard;
}

/**
 * Horizontal scoping for customer invoices. ADMIN/MANAGER see everything
 * (returns null -- no filter to apply). A SALES caller is scoped to
 * invoices linked to "their" Employee record, matched by email against the
 * session's own email (User has no direct relation to Employee, but both
 * models already have a unique `email` field -- no schema change needed).
 * A SALES user with no matching Employee row is scoped to an id that can
 * never match, rather than falling back to seeing everything: an unlinked
 * SALES account should see nothing, not the whole company's invoices.
 */
export async function scopeInvoicesToOwnEmployee(
  session: AuthedSession
): Promise<{ employeeId: string } | null> {
  if (session.user.role !== "SALES") return null;
  const email = (session.user.email ?? "").toLowerCase().trim();
  if (!email) return { employeeId: "__no-matching-employee__" };
  const employee = await prisma.employee.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return { employeeId: employee?.id ?? "__no-matching-employee__" };
}

/**
 * Standard error response envelope. Use this so clients can rely on shape.
 */
export function apiError(
  message: string,
  status = 500,
  extras: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json({ error: message, ...extras }, { status });
}

/**
 * Apply rate limiting before processing. Returns null on success or a 429 NextResponse.
 * Identifies callers by client IP (X-Forwarded-For from Railway proxy).
 */
export function checkRateLimit(
  request: Request,
  key: string,
  opts: RateLimitOptions = { windowMs: 60_000, max: 60 }
): NextResponse | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const composite = `${key}:${ip}`;
  const result = rateLimit(composite, opts);
  if (result.ok) return null;
  return NextResponse.json(
    {
      error: "Too many requests — try again later.",
      code: "rate_limited",
      retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000),
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
        "X-RateLimit-Limit": String(opts.max),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}
