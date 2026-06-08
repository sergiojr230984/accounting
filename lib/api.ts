import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { decode } from "@auth/core/jwt";
import { auth } from "./auth";
import { rateLimit, type RateLimitOptions } from "./rate-limit";

export type Role = "ADMIN" | "MANAGER";

export interface AuthedSession extends Session {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: Role;
  };
}

/**
 * Direct JWT-cookie fallback for cases where `auth()` returns a session but
 * NextAuth v5-beta strips session.user. We decode the cookie with the same
 * AUTH_SECRET and reconstruct the user from the raw token claims.
 */
async function readJwtUser(): Promise<{ id: string; role: Role; name?: string | null; email?: string | null } | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const store = await cookies();
    // NextAuth picks the cookie name based on protocol — try both.
    const cookieValue =
      store.get("__Secure-authjs.session-token")?.value ??
      store.get("authjs.session-token")?.value ??
      store.get("__Secure-next-auth.session-token")?.value ??
      store.get("next-auth.session-token")?.value;
    if (!cookieValue) return null;
    const token = await decode({
      token: cookieValue,
      secret,
      salt:
        store.get("__Secure-authjs.session-token") !== undefined
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
    });
    if (!token) return null;
    const id = (token.id as string) ?? (token.sub as string) ?? "";
    const role = ((token.role as string) ?? "MANAGER") as Role;
    if (!id) return null;
    return {
      id,
      role,
      name: (token.name as string | null | undefined) ?? null,
      email: (token.email as string | null | undefined) ?? null,
    };
  } catch {
    return null;
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
  // If auth() gave us a session with a real user id, use it directly.
  if (session?.user?.id) return session;

  // Fallback: read the JWT cookie ourselves. Works around a v5-beta path
  // that returns a session whose .user is empty.
  const fallback = await readJwtUser();
  if (fallback) {
    return {
      ...(session ?? {}),
      expires: session?.expires ?? new Date(Date.now() + 86400_000).toISOString(),
      user: {
        id: fallback.id,
        name: fallback.name,
        email: fallback.email,
        role: fallback.role,
      },
    } as AuthedSession;
  }

  return NextResponse.json(
    {
      error: "Your session has expired or wasn't recognized. Sign out and sign back in.",
      code: "auth_required",
      debug: {
        hasSession: Boolean(session),
        hasUser: Boolean(session?.user),
        userKeys: session?.user ? Object.keys(session.user) : [],
        fallbackUsed: false,
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
  if (!role || !roles.includes(role)) {
    const have = role ?? "none (sign out and back in to refresh)";
    return NextResponse.json(
      {
        error: `Forbidden — your role "${have}" cannot do this. Required: ${roles.join(" or ")}.`,
        code: "forbidden",
        currentRole: role ?? null,
        requiredRoles: roles,
      },
      { status: 403 }
    );
  }
  return guard;
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
