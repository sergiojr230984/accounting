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
