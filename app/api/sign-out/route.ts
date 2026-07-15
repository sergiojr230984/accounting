export const dynamic = "force-dynamic";

/**
 * Sign-out endpoint. Returns an HTML page (not an HTTP redirect) with:
 * - Set-Cookie headers that wipe every NextAuth cookie variant
 * - A meta-refresh tag pointing at /login
 * - A JS window.location.replace fallback
 *
 * Why HTML instead of a 303? Because every redirect-based attempt has
 * been intercepted or rewritten somewhere in the stack (Sentry wrapper,
 * Railway proxy, etc.). An HTML response can't be "redirected" — the
 * browser gets it, applies the Set-Cookie headers, then the meta tag
 * triggers a fresh GET to /login.
 *
 * The Location-style redirect path is ALSO emitted as a 'Refresh' header
 * for paranoid double-coverage.
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
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("Refresh", "0; url=/login");
  // Nuclear option: tells the browser to wipe every cookie + storage + cache
  // entry for this origin, regardless of Domain / Path / HttpOnly attributes.
  // Combined with explicit Set-Cookie deletes below for older browsers.
  headers.set("Clear-Site-Data", '"cookies", "storage", "cache"');

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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signing out…</title>
<meta http-equiv="refresh" content="0; url=/login">
<style>
  body { font-family: system-ui, sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#fff7ed; color:#7c2d12 }
  a { color:#ea580c }
</style>
</head>
<body>
<p>Signing you out… <a href="/login">click here if not redirected.</a></p>
<script>
  // Belt-and-suspenders: navigate via JS in case meta-refresh is blocked.
  window.location.replace("/login");
</script>
</body>
</html>`;

  return new Response(html, { status: 200, headers });
}

export async function POST() {
  return buildResponse();
}

export async function GET() {
  return buildResponse();
}
