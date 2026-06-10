import { NextResponse } from "next/server";

/**
 * Plain sign-out endpoint. Bypasses NextAuth's client library entirely so a
 * baked-in NEXTAUTH_URL / AUTH_URL pointing at localhost can't break it.
 *
 * Designed to be called as a form POST (no JavaScript). The response is a
 * 303 redirect to /login with Set-Cookie headers that clear every NextAuth
 * session-cookie name variant we've ever used (including chunked .0 .1 .2
 * .3 .4 suffixes for >4KB JWTs).
 *
 * GET is aliased to POST so the user can also visit /api/sign-out directly
 * in their browser as a manual escape hatch.
 */
function buildClearAndRedirect(request: Request): NextResponse {
  const url = new URL(request.url);
  const loginUrl = new URL("/login", `${url.protocol}//${url.host}`);
  const res = NextResponse.redirect(loginUrl, 303);

  const names = [
    "__Secure-authjs.session-token",
    "authjs.session-token",
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
    "__Secure-authjs.csrf-token",
    "authjs.csrf-token",
    "__Host-authjs.csrf-token",
    "authjs.callback-url",
    "__Secure-authjs.callback-url",
  ];

  for (const base of names) {
    for (const suffix of ["", ".0", ".1", ".2", ".3", ".4"]) {
      const name = base + suffix;
      res.cookies.set({
        name,
        value: "",
        expires: new Date(0),
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: name.startsWith("__Secure-") || name.startsWith("__Host-"),
      });
    }
  }
  return res;
}

export async function POST(request: Request) {
  return buildClearAndRedirect(request);
}

export async function GET(request: Request) {
  return buildClearAndRedirect(request);
}
