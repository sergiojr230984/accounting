/**
 * Plain sign-out endpoint. Bypasses NextAuth's client library entirely so
 * a baked-in NEXTAUTH_URL / AUTH_URL pointing at localhost can't break it.
 *
 * Two design points keep this robust behind a reverse proxy (Railway):
 * 1. The Location header is a RELATIVE path (/login). Browsers resolve it
 *    against the URL they actually hit in the address bar, not the
 *    internal URL the container sees in request.url. So the redirect
 *    stays on the user's domain whether they're on the Railway subdomain,
 *    a custom domain, or localhost in dev.
 * 2. Cookies are cleared for every NextAuth session-cookie name variant
 *    we've ever used, including chunked .0/.1/.2/.3/.4 suffixes for >4KB
 *    JWTs and the __Secure-/__Host- prefixed variants.
 *
 * GET is aliased to POST so users can also visit /api/sign-out directly
 * in their browser as a manual escape hatch.
 */
function buildResponse(): Response {
  const cookieNames = [
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
  const epoch = "Thu, 01 Jan 1970 00:00:00 GMT";

  const headers = new Headers();
  headers.set("Location", "/login");
  headers.set("Cache-Control", "no-store");

  for (const base of cookieNames) {
    for (const suffix of ["", ".0", ".1", ".2", ".3", ".4"]) {
      const name = base + suffix;
      const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
      const flags = [
        `${name}=`,
        "Path=/",
        `Expires=${epoch}`,
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Lax",
        secure ? "Secure" : null,
      ].filter(Boolean);
      headers.append("Set-Cookie", flags.join("; "));
    }
  }

  return new Response(null, { status: 303, headers });
}

export async function POST() {
  return buildResponse();
}

export async function GET() {
  return buildResponse();
}
