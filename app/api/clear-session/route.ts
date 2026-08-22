import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Clears all NextAuth session cookies and redirects to /login.
 * Use this if /api/auth/signout shows a server error.
 *
 * Visit: /api/clear-session
 */
export async function GET(req: NextRequest) {
  const loginUrl = new URL("/login", req.url);
  const response = NextResponse.redirect(loginUrl);

  const cookieOptions = {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  };

  // Clear all possible NextAuth session cookie names
  for (const name of [
    "__Secure-authjs.session-token",
    "authjs.session-token",
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
    "__Host-authjs.csrf-token",
    "authjs.csrf-token",
    "__Secure-authjs.callback-url",
    "authjs.callback-url",
  ]) {
    response.cookies.set(name, "", cookieOptions);
  }

  return response;
}
