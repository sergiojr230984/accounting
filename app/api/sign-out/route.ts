import { NextResponse } from "next/server";

/**
 * Plain sign-out endpoint. Bypasses NextAuth's client library entirely so
 * a baked-in NEXTAUTH_URL / AUTH_URL pointing at localhost can't break it.
 *
 * Clears every NextAuth session-cookie name variant we've ever used,
 * including chunked variants (NextAuth splits large JWTs into `.0`, `.1`...).
 */
export async function POST() {
  const epoch = new Date(0);
  const names = [
    "__Secure-authjs.session-token",
    "authjs.session-token",
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
    "__Secure-authjs.csrf-token",
    "authjs.csrf-token",
    "__Host-authjs.csrf-token",
  ];

  const res = NextResponse.json({ ok: true });
  for (const base of names) {
    for (const suffix of ["", ".0", ".1", ".2", ".3", ".4"]) {
      const name = base + suffix;
      res.cookies.set({
        name,
        value: "",
        expires: epoch,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: name.startsWith("__Secure-") || name.startsWith("__Host-"),
      });
    }
  }
  return res;
}

// Allow GET too so the user could hit it directly in the browser as a
// last-resort manual sign-out (returns the same clear-cookie response).
export const GET = POST;
