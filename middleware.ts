import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public paths anyone can reach, signed in or not.
  // /api/sign-out has to be public so that a logged-in user clicking
  // Sign out isn't blocked by the "must be unauthed" rule below; the
  // route handler then takes over to clear cookies and redirect.
  const publicPaths = ["/login", "/api/auth", "/api/sign-out"];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  // Block anything that isn't public when there's no session.
  if (!req.auth && !isPublic) {
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
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
