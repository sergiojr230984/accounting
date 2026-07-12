import { NextResponse, type NextRequest } from "next/server";

// Cookie-existence check only — the previous `auth((req) => ...)` wrapper
// ran the full NextAuth config (including Prisma/bcrypt calls in the
// session callback) inside Next.js Edge Middleware, which crashed every
// request with "PrismaClient is not configured to run in ... Edge
// Middleware". Prisma needs the Node.js runtime, so we don't invoke
// NextAuth here at all — just check for its session cookie.
function hasSession(req: NextRequest): boolean {
  return (
    req.cookies.has("next-auth.session-token") ||
    req.cookies.has("__Secure-next-auth.session-token") ||
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token")
  );
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense-in-depth: reject a mutating API request whose Origin (or
 * Referer, if Origin is absent) names a different host than the one the
 * request itself arrived on. SameSite=Lax on the session cookie already
 * blocks the common cross-site-form-POST case, but that's a single point of
 * failure -- this is a second, independent layer that doesn't depend on
 * cookie attributes at all.
 *
 * Deliberately fails open when neither header is present: real browsers
 * attach Origin (and/or Referer) to same-origin fetch/form submissions too,
 * so their absence here means we can't evaluate the request rather than
 * that it's suspicious -- rejecting on absence would risk blocking
 * legitimate non-browser API callers this app doesn't control.
 */
function hasForeignOrigin(req: NextRequest): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return false;

  const hostOf = (value: string | null): string | null => {
    if (!value) return null;
    try {
      return new URL(value).host;
    } catch {
      return "__unparsable__";
    }
  };

  const originHost = hostOf(req.headers.get("origin"));
  if (originHost !== null) return originHost !== host;

  const refererHost = hostOf(req.headers.get("referer"));
  if (refererHost !== null) return refererHost !== host;

  return false;
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths anyone can reach, signed in or not.
  // /api/sign-out has to be public so that a logged-in user clicking
  // Sign out isn't blocked by the "must be unauthed" rule below; the
  // route handler then takes over to clear cookies and redirect.
  const publicPaths = ["/login", "/api/auth", "/api/sign-out", "/api/health", "/pay", "/estimate"];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  // Block anything that isn't public when there's no session.
  if (!hasSession(req) && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // CSRF defense-in-depth on mutating API calls. /api/auth/** is excluded --
  // NextAuth's own credentials flow has its own CSRF token mechanism, and
  // introducing a second, independent check there risks unpredictable
  // interactions with a flow this app's login depends on entirely.
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") &&
    MUTATING_METHODS.has(req.method) &&
    hasForeignOrigin(req)
  ) {
    return NextResponse.json({ error: "Forbidden — cross-origin request rejected" }, { status: 403 });
  }

  // Intentionally NO "if logged in and visiting /login redirect to
  // /dashboard" guard. That guard made the sign-out flow impossible —
  // after sign-out the browser navigates to /login, but the cookie
  // sometimes lingered for one request and the guard bounced the user
  // right back to /dashboard. Without it, /login always renders. If a
  // truly-still-authed user lands there, they can sign in as someone
  // else or just navigate to /dashboard manually.

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
