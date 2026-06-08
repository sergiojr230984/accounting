import { NextResponse } from "next/server";
import type { Session } from "next-auth";
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
 * Authentication guard. Returns NextResponse on failure, or the session on success.
 * Usage:
 *   const guard = await requireAuth();
 *   if (guard instanceof NextResponse) return guard;
 *   const session = guard;
 */
export async function requireAuth(): Promise<AuthedSession | NextResponse> {
  let session: AuthedSession | null = null;
  let authError: string | null = null;
  try {
    session = (await auth()) as AuthedSession | null;
  } catch (e) {
    authError = (e as Error).message;
  }
  if (!session?.user) {
    return NextResponse.json(
      {
        error: "Your session has expired or wasn't recognized. Sign out and sign back in.",
        code: "auth_required",
        debug: {
          hasSession: Boolean(session),
          hasUser: Boolean(session?.user),
          authError,
        },
      },
      { status: 401 }
    );
  }
  return session;
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
